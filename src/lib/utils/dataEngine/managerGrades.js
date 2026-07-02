// managerGrades.js
//
// Manager grade = weighted blend of 4 components, each normalized 0-100
// using z-score centering (league average = 50):
//   40% Draft     — post-season adjusted PAR from gradeDraftEndOfSeason
//   20% Trades    — total trade PAR
//   20% Waivers   — total waiver PAR
//   20% Lineup IQ — fpts/ppts ratio
//
// Zero activity scores 50 (neutral), not 0. Missing components redistribute
// weight proportionally rather than penalizing the manager.

const WEIGHTS = { draft: 0.40, trades: 0.20, waivers: 0.20, lineupIQ: 0.20 };
const SCALE_FACTOR = 25; // ±1 std dev = 25 points from center (50)

function normalizeZScore(value, allRawValues) {
  if (value == null) return 50;
  const active = allRawValues.filter((v) => v != null);
  if (active.length === 0) return 50;
  const mean    = active.reduce((s, v) => s + v, 0) / active.length;
  const variance = active.reduce((s, v) => s + (v - mean) ** 2, 0) / active.length;
  const stdDev  = Math.sqrt(variance);
  if (stdDev === 0) return 50;
  return Math.max(0, Math.min(100, 50 + ((value - mean) / stdDev) * SCALE_FACTOR));
}

function computeFromScores(scores) {
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

  const totalAvailableWeight = available.reduce((s, c) => s + c.weight, 0);
  const overallGrade = available.reduce(
    (sum, c) => sum + c.score * (c.weight / totalAvailableWeight), 0
  );

  return {
    overallGrade:      Number(overallGrade.toFixed(1)),
    components:        components.map((c) => ({ ...c, effectiveWeight: c.score != null ? c.weight / totalAvailableWeight : 0 })),
    missingComponents: components.filter((c) => c.score == null).map((c) => c.key)
  };
}

export function computeSeasonManagerGrades(year, managerDraftPAR, managerTradePAR, managerWaiverPAR, managerLineupIQ, allManagerIds) {
  const rawDraft   = allManagerIds.map((id) => managerDraftPAR?.[id]  ?? null);
  const rawTrade   = allManagerIds.map((id) => {
    const v = managerTradePAR?.[id];
    return (v == null || v === 0) ? null : v;
  });
  const rawWaiver  = allManagerIds.map((id) => {
    const v = managerWaiverPAR?.[id];
    return (v == null || v === 0) ? null : v;
  });
  const rawLineup  = allManagerIds.map((id) => managerLineupIQ?.[id]  ?? null);

  const results = {};
  allManagerIds.forEach((managerId, idx) => {
    const normDraft   = normalizeZScore(rawDraft[idx],   rawDraft);
    const normTrade   = normalizeZScore(rawTrade[idx],   rawTrade);
    const normWaiver  = normalizeZScore(rawWaiver[idx],  rawWaiver);
    const normLineup  = normalizeZScore(rawLineup[idx],  rawLineup);

    results[managerId] = {
      ...computeFromScores({
        draft:    rawDraft[idx]   != null ? normDraft   : null,
        trades:   rawTrade[idx]   != null ? normTrade   : 50,
        waivers:  rawWaiver[idx]  != null ? normWaiver  : 50,
        lineupIQ: rawLineup[idx]  != null ? normLineup  : null
      }),
      rawDraftPAR:   rawDraft[idx],
      rawTradePAR:   managerTradePAR?.[managerId]  ?? null,
      rawWaiverPAR:  managerWaiverPAR?.[managerId] ?? null,
      rawLineupIQ:   managerLineupIQ?.[managerId]  ?? null,
      normDraft:     rawDraft[idx]  != null ? Number(normDraft.toFixed(1))  : null,
      normTrade:     Number(normTrade.toFixed(1)),
      normWaiver:    Number(normWaiver.toFixed(1)),
      normLineup:    rawLineup[idx] != null ? Number(normLineup.toFixed(1)) : null
    };
  });

  return results;
}

/**
 * All-time manager grades with per-component breakdowns across all seasons.
 * Includes per-season detail and averages for each of the 4 components.
 */
export function computeAllTimeManagerGrades(seasonGradesByYear) {
  const byManager = {};

  Object.entries(seasonGradesByYear).forEach(([year, seasonGrades]) => {
    Object.entries(seasonGrades).forEach(([managerId, result]) => {
      if (!byManager[managerId]) {
        byManager[managerId] = {
          overallGrades: [],
          normDraftArr:  [],
          normTradeArr:  [],
          normWaiverArr: [],
          normLineupArr: [],
          rawDraftArr:   [],
          rawTradeArr:   [],
          rawWaiverArr:  [],
          rawLineupArr:  [],
          years:         [],
          perSeason:     []
        };
      }

      const d = byManager[managerId];
      d.years.push(year);
      d.perSeason.push({ year, ...result });

      if (result.overallGrade != null)  d.overallGrades.push(result.overallGrade);
      if (result.normDraft    != null)  d.normDraftArr.push(result.normDraft);
      if (result.normTrade    != null)  d.normTradeArr.push(result.normTrade);
      if (result.normWaiver   != null)  d.normWaiverArr.push(result.normWaiver);
      if (result.normLineup   != null)  d.normLineupArr.push(result.normLineup);
      if (result.rawDraftPAR  != null)  d.rawDraftArr.push(result.rawDraftPAR);
      if (result.rawTradePAR  != null)  d.rawTradeArr.push(result.rawTradePAR);
      if (result.rawWaiverPAR != null)  d.rawWaiverArr.push(result.rawWaiverPAR);
      if (result.rawLineupIQ  != null)  d.rawLineupArr.push(result.rawLineupIQ);
    });
  });

  const avg = (arr) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  const result = {};
  Object.entries(byManager).forEach(([managerId, d]) => {
    result[managerId] = {
      allTimeGrade:        avg(d.overallGrades) != null ? Number(avg(d.overallGrades).toFixed(1)) : null,
      seasonsCounted:      d.overallGrades.length,
      years:               d.years,
      perSeason:           d.perSeason.sort((a, b) => Number(a.year) - Number(b.year)),
      // Component averages (normalized 0-100)
      avgNormDraft:        avg(d.normDraftArr)  != null ? Number(avg(d.normDraftArr).toFixed(1))  : null,
      avgNormTrade:        avg(d.normTradeArr)  != null ? Number(avg(d.normTradeArr).toFixed(1))  : null,
      avgNormWaiver:       avg(d.normWaiverArr) != null ? Number(avg(d.normWaiverArr).toFixed(1)) : null,
      avgNormLineup:       avg(d.normLineupArr) != null ? Number(avg(d.normLineupArr).toFixed(1)) : null,
      // Raw averages for context
      avgRawDraftPAR:      avg(d.rawDraftArr)   != null ? Number(avg(d.rawDraftArr).toFixed(1))   : null,
      avgRawTradePAR:      avg(d.rawTradeArr)   != null ? Number(avg(d.rawTradeArr).toFixed(1))   : null,
      avgRawWaiverPAR:     avg(d.rawWaiverArr)  != null ? Number(avg(d.rawWaiverArr).toFixed(1))  : null,
      avgRawLineupIQ:      avg(d.rawLineupArr)  != null ? Number(avg(d.rawLineupArr).toFixed(4))  : null
    };
  });

  return result;
}
