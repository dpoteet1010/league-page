// managerGrades.js
//
// Manager grade = weighted blend of 4 components, each normalized to 0-100:
//   40% Draft       — externally supplied (LLM post-draft grade, or post-
//                      season data grade once available — see note below)
//   20% Trades      — total trade PAR, normalized vs league
//   20% Waivers     — total waiver PAR, normalized vs league
//   20% Lineup IQ   — fpts/ppts ratio, normalized vs league
//
// If a component is missing for a manager/season (e.g. no LLM draft grade
// entered yet, or a manager made zero trades that season), its weight is
// redistributed proportionally across the remaining available components
// rather than penalizing the manager with a 0.
//
// DRAFT SCORE SOURCE: pass in either an LLM-supplied score (0-100, entered
// manually after pasting draft history context into an LLM) OR the
// post-season data-based draft grade (converted from letter grade to 0-100)
// once the season concludes — whichever is available. Post-season data
// grade should be preferred when both exist since it reflects real outcomes.

const WEIGHTS = { draft: 0.40, trades: 0.20, waivers: 0.20, lineupIQ: 0.20 };

const LETTER_TO_SCORE = { 'A+': 97, 'A': 92, 'B': 80, 'C': 65, 'D': 45, 'F': 20 };

export function letterGradeToScore(letter) {
  return LETTER_TO_SCORE[letter] ?? null;
}

/**
 * Normalizes a raw value to 0-100 using min-max scaling across all managers
 * in the same season (relative grading — "best in your league that year").
 */
function normalizeToScale(value, allValues) {
  if (value == null || allValues.length === 0) return null;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 50; // everyone tied — neutral midpoint
  return ((value - min) / (max - min)) * 100;
}

/**
 * Computes one manager's grade for one season.
 *
 * @param {Object} inputs
 * @param {number|null} inputs.draftScore     - 0-100, from LLM or post-season data grade
 * @param {number|null} inputs.tradePARTotal  - sum of this manager's trade PAR this season
 * @param {number|null} inputs.waiverPARTotal - sum of this manager's waiver PAR this season
 * @param {number|null} inputs.lineupIQ       - fpts/ppts ratio (e.g. 0.94)
 * @param {Object} leagueContext              - { allDraftScores, allTradePARs, allWaiverPARs, allLineupIQs } arrays across all managers that season, for normalization
 */
export function computeManagerGrade(inputs, leagueContext) {
  const { draftScore, tradePARTotal, waiverPARTotal, lineupIQ } = inputs;

  const normTrade   = tradePARTotal  != null ? normalizeToScale(tradePARTotal,  leagueContext.allTradePARs  || []) : null;
  const normWaiver  = waiverPARTotal != null ? normalizeToScale(waiverPARTotal, leagueContext.allWaiverPARs || []) : null;
  const normLineup  = lineupIQ       != null ? normalizeToScale(lineupIQ,       leagueContext.allLineupIQs  || []) : null;
  const normDraft   = draftScore; // already 0-100, no normalization needed

  const components = [
    { key: 'draft',    score: normDraft,  weight: WEIGHTS.draft },
    { key: 'trades',   score: normTrade,  weight: WEIGHTS.trades },
    { key: 'waivers',  score: normWaiver, weight: WEIGHTS.waivers },
    { key: 'lineupIQ', score: normLineup, weight: WEIGHTS.lineupIQ }
  ];

  const available = components.filter((c) => c.score != null);
  if (available.length === 0) return { overallGrade: null, components, missingComponents: components.map(c => c.key) };

  // Redistribute weight proportionally across available components
  const totalAvailableWeight = available.reduce((s, c) => s + c.weight, 0);
  const overallGrade = available.reduce(
    (sum, c) => sum + c.score * (c.weight / totalAvailableWeight),
    0
  );

  return {
    overallGrade: Number(overallGrade.toFixed(1)),
    components: components.map((c) => ({ ...c, scaledWeight: c.score != null ? c.weight / totalAvailableWeight : 0 })),
    missingComponents: components.filter((c) => c.score == null).map((c) => c.key)
  };
}

/**
 * Computes manager grades for every manager in a single season.
 *
 * @param {string|number} year
 * @param {Object} managerDraftScores  - { [managerId]: score 0-100 } (from LLM or post-season)
 * @param {Object} managerTradePAR     - { [managerId]: totalPAR }
 * @param {Object} managerWaiverPAR    - { [managerId]: totalPAR }
 * @param {Object} managerLineupIQ     - { [managerId]: ratio }
 * @param {Array}  allManagerIds
 * @returns {Object} { [managerId]: gradeResult }
 */
export function computeSeasonManagerGrades(year, managerDraftScores, managerTradePAR, managerWaiverPAR, managerLineupIQ, allManagerIds) {
  const leagueContext = {
    allTradePARs:  allManagerIds.map((id) => managerTradePAR?.[id]).filter((v) => v != null),
    allWaiverPARs: allManagerIds.map((id) => managerWaiverPAR?.[id]).filter((v) => v != null),
    allLineupIQs:  allManagerIds.map((id) => managerLineupIQ?.[id]).filter((v) => v != null)
  };

  const results = {};
  allManagerIds.forEach((managerId) => {
    results[managerId] = computeManagerGrade({
      draftScore:     managerDraftScores?.[managerId] ?? null,
      tradePARTotal:  managerTradePAR?.[managerId] ?? null,
      waiverPARTotal: managerWaiverPAR?.[managerId] ?? null,
      lineupIQ:       managerLineupIQ?.[managerId] ?? null
    }, leagueContext);
  });

  return results;
}

/**
 * Computes all-time manager grades by averaging each manager's per-season
 * overall grades. Only seasons with a computed grade are counted.
 */
export function computeAllTimeManagerGrades(seasonGradesByYear) {
  const byManager = {};

  Object.entries(seasonGradesByYear).forEach(([year, seasonGrades]) => {
    Object.entries(seasonGrades).forEach(([managerId, result]) => {
      if (result.overallGrade == null) return;
      if (!byManager[managerId]) byManager[managerId] = { grades: [], years: [] };
      byManager[managerId].grades.push(result.overallGrade);
      byManager[managerId].years.push(year);
    });
  });

  const result = {};
  Object.entries(byManager).forEach(([managerId, data]) => {
    const avg = data.grades.reduce((s, g) => s + g, 0) / data.grades.length;
    result[managerId] = {
      allTimeGrade: Number(avg.toFixed(1)),
      seasonsCounted: data.grades.length,
      years: data.years
    };
  });

  return result;
}
