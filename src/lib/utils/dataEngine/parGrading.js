// parGrading.js
//
// Points Above Replacement (PAR) grading for fantasy trades and waivers.
//
// PAR measures how much better a player was than the "replacement level"
// at their position — the freely-available player you'd start if they
// weren't on your roster. This makes cross-position trade comparisons
// meaningful: a QB and WR can be graded on the same scale regardless of
// their raw point totals.
//
// Replacement level is computed from the actual player pool that appeared
// in the league that season (from playerResults), so it reflects real
// scarcity — not theoretical projections.

const DEFAULT_ROSTER_POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN'
];

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];

/**
 * Parses Sleeper's roster_positions array into starter slot counts per position.
 * e.g. ["QB","RB","RB","WR","WR","WR","TE","FLEX","K","DEF","BN","BN"]
 *   → { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1 }
 */
export function parseStarterSlots(rosterPositions) {
  const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
  (rosterPositions || DEFAULT_ROSTER_POSITIONS).forEach((pos) => {
    const p = pos.toUpperCase();
    if (p === 'SUPER_FLEX' || p === 'SUPERFLEX') {
      slots.FLEX += 1;
    } else if (slots[p] !== undefined) {
      slots[p] += 1;
    }
    // BN, IR, etc. are ignored — only starter slots count
  });
  return slots;
}

/**
 * Normalizes Sleeper position strings to our PAR position buckets.
 */
function normalizePosition(position, playerId) {
  if (!position) {
    // Team defenses use abbreviations like "JAX", "BUF" as player IDs
    if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) {
      return 'DEF';
    }
    return null;
  }
  const p = position.toUpperCase();
  if (p === 'QB') return 'QB';
  if (p === 'RB') return 'RB';
  if (p === 'WR') return 'WR';
  if (p === 'TE') return 'TE';
  if (p === 'K') return 'K';
  if (p === 'DEF' || p === 'DST') return 'DEF';
  return null;
}

/**
 * Builds PAR lookup tables for ONE season.
 *
 * Algorithm:
 *   1. Aggregate total season points per player across all weeks they were rostered
 *   2. Group players by position using allPlayersData
 *   3. For each position, sort descending and find the replacement level —
 *      the (numTeams × starterSlotsAtPosition)th player's points
 *   4. For FLEX: find the best remaining player across RB/WR/TE after
 *      filling their dedicated slots
 *   5. For FLEX-eligible positions, effective replacement = lower of their
 *      own position's replacement and the FLEX replacement (since any of
 *      those players can fill either slot)
 *   6. Each player's PAR = their season total − replacement level at their position
 *
 * @param {Array}  seasonPlayerResults - playerResults rows for ONE season only
 * @param {Object} allPlayersData      - full Sleeper player map from getAllPlayers()
 * @param {Array}  rosterPositions     - league's roster_positions array from settings
 * @param {number} numTeams            - number of teams in the league that season
 * @returns {Object} PAR tables for this season
 */
export function buildSeasonPARTables(seasonPlayerResults, allPlayersData, rosterPositions, numTeams) {
  const debug = [];
  const slots = parseStarterSlots(rosterPositions || DEFAULT_ROSTER_POSITIONS);
  debug.push(`Starter slots: ${JSON.stringify(slots)}, numTeams: ${numTeams}`);

  // 1. Aggregate season totals per player (across any roster — player value
  //    is independent of which team they were on when computing replacement level)
  const playerSeasonTotals = {};
  seasonPlayerResults.forEach((pr) => {
    const id = String(pr.playerId);
    if (!playerSeasonTotals[id]) playerSeasonTotals[id] = 0;
    playerSeasonTotals[id] += pr.pointsTotal || 0;
  });

  // 2. Attach position and group by position
  const playersByPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };

  Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
    const playerInfo = allPlayersData[playerId];
    const position = normalizePosition(playerInfo?.position, playerId);
    if (!position || !playersByPosition[position]) return;
    playersByPosition[position].push({ playerId, totalPts, position });
  });

  // Sort each position group descending
  Object.values(playersByPosition).forEach((group) =>
    group.sort((a, b) => b.totalPts - a.totalPts)
  );

  // 3. Replacement levels for standard positions
  const replacementLevels = {};
  ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach((pos) => {
    const starterCount = (slots[pos] || 0) * numTeams;
    // The player at index starterCount is the first one NOT guaranteed a start
    const repPlayer = playersByPosition[pos][starterCount];
    replacementLevels[pos] = repPlayer ? repPlayer.totalPts : 0;
    debug.push(
      `${pos}: ${starterCount} starter slots, ` +
      `${playersByPosition[pos].length} rostered, ` +
      `replacement level = ${(replacementLevels[pos] || 0).toFixed(1)} pts`
    );
  });

  // 4. FLEX replacement level: best player across RB/WR/TE not filling a
  //    dedicated slot
  if ((slots.FLEX || 0) > 0) {
    const flexPool = [];
    FLEX_ELIGIBLE.forEach((pos) => {
      const dedicatedSlots = (slots[pos] || 0) * numTeams;
      playersByPosition[pos].slice(dedicatedSlots).forEach((p) => flexPool.push(p));
    });
    flexPool.sort((a, b) => b.totalPts - a.totalPts);

    const flexRepIdx = (slots.FLEX || 0) * numTeams;
    const flexRepPlayer = flexPool[flexRepIdx];
    replacementLevels.FLEX = flexRepPlayer ? flexRepPlayer.totalPts : 0;
    debug.push(`FLEX: ${(slots.FLEX || 0) * numTeams} slots, replacement level = ${(replacementLevels.FLEX || 0).toFixed(1)} pts`);

    // 5. Lower FLEX-eligible position replacement levels to FLEX level when
    //    FLEX is easier to fill (means those positions are more scarce)
    FLEX_ELIGIBLE.forEach((pos) => {
      if (replacementLevels.FLEX < replacementLevels[pos]) {
        debug.push(`${pos} replacement level lowered from ${replacementLevels[pos].toFixed(1)} to FLEX level ${replacementLevels.FLEX.toFixed(1)}`);
        replacementLevels[pos] = replacementLevels.FLEX;
      }
    });
  }

  // 6. Per-player PAR lookup
  const playerPAR = {};
  Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
    const playerInfo = allPlayersData[playerId];
    const position = normalizePosition(playerInfo?.position, playerId);
    if (!position) return;

    const repLevel = replacementLevels[position] ?? 0;
    playerPAR[playerId] = {
      position,
      totalPts,
      replacementLevel: repLevel,
      par: totalPts - repLevel,
      name: playerInfo?.full_name ||
        (playerInfo ? `${playerInfo.first_name || ''} ${playerInfo.last_name || ''}`.trim() : null) ||
        `Player ${playerId}`
    };
  });

  debug.push(`Built PAR entries for ${Object.keys(playerPAR).length} players.`);
  return { replacementLevels, playerPAR, slots, numTeams, debug };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function isOnOrAfterTransaction(pr, txYear, txWeek) {
  // Strictly same-season only — roster IDs reset each year so crossing
  // year boundaries would silently merge different teams.
  if (Number(pr.year) !== Number(txYear)) return false;
  return Number(pr.week) >= Number(txWeek);
}

const TOTAL_POSSIBLE_WEEKS = 18;

function proratedReplacementPts(replacementLevel, txWeek) {
  const weeksRemaining = Math.max(TOTAL_POSSIBLE_WEEKS - Number(txWeek) + 1, 1);
  return replacementLevel * (weeksRemaining / TOTAL_POSSIBLE_WEEKS);
}

function buildTradeNarrative({ side0, side1, parDifference, winner, managerNames }) {
  const flags = [];

  [...(side0.players || []), ...(side1.players || [])].forEach((p) => {
    if (p.weeks <= 2 && p.totalPts < 10) {
      flags.push({ type: 'injury-suspected', name: p.name, side: p.side });
    } else if (p.weeks > 2 && p.startedPct < 0.5) {
      flags.push({ type: 'underutilized', name: p.name, side: p.side });
    }
  });

  let grade;
  if (winner === null) grade = 'even';
  else if (parDifference > 40) grade = 'lopsided';
  else if (parDifference > 20) grade = 'clear';
  else grade = 'close';

  const winnerName = winner === 0 ? managerNames[0] : winner === 1 ? managerNames[1] : null;
  const loserName  = winner === 0 ? managerNames[1] : winner === 1 ? managerNames[0] : null;
  const winnerPAR  = winner === 0 ? side0.parTotal  : side1.parTotal;
  const loserPAR   = winner === 0 ? side1.parTotal  : side0.parTotal;

  let summary;
  switch (grade) {
    case 'even':
      summary = `This trade was essentially a wash — both sides extracted similar value above replacement level.`;
      break;
    case 'lopsided':
      summary = `${winnerName} dominated this trade, generating ${winnerPAR.toFixed(1)} PAR points compared to ${loserName}'s ${loserPAR.toFixed(1)}.`;
      break;
    case 'clear':
      summary = `${winnerName} came out clearly ahead — ${winnerPAR.toFixed(1)} PAR points vs ${loserName}'s ${loserPAR.toFixed(1)}.`;
      break;
    case 'close':
      summary = `This was a close trade — ${winnerName} edged ${loserName} ${winnerPAR.toFixed(1)} to ${loserPAR.toFixed(1)} in PAR points.`;
      break;
  }

  const injuryFlag = flags.find((f) => f.type === 'injury-suspected');
  const utilFlag   = flags.find((f) => f.type === 'underutilized');
  if (injuryFlag) summary += ` Note: ${injuryFlag.name} may have been injured, which could affect this grade.`;
  else if (utilFlag) summary += ` Note: ${utilFlag.name} was underutilized despite being rostered.`;

  return { grade, flags, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public grading functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grades a trade using PAR.
 *
 * For each acquired player, computes:
 *   PAR from trade = actual points from trade week onward
 *                    − (replacement level × weeks remaining / total weeks)
 *
 * This correctly handles mid-season trades: a player acquired in week 10
 * is compared against what a replacement player would have contributed
 * in weeks 10–18, not the whole season.
 *
 * @param {Object}   trade          - digestedTransaction with type 'trade'
 * @param {Object}   parTables      - output of buildSeasonPARTables for this season
 * @param {Array}    playerResults  - per-player weekly data (all seasons)
 * @param {Object}   allPlayersData - full Sleeper player map
 * @param {string[]} managerNames   - display names for [rosters[0], rosters[1]]
 * @returns {Object|null} full PAR grade
 */
export function gradeTradeByPAR(trade, parTables, playerResults, allPlayersData, managerNames = []) {
  if (!trade.moves || !trade.rosters || trade.rosters.length !== 2) return null;
  if (!parTables) return null;

  const rosters = trade.rosters;
  const txYear  = Number(trade.seasonKey || trade.season);
  const txWeek  = Number(trade.leg || 1);

  // Extract which players each roster received
  const received = {};
  rosters.forEach((r) => (received[r] = []));
  trade.moves.forEach((move) => {
    if (!Array.isArray(move)) return;
    move.forEach((side, idx) => {
      const roster = rosters[idx];
      if (!roster || !side || typeof side !== 'object') return;
      if (side.type === 'trade' && side.player) {
        received[roster].push(side.player);
      }
    });
  });

  const gradeByRoster = {};

  rosters.forEach((roster) => {
    const acquiredPlayers = received[roster] || [];
    let parTotal   = 0;
    let rawTotal   = 0;
    let rawStarted = 0;
    const players  = [];

    acquiredPlayers.forEach((playerId) => {
      const parData    = parTables.playerPAR[String(playerId)];
      const playerInfo = allPlayersData[String(playerId)];
      const position   = normalizePosition(playerInfo?.position, playerId);
      const repLevel   = parData?.replacementLevel ?? parTables.replacementLevels[position] ?? 0;

      // Actual production on THIS roster from trade week onward
      const rows = (playerResults || []).filter((pr) =>
        String(pr.playerId)  === String(playerId) &&
        Number(pr.rosterId)  === Number(roster) &&
        isOnOrAfterTransaction(pr, txYear, txWeek)
      );

      const playerRawTotal  = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
      const playerStartedPts = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
      const weeksStarted    = rows.filter((pr) => pr.pointsStarted > 0).length;

      // PAR from trade = actual points − prorated replacement level
      const proratedRepPts = proratedReplacementPts(repLevel, txWeek);
      const playerPAR      = playerRawTotal - proratedRepPts;

      parTotal   += playerPAR;
      rawTotal   += playerRawTotal;
      rawStarted += playerStartedPts;

      players.push({
        playerId,
        name:          parData?.name || playerInfo?.full_name || `Player ${playerId}`,
        position:      position || '?',
        par:           playerPAR,
        replacementLevel: repLevel,
        proratedRepPts,
        totalPts:      playerRawTotal,
        startedPts:    playerStartedPts,
        weeks:         rows.length,
        weeksStarted,
        startedPct:    rows.length > 0 ? weeksStarted / rows.length : 0,
      });
    });

    gradeByRoster[roster] = { parTotal, rawTotal, rawStarted, players };
  });

  const side0 = { ...gradeByRoster[rosters[0]], roster: rosters[0] };
  const side1 = { ...gradeByRoster[rosters[1]], roster: rosters[1] };

  // Tag each player with their side for narrative building
  (side0.players || []).forEach((p) => { p.side = 0; });
  (side1.players || []).forEach((p) => { p.side = 1; });

  let winner = null;
  const parDifference = Math.abs(side0.parTotal - side1.parTotal);
  if (side0.parTotal > side1.parTotal)      winner = 0;
  else if (side1.parTotal > side0.parTotal) winner = 1;

  const narrative = buildTradeNarrative({ side0, side1, parDifference, winner, managerNames });

  return { side0, side1, winner, parDifference, narrative, txYear, txWeek };
}

/**
 * Grades a waiver pickup using PAR.
 *
 * PAR from pickup = actual points from pickup week onward
 *                   − (replacement level × weeks remaining / total weeks)
 *
 * @param {Object} waiver
 * @param {Object} parTables
 * @param {Array}  playerResults
 * @param {Object} allPlayersData
 * @returns {Object|null} waiver grade with PAR, raw points, and narrative
 */
export function gradeWaiverByPAR(waiver, parTables, playerResults, allPlayersData) {
  if (!waiver.moves || !waiver.rosters?.[0]) return null;
  if (!parTables) return null;

  const roster = waiver.rosters[0];
  const txYear = Number(waiver.seasonKey || waiver.season);
  const txWeek = Number(waiver.leg || 1);

  let playerId = null;
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
  const parData    = parTables.playerPAR[String(playerId)];
  const repLevel   = parData?.replacementLevel ?? parTables.replacementLevels[position] ?? 0;

  const rows = (playerResults || []).filter((pr) =>
    String(pr.playerId)  === String(playerId) &&
    Number(pr.rosterId)  === Number(roster) &&
    isOnOrAfterTransaction(pr, txYear, txWeek)
  );

  const totalPts    = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
  const startedPts  = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
  const weeks       = rows.length;
  const weeksStarted = rows.filter((pr) => pr.pointsStarted > 0).length;

  const proratedRepPts = proratedReplacementPts(repLevel, txWeek);
  const par = totalPts - proratedRepPts;

  // Narrative label
  let gradeLabel, gradeSummary;
  if (par > 40)       { gradeLabel = 'elite';   gradeSummary = `Elite pickup — massive production above replacement at ${position || '?'}.`; }
  else if (par > 20)  { gradeLabel = 'strong';  gradeSummary = `Strong pickup — solid value above replacement at ${position || '?'}.`; }
  else if (par > 5)   { gradeLabel = 'solid';   gradeSummary = `Solid pickup — modest but meaningful value above replacement at ${position || '?'}.`; }
  else if (par > -5)  { gradeLabel = 'neutral'; gradeSummary = `Break-even pickup — roughly replacement-level production at ${position || '?'}.`; }
  else                { gradeLabel = 'poor';    gradeSummary = `Below replacement level at ${position || '?'} — this pickup didn't pay off.`; }

  const injurySuspected = weeks <= 2 && totalPts < 10 && txWeek < 14;
  if (injurySuspected) gradeSummary += ' Possible injury may have limited contribution.';

  const droppedInfo = droppedId ? allPlayersData[String(droppedId)] : null;

  return {
    playerId,
    name:          parData?.name || playerInfo?.full_name || `Player ${playerId}`,
    position:      position || '?',
    par,
    replacementLevel: repLevel,
    proratedRepPts,
    totalPts,
    startedPts,
    weeks,
    weeksStarted,
    startedPct:    weeks > 0 ? weeksStarted / weeks : 0,
    gradeLabel,
    gradeSummary,
    droppedId,
    droppedName:   droppedInfo?.full_name || (droppedId ? `Player ${droppedId}` : null),
    txYear,
    txWeek
  };
}
