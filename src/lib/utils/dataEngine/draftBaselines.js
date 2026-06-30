// draftBaselines.js
//
// Computes historical round-by-round expected point baselines from actual
// draft and season stats data.
//
// PAR = actualPts − roundBaseline[round]
// This measures performance vs the historical average for that draft slot.
// A team whose picks beat their round averages has positive total PAR.
// Grades are now centered around 0 instead of all being negative.
//
// Season inclusion rules (based on roster setting consistency):
//   2023:  2023 only          (1 FLEX)
//   2024:  2024 only          (changed to 2 FLEX — different roster)
//   2025:  2024 + 2025        (rolling from 2024 onward)
//   2026+: 2024 through year  (rolling, always anchored at 2024)
//
// Monotonic smoothing enforces that later rounds never exceed earlier
// rounds (round 8 baseline can't be higher than round 7).

function getBaselineSeasons(scoringYear) {
  const year = Number(scoringYear);
  if (year <= 2023) return [2023];
  if (year === 2024) return [2024];
  const seasons = [];
  for (let y = 2024; y <= year; y++) seasons.push(y);
  return seasons;
}

/**
 * Computes round baselines from historical draft + season stats.
 *
 * @param {number|string} scoringYear
 * @param {Array}  allDrafts      - from getAllDrafts()
 * @param {Object} allSeasonStats - { [year]: { totals: {[id]: pts} } }
 * @returns {{ baselines, raw, seasonYears, sampleSizes } | null}
 */
export function computeRoundBaselines(scoringYear, allDrafts, allSeasonStats) {
  const seasonYears    = getBaselineSeasons(scoringYear);
  const relevantDrafts = allDrafts.filter((d) => seasonYears.includes(Number(d.year)));

  if (relevantDrafts.length === 0) return null;
  if (!allSeasonStats || Object.keys(allSeasonStats).length === 0) return null;

  // Aggregate points per round across all relevant seasons
  const roundData = {};

  relevantDrafts.forEach((draft) => {
    const stats = allSeasonStats[String(draft.year)]?.totals || {};
    draft.picks.forEach((pick) => {
      const round = Number(pick.round);
      // Use 0 for players with no stats (injured, IR, released) — draft risk is real
      const pts = stats[String(pick.playerId)] ?? 0;
      if (!roundData[round]) roundData[round] = { sum: 0, count: 0 };
      roundData[round].sum   += pts;
      roundData[round].count += 1;
    });
  });

  if (Object.keys(roundData).length === 0) return null;

  // Raw average per round
  const raw         = {};
  const sampleSizes = {};
  Object.entries(roundData).forEach(([round, data]) => {
    const r       = Number(round);
    raw[r]         = data.count > 0 ? data.sum / data.count : 0;
    sampleSizes[r] = data.count;
  });

  // Monotonic smoothing: enforce baselines[r] ≤ baselines[r-1]
  // Prevents statistical noise from making round 8 look better than round 7
  const rounds    = Object.keys(raw).map(Number).sort((a, b) => a - b);
  const baselines = {};
  let ceiling     = Infinity;

  rounds.forEach((r) => {
    const val    = Math.min(raw[r], ceiling);
    baselines[r] = val;
    ceiling      = val;
  });

  return { baselines, raw, seasonYears, sampleSizes };
}
