// managerGrades.js
//
// Manager grade = weighted blend of 4 components, each normalized 0-100:
//   40% Draft       — post-season adjusted PAR from gradeDraftEndOfSeason
//   20% Trades      — total trade PAR this season
//   20% Waivers     — total waiver PAR this season
//   20% Lineup IQ   — fpts/ppts ratio
//
// NORMALIZATION: z-score centered at 50. League average = 50. Above-average
// performance scores above 50. Scale factor of 25 means ±1 std dev = 25 points.
// Clamped 0-100. Extreme outliers don't break the scale.
//
// ZERO ACTIVITY: managers with null/zero activity score 50 (neutral) for that
// component and are excluded from the distribution so they don't distort active
// managers' z-scores. "Did nothing" ≠ "did badly."
//
// MISSING COMPONENTS: weight redistributes proportionally so a manager with
// no draft data isn't unfairly penalized on their overall grade.

const WEIGHTS = { draft: 0.40, trades: 0.20, waivers: 0.20, lineupIQ: 0.20 };

// How many standard deviations maps to a 25-point swing from center (50).
// ±1 std dev → 25-75. ±2 std dev → 0-100 (clamped).
const SCALE_FACTOR = 25;

/**
 * Z-score normalization centered at 50.
 * Null values (no activity) are excluded from the distribution and scored 50.
 * Everyone scoring identically → all get 50.
 */
function normalizeZScore(value, allRawValues) {
  // No activity → neutral
  if (value == null) return 50;

  // Only include non-null values in the distribution
  const activeValues = allRawValues.filter((v) => v != null);
  if (activeValues.length === 0) return 50;

  const mean = activeValues.reduce((s, v) => s + v, 0) / activeValues.length;
  const variance = activeValues.reduce((s, v) => s + (v - mean) ** 2, 0) / activeValues.length;
  const stdDev = Math.sqrt(variance);

  // Everyone equal → all score 50
  if (stdDev === 0) return 50;

  const zScore = (value - mean) / stdDev;
  return Math.max(0, Math.min(100, 50 + zScore * SCALE_FACTOR));
}

/**
 * Computes one manager's grade for one season.
 *
 * @param {Object} scores    - { draft, trades, waivers, lineupIQ } — each 0-100 normalized, or null
 * @returns {{ overallGrade, components, missingComponents }}
 */
function computeManagerGradeFromScores(scores) {
  const components = [
    { key: 'draft',    score: scores.draft,    weight: WEIGHTS.draft },
    { key: 'trades',   score: scores.trades,   weight: WEIGHTS.trades },
    { key: 'waivers',  score: scores.waivers,  weight: WEIGHTS.waivers },
    { key: 'lineupIQ', score: scores.lineupIQ, weight: WEIGHTS.lineupIQ }
  ];

  const available = components.filter((c) => c.score != null);
  if (available.length === 0) {
    return { overallGrade: null, components, missingComponents: components.map((c) => c.key) };
  }

  // Redistribute weight proportionally across available components
  const totalAvailableWeight = available.reduce((s, c) => s + c.weight, 0);
  const overallGrade = available.reduce(
    (sum, c) => sum + c.score * (c.weight / totalAvailableWeight),
    0
  );

  return {
    overallGrade:      Number(overallGrade.toFixed(1)),
    components:        components.map((c) => ({ ...c, effectiveWeight: c.score != null ? c.weight / totalAvailableWeight : 0 })),
    missingComponents: components.filter((c) => c.score == null).map((c) => c.key)
  };
}

/**
 * Computes manager grades for every manager in a single season.
 *
 * Draft score comes from post-season adjusted PAR (gradeDraftEndOfSeason).
 * All raw values are z-score normalized within the league this season.
 *
 * @param {string|number} year
 * @param {Object} managerDraftPAR    - { [managerId]: totalAdjustedPAR } from post-season draft data
 * @param {Object} managerTradePAR    - { [managerId]: totalPAR } from transaction grading
 * @param {Object} managerWaiverPAR   - { [managerId]: totalPAR } from transaction grading
 * @param {Object} managerLineupIQ    - { [managerId]: fpts/ppts ratio } from roster stats
 * @param {Array}  allManagerIds
 */
export function computeSeasonManagerGrades(
  year, managerDraftPAR, managerTradePAR, managerWaiverPAR, managerLineupIQ, allManagerIds
) {
  // Collect raw values across all managers for normalization
  // Null = no data. 0-activity managers get 50 and are excluded from distribution.
  const rawDraftValues   = allManagerIds.map((id) => managerDraftPAR?.[id]  ?? null);
  const rawTradeValues   = allManagerIds.map((id) => {
    const v = managerTradePAR?.[id];
    return (v == null || v === 0) ? null : v; // 0 trades = null (neutral, not 0 PAR from bad trades)
  });
  const rawWaiverValues  = allManagerIds.map((id) => {
    const v = managerWaiverPAR?.[id];
    return (v == null || v === 0) ? null : v;
  });
  const rawLineupValues  = allManagerIds.map((id) => managerLineupIQ?.[id]  ?? null);

  const results = {};
  allManagerIds.forEach((managerId, idx) => {
    const normDraft   = normalizeZScore(rawDraftValues[idx],  rawDraftValues);
    const normTrade   = normalizeZScore(rawTradeValues[idx],  rawTradeValues);
    const normWaiver  = normalizeZScore(rawWaiverValues[idx], rawWaiverValues);
    const normLineup  = normalizeZScore(rawLineupValues[idx], rawLineupValues);

    results[managerId] = {
      ...computeManagerGradeFromScores({
        draft:    rawDraftValues[idx]  != null ? normDraft   : null,
        trades:   rawTradeValues[idx]  != null ? normTrade   : 50,   // 0 activity = 50 (neutral)
        waivers:  rawWaiverValues[idx] != null ? normWaiver  : 50,
        lineupIQ: rawLineupValues[idx] != null ? normLineup  : null
      }),
      // Raw values for display/debugging
      rawDraftPAR:   rawDraftValues[idx],
      rawTradePAR:   managerTradePAR?.[managerId] ?? null,
      rawWaiverPAR:  managerWaiverPAR?.[managerId] ?? null,
      rawLineupIQ:   managerLineupIQ?.[managerId]  ?? null,
      // Normalized scores
      normDraft:   rawDraftValues[idx]  != null ? Number(normDraft.toFixed(1))   : null,
      normTrade:   Number(normTrade.toFixed(1)),
      normWaiver:  Number(normWaiver.toFixed(1)),
      normLineup:  rawLineupValues[idx] != null ? Number(normLineup.toFixed(1))  : null
    };
  });

  return results;
}

/**
 * All-time manager grades: simple average of per-season overall grades.
 * Seasons without a grade are skipped.
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
      allTimeGrade:   Number(avg.toFixed(1)),
      seasonsCounted: data.grades.length,
      years:          data.years
    };
  });

  return result;
}
