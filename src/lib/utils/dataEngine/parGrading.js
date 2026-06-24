// parGrading.js
//
// Points Above Replacement (PAR) grading for trades and waivers.
//
// TRADE GRADING: uses marginal starter baseline — the Nth best player
// already on the receiving roster at that position (where N = dedicated
// starter slots), projected forward at their pre-trade pace. This
// correctly answers "what would this team have started at this position
// if they hadn't made this move?" instead of penalizing them for not
// getting someone as good as their stud WR1.
//
// WAIVER GRADING: ranks the pickup among all players at the same position
// who were unrostered (available on the wire) that same week. "Was this
// the best available option?" is the right question — not how many raw
// points they scored.

const LEGACY_ROSTER_POSITIONS = {
  '2023': ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF',
           'BN','BN','BN','BN','BN','BN','BN'],
  '2024': ['QB','RB','RB','WR','WR','TE','FLEX','FLEX','K','DEF',
           'BN','BN','BN','BN','BN','BN']
};

export function getLeagueRosterPositions(year) {
  return LEGACY_ROSTER_POSITIONS[String(year)] || null;
}

const DEFAULT_ROSTER_POSITIONS = [
  'QB','RB','RB','WR','WR','TE','FLEX','K','DEF',
  'BN','BN','BN','BN','BN','BN','BN'
];

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
const TOTAL_POSSIBLE_WEEKS = 18;

// ── Position parsing ─────────────────────────────────────────────────────────

export function parseStarterSlots(rosterPositions) {
  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  (rosterPositions || DEFAULT_ROSTER_POSITIONS).forEach((pos) => {
    const p = pos.toUpperCase();
    if (p === 'SUPER_FLEX' || p === 'SUPERFLEX') slots.FLEX += 1;
    else if (slots[p] !== undefined) slots[p] += 1;
  });
  return slots;
}

function normalizePosition(position, playerId) {
  if (!position) {
    if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) return 'DEF';
    return null;
  }
  const p = position.toUpperCase();
  if (p === 'QB')            return 'QB';
  if (p === 'RB')            return 'RB';
  if (p === 'WR')            return 'WR';
  if (p === 'TE')            return 'TE';
  if (p === 'K')             return 'K';
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
  ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach((pos) => {
    const starterCount = (slots[pos] || 0) * numTeams;
    const repPlayer = playersByPosition[pos][starterCount];
    replacementLevels[pos] = repPlayer ? repPlayer.totalPts : 0;
    debug.push(`${pos}: ${starterCount} starter slots, replacement = ${(replacementLevels[pos] || 0).toFixed(1)} pts`);
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
        debug.push(`${pos} replacement lowered to FLEX level ${replacementLevels.FLEX.toFixed(1)}`);
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
      position: pos,
      totalPts,
      replacementLevel: repLevel,
      par: totalPts - repLevel,
      name: info?.full_name ||
        (info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : null) ||
        `Player ${playerId}`
    };
  });

  debug.push(`Built PAR entries for ${Object.keys(playerPAR).length} players.`);
  return { replacementLevels, playerPAR, slots, numTeams, debug };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function proratedReplacementPts(replacementLevel, txWeek) {
  const weeksRemaining = Math.max(TOTAL_POSSIBLE_WEEKS - Number(txWeek) + 1, 1);
  return replacementLevel * (weeksRemaining / TOTAL_POSSIBLE_WEEKS);
}

function isOnOrAfterTransaction(pr, txYear, txWeek) {
  if (Number(pr.year) !== Number(txYear)) return false;
  return Number(pr.week) >= Number(txWeek);
}

/**
 * TRADE BASELINE: the marginal starter at this position on this roster.
 *
 * Uses the Nth best pre-trade player at this position (N = dedicated starter
 * slots), projected forward at their pre-trade pace. This answers "what would
 * this manager have started at this position without the trade?" correctly —
 * comparing against the last guaranteed starter, not the stud WR1.
 *
 * Falls back to league replacement if:
 *   - No pre-trade players at this position exist (genuine hole)
 *   - Personal marginal projects below league replacement (backup is a nobody)
 *   - Trade happened in week 1 (no pre-trade data)
 */
function getMarginalStarterBaseline(playerResults, roster, position, txYear, txWeek, parTables, allPlayersData) {
  const leagueRepLevel = parTables?.replacementLevels?.[position] ?? 0;
  const proratedLeagueRep = proratedReplacementPts(leagueRepLevel, txWeek);

  if (Number(txWeek) <= 1) {
    return { baselineValue: proratedLeagueRep, baselineSource: 'league', marginalRank: null };
  }

  const dedicatedSlots = parTables.slots?.[position] || 0;

  // Aggregate pre-trade production per player at this position on this roster
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

  const sortedPoints = Object.values(preTradeTotals).sort((a, b) => b - a);

  if (sortedPoints.length === 0) {
    return { baselineValue: proratedLeagueRep, baselineSource: 'league', marginalRank: null };
  }

  // Nth best player = last dedicated starter. If fewer players than slots,
  // the last available player is the marginal one (they're already competing
  // for that final slot with no real backup).
  const marginalIdx = Math.min(dedicatedSlots - 1, sortedPoints.length - 1);
  const marginalTotal = sortedPoints[Math.max(marginalIdx, 0)];

  const weeksBeforeTrade = Number(txWeek) - 1;
  if (weeksBeforeTrade <= 0) {
    return { baselineValue: proratedLeagueRep, baselineSource: 'league', marginalRank: null };
  }

  const perWeekRate = marginalTotal / weeksBeforeTrade;
  const weeksRemaining = Math.max(TOTAL_POSSIBLE_WEEKS - Number(txWeek) + 1, 1);
  const projectedMarginal = perWeekRate * weeksRemaining;

  if (projectedMarginal > proratedLeagueRep) {
    return {
      baselineValue: projectedMarginal,
      baselineSource: 'personal',
      marginalRank: marginalIdx + 1
    };
  }
  return { baselineValue: proratedLeagueRep, baselineSource: 'league', marginalRank: marginalIdx + 1 };
}

/**
 * WAIVER AVAILABILITY POOL: all players at this position (and FLEX pool if
 * FLEX-eligible) who were unrostered that week but appeared somewhere in the
 * season — meaning they were relevant enough to be considered.
 *
 * "Unrostered" = player_id doesn't appear in ANY roster's playerResults
 * for the pickup week. The pickup itself is excluded from the available pool
 * (they were claimed, so they're already off the wire).
 */
function buildAvailabilityPool(playerResults, playerId, position, txYear, txWeek, allPlayersData) {
  const txYearNum  = Number(txYear);
  const txWeekNum  = Number(txWeek);
  const isFlexPos  = FLEX_ELIGIBLE.includes(position);

  // Who was rostered this week (any team)?
  const rosteredThisWeek = new Set(
    playerResults
      .filter((pr) => Number(pr.year) === txYearNum && Number(pr.week) === txWeekNum)
      .map((pr) => String(pr.playerId))
  );

  // All players who appeared in at least one roster this season
  const relevantThisSeason = new Set(
    playerResults
      .filter((pr) => Number(pr.year) === txYearNum)
      .map((pr) => String(pr.playerId))
  );

  // Points from pickup week onward, keyed by playerId
  const pointsAfterByPlayer = {};
  playerResults
    .filter((pr) => Number(pr.year) === txYearNum && Number(pr.week) >= txWeekNum)
    .forEach((pr) => {
      const id = String(pr.playerId);
      if (!pointsAfterByPlayer[id]) pointsAfterByPlayer[id] = 0;
      pointsAfterByPlayer[id] += pr.pointsTotal || 0;
    });

  const positionPool  = []; // same-position available players
  const flexPool      = []; // other FLEX-eligible positions (if applicable)

  relevantThisSeason.forEach((pid) => {
    if (rosteredThisWeek.has(pid)) return; // was rostered — not on wire
    if (pid === String(playerId))  return; // the pickup itself

    const info = allPlayersData[pid];
    const pos  = normalizePosition(info?.position, pid);
    if (!pos) return;

    const name        = info?.full_name || (info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : null) || `Player ${pid}`;
    const pointsAfter = pointsAfterByPlayer[pid] || 0;

    if (pos === position) {
      positionPool.push({ playerId: pid, name, position: pos, pointsAfter });
    } else if (isFlexPos && FLEX_ELIGIBLE.includes(pos)) {
      flexPool.push({ playerId: pid, name, position: pos, pointsAfter });
    }
  });

  positionPool.sort((a, b) => b.pointsAfter - a.pointsAfter);
  flexPool.sort((a, b) => b.pointsAfter - a.pointsAfter);

  return { positionPool, flexPool };
}

function buildTradeNarrative({ side0, side1, parDifference, winner, managerNames, hasDraftPicks }) {
  const flags = [];
  [...(side0.players || []), ...(side1.players || [])].forEach((p) => {
    if (p.weeks <= 2 && p.totalPts < 10) flags.push({ type: 'injury-suspected', name: p.name, side: p.side });
    else if (p.weeks > 2 && p.startedPct < 0.5) flags.push({ type: 'underutilized', name: p.name, side: p.side });
  });

  let grade;
  if (winner === null)        grade = 'even';
  else if (parDifference > 40) grade = 'lopsided';
  else if (parDifference > 20) grade = 'clear';
  else                          grade = 'close';

  const winnerName = winner === 0 ? managerNames[0] : winner === 1 ? managerNames[1] : null;
  const loserName  = winner === 0 ? managerNames[1] : winner === 1 ? managerNames[0] : null;
  const winnerPAR  = winner === 0 ? side0.parTotal  : side1.parTotal;
  const loserPAR   = winner === 0 ? side1.parTotal  : side0.parTotal;

  let summary;
  switch (grade) {
    case 'even':     summary = `This trade was essentially a wash — both sides extracted similar value above their marginal starters.`; break;
    case 'lopsided': summary = `${winnerName} dominated this trade, generating ${winnerPAR.toFixed(1)} marginal PAR vs ${loserName}'s ${loserPAR.toFixed(1)}.`; break;
    case 'clear':    summary = `${winnerName} came out clearly ahead — ${winnerPAR.toFixed(1)} PAR vs ${loserName}'s ${loserPAR.toFixed(1)}.`; break;
    case 'close':    summary = `Close trade — ${winnerName} edged ${loserName} ${winnerPAR.toFixed(1)} to ${loserPAR.toFixed(1)} in marginal PAR.`; break;
  }

  const injuryFlag = flags.find((f) => f.type === 'injury-suspected');
  const utilFlag   = flags.find((f) => f.type === 'underutilized');
  if (injuryFlag)  summary += ` Note: ${injuryFlag.name} may have been injured, which could affect this grade.`;
  else if (utilFlag) summary += ` Note: ${utilFlag.name} was underutilized despite being rostered.`;
  if (hasDraftPicks) summary += ' This trade included draft picks — grade reflects player value only.';

  const personalBaselines = [...(side0.players || []), ...(side1.players || [])]
    .filter((p) => p.baselineSource === 'personal');
  if (personalBaselines.length > 0) {
    summary += ` Baseline set from marginal starter on ${personalBaselines.length} player(s).`;
  }

  return { grade, flags, summary };
}

// ── Public grading functions ─────────────────────────────────────────────────

/**
 * Grades a 2-team trade using marginal starter PAR.
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

      const { baselineValue, baselineSource, marginalRank } = getMarginalStarterBaseline(
        playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
      );

      const rows = (playerResults || []).filter((pr) =>
        String(pr.playerId) === String(playerId) &&
        Number(pr.rosterId) === Number(roster) &&
        isOnOrAfterTransaction(pr, txYear, txWeek)
      );

      const playerRawTotal    = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
      const playerStartedPts  = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
      const weeksStarted      = rows.filter((pr) => pr.pointsStarted > 0).length;
      const playerPAR         = playerRawTotal - baselineValue;

      parTotal   += playerPAR;
      rawTotal   += playerRawTotal;
      rawStarted += playerStartedPts;

      players.push({
        playerId,
        name:          parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
        position:      position || '?',
        par:           playerPAR,
        baselineValue,
        baselineSource,
        marginalRank,
        totalPts:      playerRawTotal,
        startedPts:    playerStartedPts,
        weeks:         rows.length,
        weeksStarted,
        startedPct:    rows.length > 0 ? weeksStarted / rows.length : 0
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
 * Grades a waiver pickup by ranking it among all players at the same
 * position who were available on the wire that same week.
 *
 * "Available" = appeared somewhere in the season (relevant player) but
 * was NOT rostered on any team the week of the pickup.
 *
 * For FLEX-eligible positions (RB/WR/TE), also ranks against the full
 * combined FLEX pool so the AI can contextualize cross-position competition.
 */
export function gradeWaiverByPAR(waiver, parTables, playerResults, allPlayersData) {
  if (!waiver.moves || !waiver.rosters?.[0]) return null;
  if (!parTables) return null;

  const roster = waiver.rosters[0];
  const txYear = Number(waiver.seasonKey || waiver.season);
  const txWeek = Number(waiver.leg || 1);

  let playerId  = null;
  let droppedId = null;
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
  const isFlexPos  = FLEX_ELIGIBLE.includes(position);

  // Points this player scored from pickup week onward on this roster
  const pickupRows = (playerResults || []).filter((pr) =>
    String(pr.playerId)  === String(playerId) &&
    Number(pr.rosterId)  === Number(roster) &&
    isOnOrAfterTransaction(pr, txYear, txWeek)
  );
  const totalPts    = pickupRows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
  const startedPts  = pickupRows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
  const weeksHeld   = pickupRows.length;
  const weeksStarted = pickupRows.filter((pr) => pr.pointsStarted > 0).length;
  const isStream    = weeksHeld <= 2;

  // Build the availability pool
  const { positionPool, flexPool } = buildAvailabilityPool(
    playerResults, playerId, position, txYear, txWeek, allPlayersData
  );

  // Rank the pickup among the same-position pool (including itself)
  const fullPositionPool = [
    { playerId: String(playerId), name: playerInfo?.full_name || `Player ${playerId}`, pointsAfter: totalPts },
    ...positionPool
  ].sort((a, b) => b.pointsAfter - a.pointsAfter);

  const positionRank     = fullPositionPool.findIndex((p) => p.playerId === String(playerId)) + 1;
  const positionPoolSize = fullPositionPool.length;

  // FLEX rank: if position is FLEX-eligible, rank against all available FLEX players
  let flexRank = null;
  let flexPoolSize = null;
  if (isFlexPos) {
    const fullFlexPool = [
      { playerId: String(playerId), position, pointsAfter: totalPts },
      ...positionPool.map((p) => ({ ...p, position })),
      ...flexPool
    ].sort((a, b) => b.pointsAfter - a.pointsAfter);
    flexRank     = fullFlexPool.findIndex((p) => p.playerId === String(playerId)) + 1;
    flexPoolSize = fullFlexPool.length;
  }

  // Grade based on position rank and pool size
  const percentile = positionRank / positionPoolSize;
  let gradeLabel, gradeSummary;

  if (positionRank === 1) {
    gradeLabel   = 'elite';
    gradeSummary = `Best available ${position || '?'} on the wire that week — exactly the pickup you want to make.`;
  } else if (percentile <= 0.25) {
    gradeLabel   = 'strong';
    gradeSummary = `Ranked #${positionRank} of ${positionPoolSize} available ${position || '?'}s — a strong identification of value.`;
  } else if (percentile <= 0.5) {
    gradeLabel   = 'solid';
    gradeSummary = `Ranked #${positionRank} of ${positionPoolSize} available ${position || '?'}s — solid pickup, though better options were on the wire.`;
  } else {
    gradeLabel   = 'poor';
    gradeSummary = `Ranked #${positionRank} of ${positionPoolSize} available ${position || '?'}s — ${positionRank - 1} better option(s) were left on the wire.`;
  }

  if (isStream && positionRank === 1) {
    gradeSummary += ` Smart stream — correctly identified the best option for the week.`;
  } else if (isStream) {
    gradeSummary += ` Streamed for ${weeksHeld} week(s).`;
  }

  if (isFlexPos && flexRank != null && flexRank <= 3) {
    gradeSummary += ` Also ranked #${flexRank} of ${flexPoolSize} among all available FLEX-eligible players.`;
  }

  const injurySuspected = weeksHeld <= 2 && totalPts < 10 && txWeek < 14;
  if (injurySuspected) gradeSummary += ' Low production may be injury-related.';

  const droppedInfo = droppedId ? allPlayersData[String(droppedId)] : null;
  const topMissed   = positionPool.slice(0, 3).map((p) => ({
    playerId:   p.playerId,
    name:       p.name,
    pointsAfter: p.pointsAfter,
    position
  }));

  return {
    playerId,
    name:          parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
    position:      position || '?',
    positionRank,
    positionPoolSize,
    flexRank,
    flexPoolSize,
    totalPts,
    startedPts,
    weeks:         weeksHeld,
    weeksStarted,
    startedPct:    weeksHeld > 0 ? weeksStarted / weeksHeld : 0,
    isStream,
    gradeLabel,
    gradeSummary,
    droppedId,
    droppedName:   droppedInfo?.full_name || (droppedId ? `Player ${droppedId}` : null),
    topMissed,
    txYear,
    txWeek
  };
}

/**
 * Grades a composite (multi-team) trade using marginal starter PAR.
 * Pass-through players already cancelled out in allTransactions.js.
 */
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

      const { baselineValue, baselineSource, marginalRank } = getMarginalStarterBaseline(
        playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
      );

      const rows = (playerResults || []).filter((pr) =>
        String(pr.playerId)  === String(playerId) &&
        Number(pr.rosterId)  === Number(roster) &&
        isOnOrAfterTransaction(pr, txYear, txWeek)
      );

      const playerTotal   = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
      const playerStarted = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
      const weeksStarted  = rows.filter((pr) => pr.pointsStarted > 0).length;
      const playerPAR     = playerTotal - baselineValue;

      parTotal   += playerPAR;
      rawTotal   += playerTotal;
      rawStarted += playerStarted;

      players.push({
        playerId,
        name:          parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
        position:      position || '?',
        par:           playerPAR,
        baselineValue,
        baselineSource,
        marginalRank,
        totalPts:      playerTotal,
        startedPts:    playerStarted,
        weeks:         rows.length,
        weeksStarted,
        startedPct:    rows.length > 0 ? weeksStarted / rows.length : 0
      });
    });

    return { roster, managerId, parTotal, rawTotal, rawStarted, players };
  });

  const ranked      = [...teamGrades].sort((a, b) => b.parTotal - a.parTotal);
  const winnerRoster = ranked[0]?.parTotal !== ranked[1]?.parTotal ? ranked[0]?.roster : null;

  return {
    teamGrades,
    ranked,
    winnerRoster,
    isComposite:   true,
    hasDraftPicks: compositeTrade.hasDraftPicks,
    txYear,
    txWeek
  };
}
