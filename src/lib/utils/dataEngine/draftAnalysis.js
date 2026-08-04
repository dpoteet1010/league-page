// draftAnalysis.js
//
// POST-DRAFT (gradeDraftPreSeason): positional scarcity — no projections needed.
// POST-SEASON (gradeDraftEndOfSeason): adjusted PAR vs historical round baselines.
//   adjustedPAR = actualPAR − expectedPAR[round]
//   K/DEF: expectedPAR forced to 0, adjustedPAR = actualPAR directly.
// Injury tracking removed entirely.
//
// VIBES-GRADE CALIBRATION: the actual "Draft Grades" article is written by
// an LLM right after the draft using industry ADP/expert knowledge — there's
// no performance data yet, so it's inherently a vibes call, not something
// this file computes. What THIS file can do is compare those vibes grades
// (recorded manually once issued) against the real data-based grade computed
// here once the season ends, to see if the vibes-grading process runs too
// generous, too harsh, or roughly accurate — see compareVibesToActual /
// summarizeCalibration at the bottom.

const PICK_THRESHOLDS = {
  eliteSteal: 80, steal: 40, value: 15, asExpected: -15, slightBust: -35, bust: -70
};

const NO_ROUND_ADJUSTMENT_POSITIONS = ['K', 'DEF'];

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

function fp(val, d = 1) { return typeof val === 'number' ? Number(val.toFixed(d)) : null; }

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

function getTeamGrade(totalAdjustedPAR) {
  const n = typeof totalAdjustedPAR === 'string' ? parseFloat(totalAdjustedPAR) : totalAdjustedPAR;
  if (n == null || isNaN(n)) return '—';
  if (n >  250) return 'A+';
  if (n >  125) return 'A';
  if (n >   40) return 'B';
  if (n >  -40) return 'C';
  if (n > -125) return 'D';
  return 'F';
}

// ── POST-DRAFT: positional scarcity grade ──────────────────────────────────
//
// NOTE: this is a self-referential metric (compares each pick to the
// positional ADP within THIS draft only, not real industry ADP) — it's
// useful as an internal "who reached within our own room" signal but is NOT
// the vibes-based grade shown to the league. The actual Draft Grades article
// is LLM-authored using real ADP/expert knowledge (see dataExport.js
// exportDraftResults + PROMPTS.draftGrades).

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
    adp[pos] = { count: pickNums.length, avgPick: pickNums.reduce((s, v) => s + v, 0) / pickNums.length, bySlot: pickNums };
  });
  return adp;
}

function pickValueScore(pickNo, totalPicks) {
  if (!totalPicks || totalPicks <= 1) return 0;
  return Math.round(Math.sqrt((totalPicks - pickNo) / (totalPicks - 1)) * 100 * 10) / 10;
}

export function gradeDraftPreSeason(draft) {
  if (!draft?.picks?.length) return null;
  const { picks, numTeams, rounds } = draft;
  const totalPicks    = numTeams * rounds;
  const positionalADP = buildPositionalADP(picks);
  const posPickCount  = {};

  const gradedPicks = picks.slice().sort((a, b) => a.pickNo - b.pickNo).map((pick) => {
    const pos = normalizePos(pick.position, pick.playerId);
    if (!posPickCount[pos]) posPickCount[pos] = 0;
    posPickCount[pos]++;
    const positionalRank = posPickCount[pos];
    const avgPickAtRank  = positionalADP[pos]?.bySlot?.[positionalRank - 1] ?? pick.pickNo;
    const vsMarket       = avgPickAtRank - pick.pickNo;
    return {
      ...pick, pos, positionalRank,
      pickValue: pickValueScore(pick.pickNo, totalPicks),
      vsMarket: fp(vsMarket), avgPickAtRank: fp(avgPickAtRank),
      valueLabel: vsMarket > 15 ? 'steal' : vsMarket > 5 ? 'value' : vsMarket < -15 ? 'reach' : vsMarket < -5 ? 'slight reach' : 'fair'
    };
  });

  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) byRoster[r] = { rosterId: r, managerId: pick.managerId, picks: [], vsMarketSum: 0, steals: [], reaches: [] };
    byRoster[r].picks.push(pick);
    byRoster[r].vsMarketSum += pick.vsMarket || 0;
    if (pick.valueLabel === 'steal') byRoster[r].steals.push(pick);
    if (pick.valueLabel.includes('reach')) byRoster[r].reaches.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    const sorted = [...team.picks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0));
    team.bestValuePick  = sorted[0] || null;
    team.worstValuePick = sorted[sorted.length - 1] || null;
    const avg = team.picks.length > 0 ? team.vsMarketSum / team.picks.length : 0;
    team.avgVsMarket = fp(avg);
    team.grade = avg > 8 ? 'A' : avg > 3 ? 'B' : avg > -3 ? 'C' : avg > -8 ? 'D' : 'F';
  });

  return {
    year: draft.year, draftType: draft.draftType, totalPicks, positionalADP, gradedPicks, byRoster,
    teamRankings: Object.values(byRoster).sort((a, b) => b.vsMarketSum - a.vsMarketSum),
    leagueTopSteals:  [...gradedPicks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0)).slice(0, 5),
    leagueTopReaches: [...gradedPicks].sort((a, b) => (a.vsMarket || 0) - (b.vsMarket || 0)).slice(0, 5)
  };
}

// ── POST-SEASON: data-based PAR grade (injury tracking removed) ────────────

/**
 * @param {Object} draft              - from getAllDrafts()
 * @param {Object} seasonStatTotals   - { [playerId]: totalPts }
 * @param {Object} roundBaselinesData - from computeRoundBaselines()
 * @param {Object} parTables          - this season's real parTables
 * @param {Object} allPlayersData
 */
export function gradeDraftEndOfSeason(
  draft, seasonStatTotals, roundBaselinesData, parTables, allPlayersData
) {
  if (!draft?.picks?.length || !seasonStatTotals || !roundBaselinesData || !parTables) return null;

  const { expectedPAR, raw, seasonYears, sampleSizes, excludedKDefCount } = roundBaselinesData;
  const debug = [];

  debug.push(`Grading ${draft.year} — adjusted PAR using round expectations from: ${seasonYears.join(', ')}`);
  debug.push(`Replacement levels (this season's real settings):`);
  Object.entries(parTables.replacementLevels || {}).forEach(([pos, pts]) => {
    debug.push(`  ${pos}: ${fp(pts)} pts (${parTables.replacementPlayerNames?.[pos] || '?'})`);
  });
  debug.push(`Expected PAR by round (K/DEF excluded, ${excludedKDefCount ?? 0} picks filtered):`);
  Object.entries(expectedPAR).sort(([a],[b]) => Number(a)-Number(b)).forEach(([r, val]) => {
    debug.push(`  Round ${r}: ${fp(val)} (raw: ${fp(raw[r])}, n=${sampleSizes[r]})`);
  });

  const gradedPicks = draft.picks.map((pick) => {
    const pos         = normalizePos(pick.position, pick.playerId) ||
                        normalizePos(allPlayersData?.[String(pick.playerId)]?.position, pick.playerId);
    const actualPts   = seasonStatTotals[String(pick.playerId)] ?? null;
    const repLevel    = parTables.replacementLevels?.[pos]      ?? null;
    const repName     = parTables.replacementPlayerNames?.[pos]  ?? '(none)';
    const actualPAR   = actualPts != null && repLevel != null ? actualPts - repLevel : null;
    const isExempt    = NO_ROUND_ADJUSTMENT_POSITIONS.includes(pos);
    const expPAR      = isExempt ? 0 : (expectedPAR[Number(pick.round)] ?? null);
    const adjustedPAR = actualPAR != null && expPAR != null ? actualPAR - expPAR : null;
    const valueLabel  = getPickLabel(adjustedPAR);

    return {
      ...pick, pos,
      actualPts:         fp(actualPts),
      repLevel:          fp(repLevel),
      repName,
      actualPAR:         fp(actualPAR),
      expectedPAR:       fp(expPAR),
      adjustedPAR:       fp(adjustedPAR),
      noRoundAdjustment: isExempt,
      valueLabel
    };
  });

  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks: [], totalAdjustedPAR: 0, totalActualPAR: 0, totalActualPts: 0,
        steals: [], busts: []
      };
    }
    byRoster[r].picks.push(pick);
    if (pick.adjustedPAR != null) byRoster[r].totalAdjustedPAR += parseFloat(pick.adjustedPAR);
    if (pick.actualPAR   != null) byRoster[r].totalActualPAR   += parseFloat(pick.actualPAR);
    if (pick.actualPts   != null) byRoster[r].totalActualPts   += parseFloat(pick.actualPts);
    if (pick.valueLabel === 'steal' || pick.valueLabel === 'elite steal') byRoster[r].steals.push(pick);
    if (pick.valueLabel === 'bust'  || pick.valueLabel === 'major bust')  byRoster[r].busts.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    team.picks.sort((a, b) => Number(a.round) - Number(b.round) || Number(a.pickNo) - Number(b.pickNo));

    const sorted = [...team.picks].filter((p) => p.adjustedPAR != null)
      .sort((a, b) => parseFloat(b.adjustedPAR) - parseFloat(a.adjustedPAR));
    team.bestPick  = sorted[0]                 || null;
    team.worstPick = sorted[sorted.length - 1] || null;

    const byPos = {};
    team.picks.forEach((pick) => {
      const pos = pick.pos;
      if (!byPos[pos]) byPos[pos] = { picks: 0, totalActualPts: 0, totalAdjustedPAR: 0 };
      byPos[pos].picks            += 1;
      byPos[pos].totalActualPts   += parseFloat(pick.actualPts)   || 0;
      byPos[pos].totalAdjustedPAR += parseFloat(pick.adjustedPAR) || 0;
    });
    team.byPosition = byPos;

    const byRound = {};
    team.picks.forEach((pick) => {
      const r = Number(pick.round);
      if (!byRound[r]) byRound[r] = { picks: 0, totalAdjustedPAR: 0 };
      byRound[r].picks            += 1;
      byRound[r].totalAdjustedPAR += parseFloat(pick.adjustedPAR) || 0;
    });
    team.byRound = byRound;

    team.grade            = getTeamGrade(team.totalAdjustedPAR);
    team.totalAdjustedPAR = fp(team.totalAdjustedPAR);
    team.totalActualPAR   = fp(team.totalActualPAR);
    team.totalActualPts   = fp(team.totalActualPts);
  });

  const teamRankings = Object.values(byRoster)
    .sort((a, b) => parseFloat(b.totalAdjustedPAR) - parseFloat(a.totalAdjustedPAR));

  return {
    year: draft.year, draftType: draft.draftType,
    expectedPARByRound: expectedPAR, rawExpectedPAR: raw, sampleSizes, baselineSeasons: seasonYears,
    gradedPicks, byRoster, teamRankings, debug,
    replacementLevels: parTables?.replacementLevels || {},
    replacementNames:  parTables?.replacementPlayerNames || {},
    leagueTopSteals: [...gradedPicks].filter((p) => p.adjustedPAR != null)
      .sort((a, b) => parseFloat(b.adjustedPAR) - parseFloat(a.adjustedPAR)).slice(0, 10),
    leagueTopBusts: [...gradedPicks].filter((p) => p.adjustedPAR != null)
      .sort((a, b) => parseFloat(a.adjustedPAR) - parseFloat(b.adjustedPAR)).slice(0, 10)
  };
}

// ── Vibes-grade calibration ──────────────────────────────────────────────────
//
// The Draft Grades article's letter grades are issued by an LLM right after
// the draft (vibes-based — no performance data exists yet). Once a season
// finishes and gradeDraftEndOfSeason() produces a real data-based grade for
// that same draft, these two functions compare "what we said at the time"
// to "how it actually turned out," to check whether the vibes-grading
// process runs too generous, too harsh, or roughly accurate — and by how
// much — so future Draft Grades prompts can be calibrated against that bias.

export const GRADE_GPA = {
  'A+': 4.3, 'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7,
  'D+': 1.3, 'D': 1.0, 'D-': 0.7,
  'F': 0
};

export function gradeToGPA(letterGrade) {
  if (!letterGrade) return null;
  return GRADE_GPA[String(letterGrade).trim().toUpperCase()] ?? null;
}

/**
 * Compares one year's vibes-based draft grades (issued by the LLM right
 * after the draft, manually recorded by the commissioner afterward) against
 * that same year's data-based end-of-season grade. Per manager: how far off
 * was the vibes grade, and in which direction.
 *
 * @param {Object} vibesGradesForYear - { [managerId]: 'B+' }
 * @param {Object} eosGrade           - result of gradeDraftEndOfSeason for that year
 */
export function compareVibesToActual(vibesGradesForYear, eosGrade) {
  if (!vibesGradesForYear || !eosGrade?.byRoster) return null;

  const rows = [];
  Object.values(eosGrade.byRoster).forEach((team) => {
    const vibesLetter = vibesGradesForYear[team.managerId];
    if (!vibesLetter) return;
    const vibesGPA = gradeToGPA(vibesLetter);
    const eosGPA   = gradeToGPA(team.grade);
    if (vibesGPA == null || eosGPA == null) return;
    const delta = fp(vibesGPA - eosGPA, 2); // positive = graded more generously than it performed
    rows.push({
      managerId: team.managerId,
      vibesGrade: vibesLetter,
      eosGrade: team.grade,
      vibesGPA, eosGPA, delta,
      label: delta > 0.7  ? 'significantly overrated'
           : delta > 0.25 ? 'slightly overrated'
           : delta < -0.7  ? 'significantly underrated'
           : delta < -0.25 ? 'slightly underrated'
           : 'accurate'
    });
  });

  if (rows.length === 0) return null;

  const avgDelta    = fp(rows.reduce((s, r) => s + r.delta, 0) / rows.length, 2);
  const avgAbsError = fp(rows.reduce((s, r) => s + Math.abs(r.delta), 0) / rows.length, 2);

  return { year: eosGrade.year, rows, avgDelta, avgAbsError };
}

/**
 * Aggregates multiple years of compareVibesToActual() output into an
 * overall calibration summary.
 *
 * @param {Array} yearlyComparisons - array of compareVibesToActual() results (may include nulls)
 */
export function summarizeCalibration(yearlyComparisons) {
  const valid = (yearlyComparisons || []).filter(Boolean);
  if (valid.length === 0) return null;

  const allRows     = valid.flatMap((c) => c.rows);
  const avgDelta     = fp(allRows.reduce((s, r) => s + r.delta, 0) / allRows.length, 2);
  const avgAbsError  = fp(allRows.reduce((s, r) => s + Math.abs(r.delta), 0) / allRows.length, 2);

  let bias;
  if (avgDelta > 0.3)       bias = 'tends to grade drafts more generously than they turn out to perform';
  else if (avgDelta < -0.3) bias = 'tends to grade drafts more harshly than they turn out to perform';
  else                       bias = 'grades drafts roughly in line with how they end up performing';

  return {
    yearsIncluded: valid.map((c) => c.year),
    totalDraftsCompared: allRows.length,
    avgDelta, avgAbsError, bias,
    byYear: valid.map((c) => ({ year: c.year, avgDelta: c.avgDelta, avgAbsError: c.avgAbsError }))
  };
}
