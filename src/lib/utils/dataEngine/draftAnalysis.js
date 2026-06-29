// draftAnalysis.js
//
// PRE-SEASON (gradeDraftPreSeason):
//   Grades based on positional scarcity within the draft itself.
//   "Did you get this position earlier than the average for that slot?"
//   No external data needed.
//
// END-OF-SEASON (gradeDraftEndOfSeason):
//   Simple PAR = actualSeasonPts − replacementLevel[position]
//   Uses the same replacement levels already computed for trades/waivers.
//   Round context determines grade labels — a pick below replacement in
//   round 1 is a bust; a pick below replacement in round 12 is expected.

// ── Round-based grade thresholds ─────────────────────────────────────────────
// Each tier: { maxRound, majorBust, bust, slightBust, value, steal, eliteSteal }
// PAR ranges between thresholds map to labels:
//   PAR < majorBust       → 'major bust'
//   majorBust ≤ PAR < bust → 'bust'
//   bust ≤ PAR < slightBust → 'slight bust'
//   slightBust ≤ PAR < value → 'as expected'
//   value ≤ PAR < steal   → 'value'
//   steal ≤ PAR < eliteSteal → 'steal'
//   PAR ≥ eliteSteal      → 'elite steal'

const ROUND_TIERS = [
  {
    maxRound:   2,    // Rounds 1-2: high expectations
    majorBust:  -80,
    bust:       -30,
    slightBust:   0,
    value:       40,
    steal:       80,
    eliteSteal: 150
  },
  {
    maxRound:   5,    // Rounds 3-5: good player expected
    majorBust:  -60,
    bust:       -20,
    slightBust:  -5,
    value:       25,
    steal:       60,
    eliteSteal: 100
  },
  {
    maxRound:   9,    // Rounds 6-9: above replacement is the bar
    majorBust:  -50,
    bust:       -20,
    slightBust: -10,
    value:       20,
    steal:       50,
    eliteSteal:  80
  },
  {
    maxRound:  99,    // Rounds 10+: any positive PAR is a win
    majorBust:  -40,
    bust:       -15,
    slightBust: -10,
    value:        5,
    steal:       30,
    eliteSteal:  60
  }
];

// Injury thresholds (games played from stats API)
const INJURY_MAJOR_THRESHOLD = 4;   // < 4 games = major injury
const INJURY_THRESHOLD       = 8;   // < 8 games = injury-affected

export function normalizePos(position, playerId) {
  if (!position) {
    if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) return 'DEF';
    return null;
  }
  const p = position.toUpperCase();
  if (p === 'QB')              return 'QB';
  if (p === 'RB')              return 'RB';
  if (p === 'WR')              return 'WR';
  if (p === 'TE')              return 'TE';
  if (p === 'K')               return 'K';
  if (p === 'DEF' || p === 'DST') return 'DEF';
  return p;
}

function fp(val, d = 1) {
  return typeof val === 'number' ? Number(val.toFixed(d)) : null;
}

function getGradeTier(round) {
  return ROUND_TIERS.find((t) => round <= t.maxRound) || ROUND_TIERS[ROUND_TIERS.length - 1];
}

function getPickLabel(par, round) {
  if (par == null) return 'no data';
  const t = getGradeTier(round);
  if (par >= t.eliteSteal) return 'elite steal';
  if (par >= t.steal)      return 'steal';
  if (par >= t.value)      return 'value';
  if (par >= t.slightBust) return 'as expected';
  if (par >= t.bust)       return 'slight bust';
  if (par >= t.majorBust)  return 'bust';
  return 'major bust';
}

function getTeamGrade(totalPAR) {
  if (totalPAR == null) return '—';
  if (totalPAR >  300)  return 'A+';
  if (totalPAR >  150)  return 'A';
  if (totalPAR >   50)  return 'B';
  if (totalPAR >  -50)  return 'C';
  if (totalPAR > -150)  return 'D';
  return 'F';
}

// ── Pre-season grade ───────────────────────────────────────────────────────

function buildPositionalADP(picks) {
  const groups = {};
  picks.forEach((pick) => {
    const pos = normalizePos(pick.position, pick.playerId);
    if (!pos) return;
    if (!groups[pos]) groups[pos] = [];
    groups[pos].push(pick.pickNo);
  });

  const adp = {};
  Object.entries(groups).forEach(([pos, pickNums]) => {
    pickNums.sort((a, b) => a - b);
    adp[pos] = {
      count:   pickNums.length,
      avgPick: pickNums.reduce((s, v) => s + v, 0) / pickNums.length,
      bySlot:  pickNums
    };
  });
  return adp;
}

function pickValueScore(pickNo, totalPicks) {
  if (!totalPicks || totalPicks <= 1) return 0;
  const normalized = (totalPicks - pickNo) / (totalPicks - 1);
  return Math.round(Math.sqrt(normalized) * 100 * 10) / 10;
}

export function gradeDraftPreSeason(draft) {
  if (!draft?.picks?.length) return null;

  const { picks, numTeams, rounds } = draft;
  const totalPicks     = numTeams * rounds;
  const positionalADP  = buildPositionalADP(picks);
  const posPickCount   = {};

  const gradedPicks = picks
    .slice()
    .sort((a, b) => a.pickNo - b.pickNo)
    .map((pick) => {
      const pos = normalizePos(pick.position, pick.playerId);
      if (!posPickCount[pos]) posPickCount[pos] = 0;
      posPickCount[pos]++;

      const positionalRank  = posPickCount[pos];
      const adpForPos       = positionalADP[pos];
      const avgPickAtRank   = adpForPos?.bySlot?.[positionalRank - 1] ?? pick.pickNo;
      const pickValue       = pickValueScore(pick.pickNo, totalPicks);
      const vsMarket        = avgPickAtRank - pick.pickNo;

      return {
        ...pick, pos, positionalRank, pickValue,
        vsMarket:      fp(vsMarket),
        avgPickAtRank: fp(avgPickAtRank),
        valueLabel: vsMarket >  15 ? 'steal'
                  : vsMarket >   5 ? 'value'
                  : vsMarket < -15 ? 'reach'
                  : vsMarket <  -5 ? 'slight reach'
                  : 'fair'
      };
    });

  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks: [], totalPickValue: 0, vsMarketSum: 0,
        steals: [], reaches: []
      };
    }
    byRoster[r].picks.push(pick);
    byRoster[r].totalPickValue += pick.pickValue;
    byRoster[r].vsMarketSum    += pick.vsMarket || 0;
    if (pick.valueLabel === 'steal')               byRoster[r].steals.push(pick);
    if (pick.valueLabel.includes('reach'))         byRoster[r].reaches.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    const sorted = [...team.picks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0));
    team.bestValuePick  = sorted[0] || null;
    team.worstValuePick = sorted[sorted.length - 1] || null;
    const avgVsMarket   = team.picks.length > 0 ? team.vsMarketSum / team.picks.length : 0;
    team.avgVsMarket    = fp(avgVsMarket);
    team.grade = avgVsMarket >  8 ? 'A'
               : avgVsMarket >  3 ? 'B'
               : avgVsMarket > -3 ? 'C'
               : avgVsMarket > -8 ? 'D'
               : 'F';
  });

  return {
    year: draft.year, draftType: draft.draftType, totalPicks,
    positionalADP, gradedPicks, byRoster,
    teamRankings:     Object.values(byRoster).sort((a, b) => b.vsMarketSum - a.vsMarketSum),
    leagueTopSteals:  [...gradedPicks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0)).slice(0, 5),
    leagueTopReaches: [...gradedPicks].sort((a, b) => (a.vsMarket || 0) - (b.vsMarket || 0)).slice(0, 5)
  };
}

// ── End-of-season grade ────────────────────────────────────────────────────

/**
 * Grades every drafted player using PAR against positional replacement level.
 *
 *   PAR = actualSeasonPts − replacementLevel[position]
 *
 * Uses the same replacement levels as trades/waivers (Nth-best player at
 * each position, where N = numTeams × dedicatedSlots). Round context
 * determines whether that PAR is a steal, as expected, or a bust.
 *
 * @param {Object} draft           - from getAllDrafts()
 * @param {Object} seasonStatTotals - { [playerId]: totalPts }
 * @param {Object} gamesPlayed     - { [playerId]: weeksWithStats }
 * @param {Object} parTables       - from allTimeHistory.parTablesBySeason[year]
 * @param {Object} allPlayersData  - full player info map
 */
export function gradeDraftEndOfSeason(draft, seasonStatTotals, gamesPlayed, parTables, allPlayersData) {
  if (!draft?.picks?.length || !seasonStatTotals || !parTables) return null;

  const { picks, numTeams, rounds } = draft;
  const debug = [];

  debug.push(`Grading ${draft.year} draft: ${picks.length} picks, ${rounds} rounds, ${numTeams} teams.`);
  debug.push(`Replacement levels used:`);
  Object.entries(parTables.replacementLevels || {}).forEach(([pos, pts]) => {
    debug.push(`  ${pos}: ${fp(pts)} pts/season (${parTables.replacementPlayerNames?.[pos] || '?'})`);
  });

  // Grade each pick
  const gradedPicks = picks.map((pick) => {
    const pos         = normalizePos(pick.position, pick.playerId);
    const actualPts   = seasonStatTotals[pick.playerId] ?? null;
    const repLevel    = parTables.replacementLevels?.[pos]      ?? null;
    const repName     = parTables.replacementPlayerNames?.[pos]  ?? '(none)';
    const par         = actualPts != null && repLevel != null ? actualPts - repLevel : null;
    const valueLabel  = getPickLabel(par, pick.round);

    // Injury detection
    const games         = gamesPlayed?.[pick.playerId] ?? null;
    const injuryFlag    = games != null && games < INJURY_MAJOR_THRESHOLD ? 'major-injury'
                        : games != null && games < INJURY_THRESHOLD       ? 'injury'
                        : null;

    return {
      ...pick,
      pos,
      actualPts:   fp(actualPts),
      repLevel:    fp(repLevel),
      repName,
      par:         fp(par),
      valueLabel,
      injuryFlag,
      gamesPlayed: games
    };
  });

  // Group by roster
  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks:        [],
        totalPAR:     0,
        totalActualPts: 0,
        steals:  [],
        busts:   [],
        injured: []
      };
    }

    byRoster[r].picks.push(pick);
    if (pick.par        != null) byRoster[r].totalPAR       += pick.par;
    if (pick.actualPts  != null) byRoster[r].totalActualPts += pick.actualPts;

    if (pick.valueLabel === 'steal' || pick.valueLabel === 'elite steal') byRoster[r].steals.push(pick);
    if (pick.valueLabel === 'bust'  || pick.valueLabel === 'major bust')  byRoster[r].busts.push(pick);
    if (pick.injuryFlag)                                                   byRoster[r].injured.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    // Sort picks by PAR for best/worst identification
    const sorted = [...team.picks]
      .filter((p) => p.par != null)
      .sort((a, b) => (b.par || 0) - (a.par || 0));

    team.bestPick  = sorted[0]                    || null;
    team.worstPick = sorted[sorted.length - 1]    || null;

    // Per-position breakdown
    const byPos = {};
    team.picks.forEach((pick) => {
      const pos = pick.pos;
      if (!byPos[pos]) byPos[pos] = { picks: 0, totalActualPts: 0, totalPAR: 0 };
      byPos[pos].picks          += 1;
      byPos[pos].totalActualPts += pick.actualPts || 0;
      byPos[pos].totalPAR       += pick.par       || 0;
    });
    team.byPosition = byPos;

    // Per-round PAR
    const byRound = {};
    team.picks.forEach((pick) => {
      if (!byRound[pick.round]) byRound[pick.round] = { picks: 0, totalPAR: 0 };
      byRound[pick.round].picks    += 1;
      byRound[pick.round].totalPAR += pick.par || 0;
    });
    team.byRound = byRound;

    // Injury-excluded PAR: what would PAR be if injured players are removed
    const injuredPAR = team.injured.reduce((s, p) => s + (p.par || 0), 0);
    team.injuryExcludedPAR = fp(team.totalPAR - injuredPAR);

    team.totalPAR       = fp(team.totalPAR);
    team.totalActualPts = fp(team.totalActualPts);
    team.grade          = getTeamGrade(team.totalPAR);
  });

  const teamRankings = Object.values(byRoster)
    .sort((a, b) => (b.totalPAR || 0) - (a.totalPAR || 0));

  return {
    year: draft.year, draftType: draft.draftType,
    replacementLevels: parTables.replacementLevels,
    replacementNames:  parTables.replacementPlayerNames,
    gradedPicks, byRoster, teamRankings, debug,
    leagueTopSteals: [...gradedPicks]
      .filter((p) => p.par != null)
      .sort((a, b) => (b.par || 0) - (a.par || 0))
      .slice(0, 10),
    leagueTopBusts: [...gradedPicks]
      .filter((p) => p.par != null)
      .sort((a, b) => (a.par || 0) - (b.par || 0))
      .slice(0, 10)
  };
}
