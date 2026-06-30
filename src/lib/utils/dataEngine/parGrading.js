// parGrading.js
//
// Unified PAR (Points Above Replacement) for trades, waivers, and drafts.
//
// Replacement level = the Nth-best player at that position by full-season
// points, where N = numTeams × dedicatedSlots.
//
// FLEX HANDLING: RB and WR replacement levels also consider a combined
// RB+WR flex pool (TE excluded — flex is rarely used for TE in practice).
// The flex pool's cutoff rank = (RBslots + WRslots + FLEXslots + 1) × numTeams.
// Whichever bar is LOWER (easier to clear) — the position-specific bar or
// the flex-pool bar — becomes the actual replacement level for that position,
// since a player only needs to clear the easiest path to be rosterable.
//
// K and DEF do not participate in flex at all.

const TOTAL_SEASON_WEEKS = 17;

// Fixed dedicated starter slots — same for all years. FLEX handled separately above.
const DEDICATED_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };

// FLEX slot count per season — RB/WR/TE flex slots from league settings,
// but only RB+WR participate in the flex POOL calculation per league convention.
const FLEX_SLOTS_BY_YEAR = {
  '2023': 1
  // 2024 and all later seasons default to 2 (see getFlexSlotsForYear)
};

export function getFlexSlotsForYear(year) {
  return FLEX_SLOTS_BY_YEAR[String(year)] ?? 2;
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

function playerDisplayName(info, playerId) {
  return info?.full_name ||
    (info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : null) ||
    `Player ${playerId}`;
}

// ── Season PAR tables ────────────────────────────────────────────────────────

/**
 * Builds replacement level data for one season, including the RB/WR flex
 * pool adjustment.
 *
 * @param {Object} seasonStatTotals - { [playerId]: totalSeasonPts } from getSeasonStatTotals()
 * @param {Object} allPlayersData   - full Sleeper player map
 * @param {number} numTeams         - number of teams in the league that season
 * @param {number} flexSlots        - number of FLEX slots that season (use getFlexSlotsForYear)
 */
export function buildSeasonPARTables(seasonStatTotals, allPlayersData, numTeams, flexSlots = 2) {
  const debug = [];
  debug.push(`Building PAR tables — numTeams: ${numTeams}, dedicated slots: ${JSON.stringify(DEDICATED_SLOTS)}, FLEX slots: ${flexSlots} (RB/WR pool only, TE excluded)`);

  // Group players by position, sorted descending by season total
  const playersByPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };

  Object.entries(seasonStatTotals || {}).forEach(([playerId, totalPts]) => {
    if (!totalPts || totalPts <= 0) return;
    const pos = normalizePosition(allPlayersData[playerId]?.position, playerId);
    if (!pos || !playersByPosition[pos]) return;
    playersByPosition[pos].push({ playerId, totalPts });
  });

  Object.values(playersByPosition).forEach((g) => g.sort((a, b) => b.totalPts - a.totalPts));

  // ── Dedicated-slot replacement levels (position-specific bar) ──────────────
  const dedicatedLevels      = {};
  const dedicatedPlayerIds   = {};
  const dedicatedPlayerNames = {};

  Object.entries(DEDICATED_SLOTS).forEach(([pos, slots]) => {
    const starterCount = slots * numTeams;
    const repEntry = playersByPosition[pos]?.[starterCount];
    const repInfo  = repEntry ? allPlayersData[repEntry.playerId] : null;

    dedicatedLevels[pos]      = repEntry ? repEntry.totalPts : 0;
    dedicatedPlayerIds[pos]   = repEntry ? repEntry.playerId : null;
    dedicatedPlayerNames[pos] = repEntry ? playerDisplayName(repInfo, repEntry.playerId) : '(none)';

    const rank = starterCount + 1;
    debug.push(
      `${pos} (dedicated): ${slots} slots × ${numTeams} teams = #${rank} ranked — ` +
      `${dedicatedPlayerNames[pos]} (${(dedicatedLevels[pos] || 0).toFixed(1)} pts)`
    );
  });

  // ── FLEX pool replacement level (combined RB+WR, TE excluded) ──────────────
  const flexPool = [];
  ['RB', 'WR'].forEach((pos) => {
    playersByPosition[pos].forEach((p) => flexPool.push({ ...p, position: pos }));
  });
  flexPool.sort((a, b) => b.totalPts - a.totalPts);

  // rank = (RBslots + WRslots + FLEXslots + 1 buffer) × numTeams
  const flexSlotsCount = DEDICATED_SLOTS.RB + DEDICATED_SLOTS.WR + flexSlots + 1;
  const flexRankIdx    = (flexSlotsCount * numTeams) - 1; // 0-based index for the Nth player
  const flexRepEntry   = flexPool[flexRankIdx];
  const flexRepInfo    = flexRepEntry ? allPlayersData[flexRepEntry.playerId] : null;
  const flexLevel       = flexRepEntry ? flexRepEntry.totalPts : 0;
  const flexPlayerName  = flexRepEntry ? playerDisplayName(flexRepInfo, flexRepEntry.playerId) : '(none)';

  debug.push(
    `FLEX pool (RB+WR only): slotsCount = ${DEDICATED_SLOTS.RB}+${DEDICATED_SLOTS.WR}+${flexSlots}+1 = ${flexSlotsCount}, ` +
    `× ${numTeams} teams = #${flexSlotsCount * numTeams} ranked — ` +
    `${flexPlayerName} (${flexLevel.toFixed(1)} pts)`
  );

  // ── Final replacement levels: lower of dedicated vs flex bar wins ──────────
  const replacementLevels      = { ...dedicatedLevels };
  const replacementPlayerIds   = { ...dedicatedPlayerIds };
  const replacementPlayerNames = { ...dedicatedPlayerNames };

  ['RB', 'WR'].forEach((pos) => {
    if (flexLevel < dedicatedLevels[pos]) {
      replacementLevels[pos]      = flexLevel;
      replacementPlayerIds[pos]   = flexRepEntry?.playerId ?? null;
      replacementPlayerNames[pos] = flexPlayerName;
      debug.push(`${pos} replacement LOWERED to FLEX-pool level: ${flexLevel.toFixed(1)} pts (was ${dedicatedLevels[pos].toFixed(1)} pts dedicated-only)`);
    } else {
      debug.push(`${pos} replacement kept at dedicated-slot level: ${dedicatedLevels[pos].toFixed(1)} pts (flex pool was higher/equal at ${flexLevel.toFixed(1)} pts)`);
    }
  });

  // K and DEF never participate in flex — already correct in dedicatedLevels.

  // Per-player full-season PAR for reference
  const playerPAR = {};
  Object.entries(seasonStatTotals || {}).forEach(([playerId, totalPts]) => {
    if (!totalPts || totalPts <= 0) return;
    const pos = normalizePosition(allPlayersData[playerId]?.position, playerId);
    if (!pos || replacementLevels[pos] == null) return;
    const info = allPlayersData[playerId];
    playerPAR[playerId] = {
      position:         pos,
      totalPts,
      replacementLevel: replacementLevels[pos],
      par:              totalPts - replacementLevels[pos],
      name:             playerDisplayName(info, playerId)
    };
  });

  debug.push(`Built PAR entries for ${Object.keys(playerPAR).length} players.`);

  return {
    replacementLevels,
    replacementPlayerIds,
    replacementPlayerNames,
    dedicatedLevels,    // exposed for debugging/validation
    flexLevel,
    flexPlayerName,
    playerPAR,
    numTeams,
    flexSlots,
    debug
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function proratedBaseline(replacementSeasonTotal, weeksHeld) {
  return (replacementSeasonTotal / TOTAL_SEASON_WEEKS) * weeksHeld;
}

function getPlayerHoldData(playerResults, playerId, roster, txYear, txWeek) {
  const rows = (playerResults || [])
    .filter((pr) =>
      String(pr.playerId)  === String(playerId) &&
      Number(pr.rosterId)  === Number(roster)   &&
      Number(pr.year)      === Number(txYear)   &&
      Number(pr.week)      >= Number(txWeek)
    )
    .sort((a, b) => a.week - b.week);

  const totalPts     = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
  const startedPts   = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
  const weeksHeld    = rows.length;
  const weeksStarted = rows.filter((pr) => pr.pointsStarted > 0).length;

  return { rows, totalPts, startedPts, weeksHeld, weeksStarted };
}

function buildTradeNarrative({ side0, side1, parDifference, winner, managerNames, hasDraftPicks }) {
  const flags = [];
  [...(side0.players || []), ...(side1.players || [])].forEach((p) => {
    if (p.weeksHeld <= 2 && p.totalPts < 10) flags.push({ type: 'injury-suspected', name: p.name });
    else if (p.weeksHeld > 2 && p.startedPct < 0.5) flags.push({ type: 'underutilized', name: p.name });
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
    case 'even':     summary = `Essentially a wash — both sides extracted similar value above replacement.`; break;
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

// ── Public grading functions ─────────────────────────────────────────────────

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
    let parTotal = 0, rawTotal = 0, rawStarted = 0;
    const players = [];

    (received[roster] || []).forEach((playerId) => {
      const playerInfo = allPlayersData[String(playerId)];
      const position   = normalizePosition(playerInfo?.position, playerId);

      const { rows, totalPts, startedPts, weeksHeld, weeksStarted } =
        getPlayerHoldData(playerResults, playerId, roster, txYear, txWeek);

      const repSeasonTotal = parTables.replacementLevels?.[position] ?? 0;
      const repName        = parTables.replacementPlayerNames?.[position] ?? '(none)';
      const repPerWeek     = repSeasonTotal / TOTAL_SEASON_WEEKS;
      const baseline       = proratedBaseline(repSeasonTotal, weeksHeld);
      const par            = totalPts - baseline;

      parTotal   += par;
      rawTotal   += totalPts;
      rawStarted += startedPts;

      const weekBreakdown = rows.map((row) => ({
        week:        Number(row.week),
        playerPts:   row.pointsTotal   || 0,
        startedPts:  row.pointsStarted || 0,
        repBaseline: repPerWeek,
        weekPAR:     (row.pointsTotal  || 0) - repPerWeek
      }));

      players.push({
        playerId,
        name:          parTables.playerPAR[String(playerId)]?.name || playerDisplayName(playerInfo, playerId),
        position:      position || '?',
        par,
        totalPts,
        startedPts,
        weeksHeld,
        weeksStarted,
        startedPct:    weeksHeld > 0 ? weeksStarted / weeksHeld : 0,
        baseline,
        repSeasonTotal,
        repPerWeek,
        repName,
        weekBreakdown
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

export function gradeWaiverByPAR(waiver, parTables, playerResults, allPlayersData) {
  if (!waiver.moves || !waiver.rosters?.[0]) return null;
  if (!parTables) return null;

  const roster = waiver.rosters[0];
  const txYear = Number(waiver.seasonKey || waiver.season);
  const txWeek = Number(waiver.leg || 1);

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

  const { rows, totalPts, startedPts, weeksHeld, weeksStarted } =
    getPlayerHoldData(playerResults, playerId, roster, txYear, txWeek);

  const repSeasonTotal = parTables.replacementLevels?.[position] ?? 0;
  const repName        = parTables.replacementPlayerNames?.[position] ?? '(none)';
  const repPerWeek     = repSeasonTotal / TOTAL_SEASON_WEEKS;
  const baseline       = proratedBaseline(repSeasonTotal, weeksHeld);
  const par            = totalPts - baseline;
  const isStream       = weeksHeld <= 2;

  const weekBreakdown = rows.map((row) => ({
    week:        Number(row.week),
    playerPts:   row.pointsTotal   || 0,
    startedPts:  row.pointsStarted || 0,
    repBaseline: repPerWeek,
    weekPAR:     (row.pointsTotal  || 0) - repPerWeek
  }));

  let gradeLabel, gradeSummary;
  if (par > 30) {
    gradeLabel   = 'elite';
    gradeSummary = `Elite pickup — ${totalPts.toFixed(1)} pts vs ${baseline.toFixed(1)} baseline over ${weeksHeld} wk(s) (+${par.toFixed(1)} PAR).`;
  } else if (par > 15) {
    gradeLabel   = 'strong';
    gradeSummary = `Strong pickup — clearly above replacement over ${weeksHeld} wk(s) (+${par.toFixed(1)} PAR).`;
  } else if (par > 5) {
    gradeLabel   = 'solid';
    gradeSummary = `Solid pickup — modestly above replacement over ${weeksHeld} wk(s) (+${par.toFixed(1)} PAR).`;
  } else if (par >= -5) {
    gradeLabel   = 'breakeven';
    gradeSummary = `Break-even — roughly replacement level over ${weeksHeld} wk(s) (${par.toFixed(1)} PAR).`;
  } else {
    gradeLabel   = 'poor';
    gradeSummary = `Below replacement — underperformed by ${Math.abs(par).toFixed(1)} pts vs replacement over ${weeksHeld} wk(s).`;
  }

  if (isStream) gradeSummary += ` Streamed (held ${weeksHeld} wk(s) only).`;

  const droppedInfo = droppedId ? allPlayersData[String(droppedId)] : null;

  return {
    playerId,
    name:          parTables.playerPAR[String(playerId)]?.name || playerDisplayName(playerInfo, playerId),
    position:      position || '?',
    par,
    totalPts,
    startedPts,
    weeksHeld,
    weeksStarted,
    startedPct:    weeksHeld > 0 ? weeksStarted / weeksHeld : 0,
    isStream,
    baseline,
    repSeasonTotal,
    repPerWeek,
    repName,
    weekBreakdown,
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
      const playerInfo = allPlayersData[String(playerId)];
      const position   = normalizePosition(playerInfo?.position, playerId);

      const { rows, totalPts, startedPts, weeksHeld, weeksStarted } =
        getPlayerHoldData(playerResults, playerId, roster, txYear, txWeek);

      const repSeasonTotal = parTables.replacementLevels?.[position] ?? 0;
      const repName        = parTables.replacementPlayerNames?.[position] ?? '(none)';
      const repPerWeek     = repSeasonTotal / TOTAL_SEASON_WEEKS;
      const baseline       = proratedBaseline(repSeasonTotal, weeksHeld);
      const par            = totalPts - baseline;

      parTotal   += par;
      rawTotal   += totalPts;
      rawStarted += startedPts;

      const weekBreakdown = rows.map((row) => ({
        week:        Number(row.week),
        playerPts:   row.pointsTotal   || 0,
        startedPts:  row.pointsStarted || 0,
        repBaseline: repPerWeek,
        weekPAR:     (row.pointsTotal  || 0) - repPerWeek
      }));

      players.push({
        playerId,
        name:          parTables.playerPAR[String(playerId)]?.name || playerDisplayName(playerInfo, playerId),
        position:      position || '?',
        par,
        totalPts,
        startedPts,
        weeksHeld,
        weeksStarted,
        baseline,
        repSeasonTotal,
        repPerWeek,
        repName,
        weekBreakdown
      });
    });

    return { roster, managerId, parTotal, rawTotal, rawStarted, players };
  });

  const ranked       = [...teamGrades].sort((a, b) => b.parTotal - a.parTotal);
  const winnerRoster = ranked[0]?.parTotal !== ranked[1]?.parTotal ? ranked[0]?.roster : null;

  return {
    teamGrades, ranked, winnerRoster,
    isComposite: true, hasDraftPicks: compositeTrade.hasDraftPicks, txYear, txWeek
  };
}
