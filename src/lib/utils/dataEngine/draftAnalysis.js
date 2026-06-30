// draftAnalysis.js
//
// PRE-SEASON (gradeDraftPreSeason):
//   Grades based on positional scarcity within the draft itself.
//   "Did you get this position earlier than the average for that slot?"
//
// END-OF-SEASON (gradeDraftEndOfSeason):
//   PAR = actualPts − roundBaseline[round]
//   roundBaseline[round] = historical average pts for picks in that round
//                          (from computeRoundBaselines in draftBaselines.js)
//
//   Since the baseline already accounts for round position, grade thresholds
//   are symmetric around 0 regardless of round. A team whose picks beat their
//   historical round averages has positive total PAR. Grades now center around
//   0 instead of all being negative.

// ── Grade thresholds (applied uniformly, baseline is already round-adjusted) ──
const PICK_THRESHOLDS = {
  eliteSteal:  80,
  steal:       40,
  value:       15,
  asExpected:  -15,   // -15 to +15 = as expected
  slightBust:  -35,
  bust:        -70,
  // below -70 = major bust
};

// ── Injury detection ──────────────────────────────────────────────────────────
const INJURY_MAJOR = 4;   // < 4 games = major injury
const INJURY_MIN   = 8;   // < 8 games = injury-affected

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

function signedFp(val, d = 1) {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

function getPickLabel(par) {
  if (par == null) return 'no data';
  if (par >= PICK_THRESHOLDS.eliteSteal)  return 'elite steal';
  if (par >= PICK_THRESHOLDS.steal)       return 'steal';
  if (par >= PICK_THRESHOLDS.value)       return 'value';
  if (par >= PICK_THRESHOLDS.asExpected)  return 'as expected';
  if (par >= PICK_THRESHOLDS.slightBust)  return 'slight bust';
  if (par >= PICK_THRESHOLDS.bust)        return 'bust';
  return 'major bust';
}

function getTeamGrade(totalPAR) {
  const n = typeof totalPAR === 'string' ? parseFloat(totalPAR) : totalPAR;
  if (n == null || isNaN(n)) return '—';
  if (n >  250) return 'A+';
  if (n >  125) return 'A';
  if (n >   40) return 'B';
  if (n >  -40) return 'C';
  if (n > -125) return 'D';
  return 'F';
}

// ── Pre-season grade (positional scarcity, no external data needed) ───────────

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
  const totalPicks    = numTeams * rounds;
  const positionalADP = buildPositionalADP(picks);
  const posPickCount  = {};

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
        valueLabel:    vsMarket >  15 ? 'steal'
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

// ── End-of-season grade ────────────────────────────────────────────────────────

/**
 * Grades every drafted player using PAR against historical round baselines.
 *
 *   PAR = actualPts − roundBaseline[round]
 *
 * roundBaseline[round] is the historical average points for players
 * drafted in that round, computed from relevant past seasons.
 * Baselines are monotonically decreasing (round 8 ≤ round 7).
 *
 * @param {Object} draft             - from getAllDrafts()
 * @param {Object} seasonStatTotals  - { [playerId]: totalPts }
 * @param {Object} gamesPlayed       - { [playerId]: weeksWithStats }
 * @param {Object} roundBaselinesData - from computeRoundBaselines()
 * @param {Object} parTables         - from allTimeHistory (for replacement level display only)
 * @param {Object} allPlayersData    - full player info map
 */
export function gradeDraftEndOfSeason(
  draft, seasonStatTotals, gamesPlayed, roundBaselinesData, parTables, allPlayersData
) {
  if (!draft?.picks?.length || !seasonStatTotals || !roundBaselinesData) return null;

  const { picks, numTeams, rounds } = draft;
  const { baselines, raw, seasonYears, sampleSizes } = roundBaselinesData;
  const debug = [];

  debug.push(`Grading ${draft.year} — using round baselines from seasons: ${seasonYears.join(', ')}`);
  debug.push(`Round baselines (smoothed):`);
  Object.entries(baselines)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([r, pts]) => {
      debug.push(`  Round ${r}: ${fp(pts)} pts avg (raw: ${fp(raw[r])}, n=${sampleSizes[r]})`);
    });

  // Grade each pick
  const gradedPicks = picks.map((pick) => {
    const pos           = normalizePos(pick.position, pick.playerId);
    const actualPts     = seasonStatTotals[String(pick.playerId)] ?? null;
    const roundBaseline = baselines[Number(pick.round)] ?? null;
    const par           = actualPts != null && roundBaseline != null
      ? actualPts - roundBaseline
      : null;
    const valueLabel    = getPickLabel(par);

    // Position replacement level (for reference display only, not used in PAR)
    const repLevel = parTables?.replacementLevels?.[pos]     ?? null;
    const repName  = parTables?.replacementPlayerNames?.[pos] ?? '(none)';

    // Injury detection
    const games      = gamesPlayed?.[String(pick.playerId)] ?? null;
    const injuryFlag = games != null && games < INJURY_MAJOR ? 'major-injury'
                     : games != null && games < INJURY_MIN   ? 'injury'
                     : null;

    return {
      ...pick,
      pos,
      actualPts:     fp(actualPts),
      roundBaseline: fp(roundBaseline),
      par:           fp(par),
      valueLabel,
      injuryFlag,
      gamesPlayed:   games,
      // Position replacement level for reference panel
      repLevel:      fp(repLevel),
      repName
    };
  });

  // Group by roster
  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks:         [],
        totalPAR:      0,
        totalActualPts: 0,
        steals:  [],
        busts:   [],
        injured: []
      };
    }

    byRoster[r].picks.push(pick);
    if (pick.par        != null) byRoster[r].totalPAR       += parseFloat(pick.par);
    if (pick.actualPts  != null) byRoster[r].totalActualPts += parseFloat(pick.actualPts);

    if (pick.valueLabel === 'steal' || pick.valueLabel === 'elite steal') byRoster[r].steals.push(pick);
    if (pick.valueLabel === 'bust'  || pick.valueLabel === 'major bust')  byRoster[r].busts.push(pick);
    if (pick.injuryFlag)                                                   byRoster[r].injured.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    // Sort picks by round then pickNo within round (Fix #1)
    team.picks.sort((a, b) => Number(a.round) - Number(b.round) || Number(a.pickNo) - Number(b.pickNo));

    const sorted = [...team.picks]
      .filter((p) => p.par != null)
      .sort((a, b) => parseFloat(b.par) - parseFloat(a.par));

    team.bestPick  = sorted[0]                 || null;
    team.worstPick = sorted[sorted.length - 1] || null;

    // Per-position breakdown
    const byPos = {};
    team.picks.forEach((pick) => {
      const pos = pick.pos;
      if (!byPos[pos]) byPos[pos] = { picks: 0, totalActualPts: 0, totalPAR: 0 };
      byPos[pos].picks          += 1;
      byPos[pos].totalActualPts += parseFloat(pick.actualPts) || 0;
      byPos[pos].totalPAR       += parseFloat(pick.par)       || 0;
    });
    team.byPosition = byPos;

    // Per-round PAR
    const byRound = {};
    team.picks.forEach((pick) => {
      const r = Number(pick.round);
      if (!byRound[r]) byRound[r] = { picks: 0, totalPAR: 0 };
      byRound[r].picks    += 1;
      byRound[r].totalPAR += parseFloat(pick.par) || 0;
    });
    team.byRound = byRound;

    // Injury-excluded PAR (what PAR would be without injured picks)
    const injuredPAR = team.injured.reduce((s, p) => s + (parseFloat(p.par) || 0), 0);
    team.injuryExcludedPAR = fp(team.totalPAR - injuredPAR);

    team.grade          = getTeamGrade(team.totalPAR);
    team.totalPAR       = fp(team.totalPAR);
    team.totalActualPts = fp(team.totalActualPts);
  });

  const teamRankings = Object.values(byRoster)
    .sort((a, b) => parseFloat(b.totalPAR) - parseFloat(a.totalPAR));

  return {
    year:             draft.year,
    draftType:        draft.draftType,
    roundBaselines:   baselines,
    rawBaselines:     raw,
    sampleSizes,
    baselineSeasons:  seasonYears,
    gradedPicks,
    byRoster,
    teamRankings,
    debug,
    // Replacement levels from PAR tables for reference display
    replacementLevels: parTables?.replacementLevels || {},
    replacementNames:  parTables?.replacementPlayerNames || {},
    leagueTopSteals: [...gradedPicks]
      .filter((p) => p.par != null)
      .sort((a, b) => parseFloat(b.par) - parseFloat(a.par))
      .slice(0, 10),
    leagueTopBusts: [...gradedPicks]
      .filter((p) => p.par != null)
      .sort((a, b) => parseFloat(a.par) - parseFloat(b.par))
      .slice(0, 10)
  };
}
