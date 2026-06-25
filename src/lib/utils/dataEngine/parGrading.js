// parGrading.js
//
// TRADE GRADING: compares acquired player's actual points during hold weeks
// against the marginal starter's (Nth-best pre-trade player at that position)
// actual points during those SAME weeks. No projections.
//
// WAIVER GRADING: compares pickup's actual points during hold weeks against
// the worst starter's (replacement level player) actual points during those
// same weeks. PAR > 0 = above replacement = pickup helped the team.

const LEGACY_ROSTER_POSITIONS = {
  '2023': ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','BN','BN','BN','BN','BN'],
  '2024': ['QB','RB','RB','WR','WR','TE','FLEX','FLEX','K','DEF','BN','BN','BN','BN','BN','BN']
};

export function getLeagueRosterPositions(year) {
  return LEGACY_ROSTER_POSITIONS[String(year)] || null;
}

const DEFAULT_ROSTER_POSITIONS = [
  'QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','BN','BN','BN','BN','BN'
];

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];

export function parseStarterSlots(rosterPositions) {
  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  (rosterPositions || DEFAULT_ROSTER_POSITIONS).forEach((pos) => {
    const p = pos.toUpperCase();
    if (p === 'SUPER_FLEX' || p === 'SUPERFLEX') slots.FLEX += 1;
    else if (slots[p] !== undefined) slots[p] += 1;
  });
  return slots;
}

export function normalizePosition(position, playerId) {
  if (!position) {
    if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) return 'DEF';
    return null;
  }
  const p = position.toUpperCase();
  if (p === 'QB') return 'QB';
  if (p === 'RB') return 'RB';
  if (p === 'WR') return 'WR';
  if (p === 'TE') return 'TE';
  if (p === 'K')  return 'K';
  if (p === 'DEF' || p === 'DST') return 'DEF';
  return null;
}

// ── Season PAR tables ────────────────────────────────────────────────────────

export function buildSeasonPARTables(seasonPlayerResults, allPlayersData, rosterPositions, numTeams) {
  const debug = [];
  const slots = parseStarterSlots(rosterPositions || DEFAULT_ROSTER_POSITIONS);
  debug.push(`Starter slots: ${JSON.stringify(slots)}, numTeams: ${numTeams}`);

  const playerSeasonTotals = {};
  seasonPlayerResults.forEach((pr) => {
    const id = String(pr.playerId);
    if (!playerSeasonTotals[id]) playerSeasonTotals[id] = 0;
    playerSeasonTotals[id] += pr.pointsTotal || 0;
  });

  const playersByPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
    const pos = normalizePosition(allPlayersData[playerId]?.position, playerId);
    if (!pos || !playersByPosition[pos]) return;
    playersByPosition[pos].push({ playerId, totalPts, position: pos });
  });
  Object.values(playersByPosition).forEach((g) => g.sort((a, b) => b.totalPts - a.totalPts));

  const replacementLevels = {};
  const replacementPlayerIds = {};   // actual player at replacement boundary
  const replacementPlayerNames = {}; // for display

  ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach((pos) => {
    const starterCount = (slots[pos] || 0) * numTeams;
    const repPlayer = playersByPosition[pos][starterCount];
    replacementLevels[pos] = repPlayer ? repPlayer.totalPts : 0;
    replacementPlayerIds[pos] = repPlayer ? repPlayer.playerId : null;
    const repInfo = repPlayer ? allPlayersData[repPlayer.playerId] : null;
    replacementPlayerNames[pos] = repInfo?.full_name ||
      (repInfo ? `${repInfo.first_name || ''} ${repInfo.last_name || ''}`.trim() : null) ||
      (repPlayer ? `Player ${repPlayer.playerId}` : '(none)');
    debug.push(`${pos}: ${starterCount} starter slots, replacement = ${(replacementLevels[pos] || 0).toFixed(1)} pts (${replacementPlayerNames[pos]})`);
  });

  if ((slots.FLEX || 0) > 0) {
    const flexPool = [];
    FLEX_ELIGIBLE.forEach((pos) => {
      const dedicated = (slots[pos] || 0) * numTeams;
      playersByPosition[pos].slice(dedicated).forEach((p) => flexPool.push(p));
    });
    flexPool.sort((a, b) => b.totalPts - a.totalPts);
    const flexRepPlayer = flexPool[(slots.FLEX || 0) * numTeams];
    replacementLevels.FLEX = flexRepPlayer ? flexRepPlayer.totalPts : 0;
    debug.push(`FLEX replacement = ${(replacementLevels.FLEX || 0).toFixed(1)} pts`);
    FLEX_ELIGIBLE.forEach((pos) => {
      if (replacementLevels.FLEX < replacementLevels[pos]) {
        replacementLevels[pos] = replacementLevels.FLEX;
        debug.push(`${pos} replacement lowered to FLEX level`);
      }
    });
  }

  const playerPAR = {};
  Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
    const pos = normalizePosition(allPlayersData[playerId]?.position, playerId);
    if (!pos) return;
    const repLevel = replacementLevels[pos] ?? 0;
    const info = allPlayersData[playerId];
    playerPAR[playerId] = {
      position: pos, totalPts, replacementLevel: repLevel, par: totalPts - repLevel,
      name: info?.full_name || (info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : null) || `Player ${playerId}`
    };
  });

  debug.push(`Built PAR entries for ${Object.keys(playerPAR).length} players.`);
  return { replacementLevels, replacementPlayerIds, replacementPlayerNames, playerPAR, slots, numTeams, debug };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Gets a player's actual points for specific week numbers, independent of
 * which roster they were on. Used for both trade and waiver baseline lookups.
 */
function getActualPointsForWeeks(playerResults, playerId, txYear, weekNums) {
  if (!playerId || !weekNums || weekNums.length === 0) {
    return { total: 0, byWeek: {} };
  }
  const weekSet = new Set(weekNums.map(Number));
  const byWeek = {};
  weekNums.forEach((w) => { byWeek[Number(w)] = 0; });

  (playerResults || []).forEach((pr) => {
    if (String(pr.playerId) !== String(playerId)) return;
    if (Number(pr.year) !== Number(txYear)) return;
    const w = Number(pr.week);
    if (!weekSet.has(w)) return;
    byWeek[w] = (byWeek[w] || 0) + (pr.pointsTotal || 0);
  });

  const total = Object.values(byWeek).reduce((s, v) => s + v, 0);
  return { total, byWeek };
}

/**
 * Identifies the marginal starter to use as trade baseline.
 *
 * Finds all players at this position on this roster in pre-trade weeks,
 * ranks them by total pre-trade points, and selects the Nth best
 * (N = dedicated starter slots). This is the last guaranteed starter —
 * the player who would have filled that position without the trade.
 *
 * Returns the player ID and full pre-trade context for UI display.
 */
function getMarginalStarterInfo(playerResults, roster, position, txYear, txWeek, parTables, allPlayersData) {
  const dedicatedSlots = parTables.slots?.[position] || 1;
  const weeksBeforeTrade = Number(txWeek) - 1;

  // Fallback info using league replacement player
  const leagueRepId = parTables.replacementPlayerIds?.[position];
  const leagueRepName = parTables.replacementPlayerNames?.[position] || '(league replacement)';

  if (weeksBeforeTrade < 1) {
    return {
      marginalPlayerId: leagueRepId,
      marginalPlayerName: leagueRepName,
      marginalRank: null,
      marginalPreTradeTotal: null,
      weeksBeforeTrade,
      dedicatedSlots,
      source: 'league (week 1 trade — no pre-trade data)',
      allPlayersPreTrade: []
    };
  }

  // Aggregate pre-trade totals per player at this position on this roster
  const preTradeTotals = {};
  playerResults
    .filter((pr) =>
      Number(pr.rosterId) === Number(roster) &&
      Number(pr.year) === Number(txYear) &&
      Number(pr.week) < Number(txWeek)
    )
    .forEach((pr) => {
      const pos = normalizePosition(allPlayersData[String(pr.playerId)]?.position, pr.playerId);
      if (pos !== position) return;
      const id = String(pr.playerId);
      if (!preTradeTotals[id]) preTradeTotals[id] = 0;
      preTradeTotals[id] += pr.pointsTotal || 0;
    });

  const sortedPlayers = Object.entries(preTradeTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([pid, pts]) => {
      const info = allPlayersData[pid];
      return {
        playerId: pid,
        name: info?.full_name || (info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : null) || `Player ${pid}`,
        preTradeTotal: pts
      };
    });

  if (sortedPlayers.length === 0) {
    return {
      marginalPlayerId: leagueRepId,
      marginalPlayerName: leagueRepName,
      marginalRank: null,
      marginalPreTradeTotal: null,
      weeksBeforeTrade,
      dedicatedSlots,
      source: 'league (no pre-trade players found at this position)',
      allPlayersPreTrade: []
    };
  }

  // Nth best player = marginal starter (last guaranteed starter slot)
  const marginalIdx = Math.min(dedicatedSlots - 1, sortedPlayers.length - 1);
  const marginal = sortedPlayers[marginalIdx];

  return {
    marginalPlayerId: marginal.playerId,
    marginalPlayerName: marginal.name,
    marginalRank: marginalIdx + 1,
    marginalPreTradeTotal: marginal.preTradeTotal,
    weeksBeforeTrade,
    dedicatedSlots,
    source: 'personal',
    allPlayersPreTrade: sortedPlayers  // full list for UI validation
  };
}

function buildTradeNarrative({ side0, side1, parDifference, winner, managerNames, hasDraftPicks }) {
  const flags = [];
  [...(side0.players || []), ...(side1.players || [])].forEach((p) => {
    if (p.weeks <= 2 && p.totalPts < 10) flags.push({ type: 'injury-suspected', name: p.name });
    else if (p.weeks > 2 && p.startedPct < 0.5) flags.push({ type: 'underutilized', name: p.name });
  });

  let grade;
  if (winner === null)          grade = 'even';
  else if (parDifference > 40)  grade = 'lopsided';
  else if (parDifference > 20)  grade = 'clear';
  else                           grade = 'close';

  const winnerName = winner === 0 ? managerNames[0] : winner === 1 ? managerNames[1] : null;
  const loserName  = winner === 0 ? managerNames[1] : winner === 1 ? managerNames[0] : null;
  const winnerPAR  = winner === 0 ? side0.parTotal  : side1.parTotal;
  const loserPAR   = winner === 0 ? side1.parTotal  : side0.parTotal;

  let summary;
  switch (grade) {
    case 'even':     summary = `Essentially a wash — both sides extracted similar value vs their marginal starters.`; break;
    case 'lopsided': summary = `${winnerName} dominated — ${winnerPAR.toFixed(1)} PAR vs ${loserName}'s ${loserPAR.toFixed(1)}.`; break;
    case 'clear':    summary = `${winnerName} came out clearly ahead — ${winnerPAR.toFixed(1)} vs ${loserPAR.toFixed(1)} PAR.`; break;
    case 'close':    summary = `Close trade — ${winnerName} edged ${loserName} ${winnerPAR.toFixed(1)} to ${loserPAR.toFixed(1)} PAR.`; break;
  }

  const injuryFlag = flags.find((f) => f.type === 'injury-suspected');
  const utilFlag   = flags.find((f) => f.type === 'underutilized');
  if (injuryFlag)    summary += ` Note: ${injuryFlag.name} may have been injured.`;
  else if (utilFlag) summary += ` Note: ${utilFlag.name} was underutilized.`;
  if (hasDraftPicks) summary += ' Includes draft picks — grade reflects player value only.';

  return { grade, flags, summary };
}

const _fp = (val) => typeof val === 'number' ? val.toFixed(1) : '0.0';

// ── Public grading functions ─────────────────────────────────────────────────

/**
 * Grades a 2-team trade by comparing each acquired player's actual points
 * during their hold weeks against the marginal starter's actual points
 * during those same weeks. No projections used.
 */
export function gradeTradeByPAR(trade, parTables, playerResults, allPlayersData, managerNames = []) {
  if (!trade.moves || !trade.rosters || trade.rosters.length !== 2) return null;
  if (!parTables) return null;

  const rosters = trade.rosters;
  const txYear  = Number(trade.seasonKey || trade.season);
  const txWeek  = Number(trade.leg || 1);

  const hasDraftPicks = (trade.moves || []).some((move) =>
    Array.isArray(move) && move.some((s) => s && typeof s === 'object' && s.type === 'Received Pick')
  );

  const received = {};
  rosters.forEach((r) => (received[r] = []));
  trade.moves.forEach((move) => {
    if (!Array.isArray(move)) return;
    move.forEach((side, idx) => {
      const roster = rosters[idx];
      if (!roster || !side || typeof side !== 'object') return;
      if (side.type === 'trade' && side.player) received[roster].push(side.player);
    });
  });

  const gradeByRoster = {};

  rosters.forEach((roster) => {
    const acquiredPlayers = received[roster] || [];
    let parTotal = 0, rawTotal = 0, rawStarted = 0;
    const players = [];

    acquiredPlayers.forEach((playerId) => {
      const playerInfo = allPlayersData[String(playerId)];
      const position   = normalizePosition(playerInfo?.position, playerId);

      // Actual hold weeks: weeks this player appeared on THIS roster after trade
      const holdRows = (playerResults || []).filter((pr) =>
        String(pr.playerId)  === String(playerId) &&
        Number(pr.rosterId)  === Number(roster) &&
        Number(pr.year)      === txYear &&
        Number(pr.week)      >= txWeek
      ).sort((a, b) => a.week - b.week);

      const holdWeekNums    = holdRows.map((pr) => Number(pr.week));
      const playerRawTotal  = holdRows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
      const playerStarted   = holdRows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
      const weeksStarted    = holdRows.filter((pr) => pr.pointsStarted > 0).length;

      // Identify the marginal starter
      const marginalInfo = getMarginalStarterInfo(
        playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
      );

      // Get marginal player's ACTUAL points during the SAME hold weeks
      const { total: marginalActualPts, byWeek: marginalByWeek } =
        getActualPointsForWeeks(playerResults, marginalInfo.marginalPlayerId, txYear, holdWeekNums);

      const playerPAR = playerRawTotal - marginalActualPts;
      parTotal   += playerPAR;
      rawTotal   += playerRawTotal;
      rawStarted += playerStarted;

      // Per-week breakdown for validation
      const weekBreakdown = holdWeekNums.map((week) => ({
        week,
        acquiredPts:  holdRows.find((r) => Number(r.week) === week)?.pointsTotal  || 0,
        acquiredStarted: holdRows.find((r) => Number(r.week) === week)?.pointsStarted || 0,
        marginalPts:  marginalByWeek[week] || 0,
        weekPAR:      (holdRows.find((r) => Number(r.week) === week)?.pointsTotal || 0) - (marginalByWeek[week] || 0)
      }));

      players.push({
        playerId,
        name:                  parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
        position:              position || '?',
        par:                   playerPAR,
        totalPts:              playerRawTotal,
        startedPts:            playerStarted,
        weeks:                 holdRows.length,
        weeksStarted,
        startedPct:            holdRows.length > 0 ? weeksStarted / holdRows.length : 0,
        holdWeekNums,
        weekBreakdown,
        // Full baseline info for UI validation
        baselineTotal:         marginalActualPts,
        baselineSource:        marginalInfo.source,
        marginalPlayerId:      marginalInfo.marginalPlayerId,
        marginalPlayerName:    marginalInfo.marginalPlayerName,
        marginalRank:          marginalInfo.marginalRank,
        marginalPreTradeTotal: marginalInfo.marginalPreTradeTotal,
        dedicatedSlots:        marginalInfo.dedicatedSlots,
        weeksBeforeTrade:      marginalInfo.weeksBeforeTrade,
        allPlayersPreTrade:    marginalInfo.allPlayersPreTrade // full roster at position pre-trade
      });
    });

    gradeByRoster[roster] = { parTotal, rawTotal, rawStarted, players };
  });

  const side0 = { ...gradeByRoster[rosters[0]], roster: rosters[0] };
  const side1 = { ...gradeByRoster[rosters[1]], roster: rosters[1] };
  (side0.players || []).forEach((p) => { p.side = 0; });
  (side1.players || []).forEach((p) => { p.side = 1; });

  let winner = null;
  const parDifference = Math.abs(side0.parTotal - side1.parTotal);
  if (side0.parTotal > side1.parTotal)      winner = 0;
  else if (side1.parTotal > side0.parTotal) winner = 1;

  const narrative = buildTradeNarrative({ side0, side1, parDifference, winner, managerNames, hasDraftPicks });
  return { side0, side1, winner, parDifference, narrative, hasDraftPicks, txYear, txWeek };
}

/**
 * Grades a waiver pickup by comparing its actual production during hold weeks
 * against the worst starter's (replacement level player) actual production
 * during those same weeks.
 *
 * PAR > 0  = pickup outperformed replacement = helped the team
 * PAR < 0  = pickup underperformed replacement = didn't help
 * PAR ≈ 0  = roughly break-even
 */
export function gradeWaiverByPAR(waiver, parTables, playerResults, allPlayersData) {
  if (!waiver.moves || !waiver.rosters?.[0]) return null;
  if (!parTables) return null;

  const roster  = waiver.rosters[0];
  const txYear  = Number(waiver.seasonKey || waiver.season);
  const txWeek  = Number(waiver.leg || 1);

  let playerId = null, droppedId = null;
  waiver.moves.forEach((move) => {
    if (!Array.isArray(move)) return;
    move.forEach((side) => {
      if (!side || typeof side !== 'object') return;
      if (side.type === 'Added'   && side.player) playerId  = side.player;
      if (side.type === 'Dropped' && side.player) droppedId = side.player;
    });
  });

  if (!playerId) return null;

  const playerInfo = allPlayersData[String(playerId)];
  const position   = normalizePosition(playerInfo?.position, playerId);

  // Actual hold weeks on this roster
  const pickupRows = (playerResults || []).filter((pr) =>
    String(pr.playerId)  === String(playerId) &&
    Number(pr.rosterId)  === Number(roster) &&
    Number(pr.year)      === txYear &&
    Number(pr.week)      >= txWeek
  ).sort((a, b) => a.week - b.week);

  const holdWeekNums  = pickupRows.map((pr) => Number(pr.week));
  const totalPts      = pickupRows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
  const startedPts    = pickupRows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
  const weeksHeld     = pickupRows.length;
  const weeksStarted  = pickupRows.filter((pr) => pr.pointsStarted > 0).length;
  const isStream      = weeksHeld <= 2;

  // Replacement level player — the Nth best at this position across the league
  const replacementPlayerId   = parTables.replacementPlayerIds?.[position];
  const replacementPlayerName = parTables.replacementPlayerNames?.[position] || '(none)';
  const replacementSeasonPts  = parTables.replacementLevels?.[position] || 0;

  // Get replacement player's ACTUAL points during the SAME hold weeks
  const { total: replacementActualPts, byWeek: replacementByWeek } =
    getActualPointsForWeeks(playerResults, replacementPlayerId, txYear, holdWeekNums);

  const par = totalPts - replacementActualPts;

  // Per-week breakdown for validation
  const weekBreakdown = holdWeekNums.map((week) => ({
    week,
    pickupPts:      pickupRows.find((r) => Number(r.week) === week)?.pointsTotal  || 0,
    pickupStarted:  pickupRows.find((r) => Number(r.week) === week)?.pointsStarted || 0,
    replacementPts: replacementByWeek[week] || 0,
    weekPAR:        (pickupRows.find((r) => Number(r.week) === week)?.pointsTotal || 0) - (replacementByWeek[week] || 0)
  }));

  // Grade based on PAR vs replacement
  let gradeLabel, gradeSummary;
  if (par > 30) {
    gradeLabel   = 'elite';
    gradeSummary = `Elite pickup — scored ${_fp(totalPts)} vs replacement's ${_fp(replacementActualPts)} over ${weeksHeld} week(s) (+${_fp(par)} PAR).`;
  } else if (par > 15) {
    gradeLabel   = 'strong';
    gradeSummary = `Strong pickup — clearly above replacement level over ${weeksHeld} week(s) (+${_fp(par)} PAR).`;
  } else if (par > 5) {
    gradeLabel   = 'solid';
    gradeSummary = `Solid pickup — modestly above replacement (+${_fp(par)} PAR over ${weeksHeld} week(s)).`;
  } else if (par >= -5) {
    gradeLabel   = 'breakeven';
    gradeSummary = `Break-even — roughly replacement level (${_fp(par)} PAR over ${weeksHeld} week(s)).`;
  } else {
    gradeLabel   = 'poor';
    gradeSummary = `Below replacement — the replacement player outscored this pickup by ${_fp(Math.abs(par))} pts.`;
  }

  if (isStream) gradeSummary += ` (Streamed — held ${weeksHeld} week(s) only.)`;

  const droppedInfo = droppedId ? allPlayersData[String(droppedId)] : null;

  return {
    playerId,
    name:                  parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
    position:              position || '?',
    par,
    totalPts,
    startedPts,
    weeks:                 weeksHeld,
    weeksStarted,
    startedPct:            weeksHeld > 0 ? weeksStarted / weeksHeld : 0,
    isStream,
    holdWeekNums,
    weekBreakdown,
    // Replacement info for validation
    replacementPlayerId,
    replacementPlayerName,
    replacementSeasonPts,  // their full-season total (for context)
    replacementActualPts,  // what they actually scored during hold weeks
    gradeLabel,
    gradeSummary,
    droppedId,
    droppedName: droppedInfo?.full_name || (droppedId ? `Player ${droppedId}` : null),
    txYear,
    txWeek
  };
}

export function gradeCompositeTrade(compositeTrade, parTables, playerResults, allPlayersData) {
  if (!compositeTrade.isComposite || !parTables || !compositeTrade.teams) return null;

  const txYear = Number(compositeTrade.seasonKey || compositeTrade.season);
  const txWeek = Number(compositeTrade.leg || 1);

  const teamGrades = compositeTrade.teams.map((team) => {
    const { roster, managerId, netReceived } = team;
    let parTotal = 0, rawTotal = 0, rawStarted = 0;
    const players = [];

    (netReceived || []).forEach((playerId) => {
      const playerInfo  = allPlayersData[String(playerId)];
      const position    = normalizePosition(playerInfo?.position, playerId);
      const marginalInfo = getMarginalStarterInfo(
        playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
      );

      const holdRows = (playerResults || []).filter((pr) =>
        String(pr.playerId) === String(playerId) &&
        Number(pr.rosterId) === Number(roster) &&
        Number(pr.year)     === txYear &&
        Number(pr.week)     >= txWeek
      ).sort((a, b) => a.week - b.week);

      const holdWeekNums   = holdRows.map((pr) => Number(pr.week));
      const playerTotal    = holdRows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
      const playerStarted  = holdRows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
      const weeksStarted   = holdRows.filter((pr) => pr.pointsStarted > 0).length;

      const { total: marginalActualPts, byWeek: marginalByWeek } =
        getActualPointsForWeeks(playerResults, marginalInfo.marginalPlayerId, txYear, holdWeekNums);

      const playerPAR = playerTotal - marginalActualPts;
      parTotal   += playerPAR;
      rawTotal   += playerTotal;
      rawStarted += playerStarted;

      const weekBreakdown = holdWeekNums.map((week) => ({
        week,
        acquiredPts:  holdRows.find((r) => Number(r.week) === week)?.pointsTotal || 0,
        marginalPts:  marginalByWeek[week] || 0,
        weekPAR:      (holdRows.find((r) => Number(r.week) === week)?.pointsTotal || 0) - (marginalByWeek[week] || 0)
      }));

      players.push({
        playerId,
        name:               parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
        position:           position || '?',
        par:                playerPAR,
        totalPts:           playerTotal,
        startedPts:         playerStarted,
        weeks:              holdRows.length,
        weeksStarted,
        holdWeekNums,
        weekBreakdown,
        baselineTotal:      marginalActualPts,
        marginalPlayerName: marginalInfo.marginalPlayerName,
        marginalRank:       marginalInfo.marginalRank,
        baselineSource:     marginalInfo.source
      });
    });

    return { roster, managerId, parTotal, rawTotal, rawStarted, players };
  });

  const ranked       = [...teamGrades].sort((a, b) => b.parTotal - a.parTotal);
  const winnerRoster = ranked[0]?.parTotal !== ranked[1]?.parTotal ? ranked[0]?.roster : null;

  return { teamGrades, ranked, winnerRoster, isComposite: true, hasDraftPicks: compositeTrade.hasDraftPicks, txYear, txWeek };
}
