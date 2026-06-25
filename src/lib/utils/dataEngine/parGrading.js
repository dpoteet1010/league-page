// parGrading.js
//
// Unified PAR (Points Above Replacement) grading for trades and waivers.
//
// Replacement level = the (numTeams × dedicatedSlotsAtPosition)th best
// player's full-season total at that position. FLEX is intentionally
// excluded — only dedicated starter slots count.
//
// Baseline = (replacementSeasonTotal / 17) × weeksHeld
//
// This prorates replacement fairly for both long-term trade acquisitions
// and short-term streams/waivers. A 2-week stream competes against 2 weeks
// of replacement, not a full season.
//
// weeksHeld = actual weeks the player appeared on that roster in
// playerResults after the transaction. Handles re-trades and drops
// automatically since the data naturally stops when the player leaves.

const TOTAL_SEASON_WEEKS = 17;

// Dedicated starter slots per position — same for all years.
// FLEX slots are intentionally ignored for replacement calculations.
const DEDICATED_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };

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

function playerName(info, playerId) {
  return info?.full_name ||
    (info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : null) ||
    `Player ${playerId}`;
}

// ── Season PAR tables ────────────────────────────────────────────────────────

/**
 * Builds replacement level data for one season.
 *
 * For each position, finds the (numTeams × dedicatedSlots)th best player
 * by full-season points. That player is the "last guaranteed starter" —
 * the bar any acquisition needs to clear to have added real value.
 *
 * FLEX is excluded. All years use the same dedicated slot counts.
 */
export function buildSeasonPARTables(seasonPlayerResults, allPlayersData, numTeams) {
  const debug = [];
  debug.push(`Building PAR tables — numTeams: ${numTeams}, dedicated slots: ${JSON.stringify(DEDICATED_SLOTS)}, FLEX: ignored`);

  // Aggregate full-season totals per player
  const playerSeasonTotals = {};
  seasonPlayerResults.forEach((pr) => {
    const id = String(pr.playerId);
    if (!playerSeasonTotals[id]) playerSeasonTotals[id] = 0;
    playerSeasonTotals[id] += pr.pointsTotal || 0;
  });

  // Group by position and sort descending
  const playersByPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
    const pos = normalizePosition(allPlayersData[playerId]?.position, playerId);
    if (!pos || !playersByPosition[pos]) return;
    playersByPosition[pos].push({ playerId, totalPts });
  });
  Object.values(playersByPosition).forEach((g) => g.sort((a, b) => b.totalPts - a.totalPts));

  // Replacement level per position
  const replacementLevels = {};
  const replacementPlayerIds = {};
  const replacementPlayerNames = {};

  Object.entries(DEDICATED_SLOTS).forEach(([pos, slots]) => {
    const starterCount = slots * numTeams;
    // The player at index starterCount is the first one NOT guaranteed a start
    const repEntry = playersByPosition[pos]?.[starterCount];
    const repInfo  = repEntry ? allPlayersData[repEntry.playerId] : null;

    replacementLevels[pos]       = repEntry ? repEntry.totalPts : 0;
    replacementPlayerIds[pos]    = repEntry ? repEntry.playerId : null;
    replacementPlayerNames[pos]  = repEntry ? playerName(repInfo, repEntry.playerId) : '(none)';

    debug.push(
      `${pos}: ${starterCount} starter slots total, ` +
      `replacement = ${(replacementLevels[pos] || 0).toFixed(1)} pts ` +
      `(${replacementPlayerNames[pos]})`
    );
  });

  // Per-player PAR for reference (full-season, not prorated)
  const playerPAR = {};
  Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
    const pos = normalizePosition(allPlayersData[playerId]?.position, playerId);
    if (!pos || !replacementLevels[pos]) return;
    const info = allPlayersData[playerId];
    playerPAR[playerId] = {
      position: pos,
      totalPts,
      replacementLevel: replacementLevels[pos],
      par: totalPts - replacementLevels[pos],
      name: playerName(info, playerId)
    };
  });

  debug.push(`Built PAR entries for ${Object.keys(playerPAR).length} players.`);
  return {
    replacementLevels,
    replacementPlayerIds,
    replacementPlayerNames,
    playerPAR,
    numTeams,
    debug
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Computes the prorated replacement baseline for a given number of weeks held.
 *
 * replacementBaseline = (replacementSeasonTotal / 17) × weeksHeld
 *
 * This is the amount a freely-available replacement player would have been
 * expected to contribute over the same number of weeks.
 */
function proratedBaseline(replacementSeasonTotal, weeksHeld) {
  return (replacementSeasonTotal / TOTAL_SEASON_WEEKS) * weeksHeld;
}

/**
 * Gets actual points scored by a player on a specific roster in a specific
 * season, from a given week onward. Returns per-week breakdown for UI display.
 */
function getPlayerHoldData(playerResults, playerId, roster, txYear, txWeek) {
  const rows = (playerResults || [])
    .filter((pr) =>
      String(pr.playerId)  === String(playerId) &&
      Number(pr.rosterId)  === Number(roster) &&
      Number(pr.year)      === Number(txYear) &&
      Number(pr.week)      >= Number(txWeek)
    )
    .sort((a, b) => a.week - b.week);

  const totalPts   = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
  const startedPts = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
  const weeksHeld  = rows.length;
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

/**
 * Grades a 2-team trade using prorated PAR.
 *
 * For each acquired player:
 *   weeksHeld = actual weeks on receiving roster after trade week
 *   baseline  = (replacementSeasonTotal / 17) × weeksHeld
 *   PAR       = playerActualPts − baseline
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

  // Extract which players each roster received
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

      // Actual hold data
      const { rows, totalPts, startedPts, weeksHeld, weeksStarted } =
        getPlayerHoldData(playerResults, playerId, roster, txYear, txWeek);

      // Replacement info
      const repSeasonTotal = parTables.replacementLevels?.[position] ?? 0;
      const repName        = parTables.replacementPlayerNames?.[position] ?? '(none)';
      const repId          = parTables.replacementPlayerIds?.[position] ?? null;
      const repPerWeek     = repSeasonTotal / TOTAL_SEASON_WEEKS;
      const baseline       = proratedBaseline(repSeasonTotal, weeksHeld);
      const par            = totalPts - baseline;

      parTotal   += par;
      rawTotal   += totalPts;
      rawStarted += startedPts;

      // Per-week breakdown: actual pts vs prorated replacement per week
      const weekBreakdown = rows.map((row) => ({
        week:          Number(row.week),
        playerPts:     row.pointsTotal  || 0,
        startedPts:    row.pointsStarted || 0,
        repBaseline:   repPerWeek,  // constant per week = repSeasonTotal/17
        weekPAR:       (row.pointsTotal || 0) - repPerWeek
      }));

      players.push({
        playerId,
        name:             parTables.playerPAR[String(playerId)]?.name || playerName(playerInfo, playerId),
        position:         position || '?',
        par,
        totalPts,
        startedPts,
        weeksHeld,
        weeksStarted,
        startedPct:       weeksHeld > 0 ? weeksStarted / weeksHeld : 0,
        baseline,
        repSeasonTotal,
        repPerWeek,
        repName,
        repId,
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

/**
 * Grades a waiver pickup using prorated PAR.
 *
 * Same formula as trades:
 *   weeksHeld = actual weeks on roster after pickup
 *   baseline  = (replacementSeasonTotal / 17) × weeksHeld
 *   PAR       = pickupActualPts − baseline
 *
 * Grades: Elite (>30) / Strong (>15) / Solid (>5) / Breakeven (-5 to 5) / Poor (<-5)
 */
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
  const repId          = parTables.replacementPlayerIds?.[position] ?? null;
  const repPerWeek     = repSeasonTotal / TOTAL_SEASON_WEEKS;
  const baseline       = proratedBaseline(repSeasonTotal, weeksHeld);
  const par            = totalPts - baseline;
  const isStream       = weeksHeld <= 2;

  const weekBreakdown = rows.map((row) => ({
    week:        Number(row.week),
    playerPts:   row.pointsTotal  || 0,
    startedPts:  row.pointsStarted || 0,
    repBaseline: repPerWeek,
    weekPAR:     (row.pointsTotal || 0) - repPerWeek
  }));

  let gradeLabel, gradeSummary;
  if (par > 30) {
    gradeLabel   = 'elite';
    gradeSummary = `Elite pickup — ${totalPts.toFixed(1)} pts vs ${baseline.toFixed(1)} replacement baseline over ${weeksHeld} wk(s) (+${par.toFixed(1)} PAR).`;
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
    name:          parTables.playerPAR[String(playerId)]?.name || playerName(playerInfo, playerId),
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
    repId,
    weekBreakdown,
    gradeLabel,
    gradeSummary,
    droppedId,
    droppedName: droppedInfo?.full_name || (droppedId ? `Player ${droppedId}` : null),
    txYear,
    txWeek
  };
}

/**
 * Grades a composite (multi-team) trade using the same prorated PAR formula.
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
        playerPts:   row.pointsTotal  || 0,
        startedPts:  row.pointsStarted || 0,
        repBaseline: repPerWeek,
        weekPAR:     (row.pointsTotal || 0) - repPerWeek
      }));

      players.push({
        playerId,
        name:          parTables.playerPAR[String(playerId)]?.name || playerName(playerInfo, playerId),
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
