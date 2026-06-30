// draftBaselines.js
//
// Computes historical round-by-round EXPECTED PAR baselines.
//
// Step 1: For every historical pick, compute its actualPAR:
//           actualPAR = actualSeasonPts − replacementLevel[position]
//         using that pick's OWN season's replacement levels (position-aware,
//         scarcity already baked in via replacement level).
//
// Step 2: Group actualPAR by round across all baseline seasons and average:
//           expectedPAR[round] = avg(actualPAR for all historical picks in that round)
//
// Step 3: Smooth monotonically so expectedPAR never increases in a later round
//         (round 8 expected PAR can't exceed round 7's).
//
// Final grading formula (used in draftAnalysis.js):
//   adjustedPAR = actualPAR − expectedPAR[round]
//
// Season inclusion rules:
//   2023:  2023 only          (1 FLEX)
//   2024:  2024 only          (2 FLEX — different roster, can't mix with 2023)
//   2025:  2024 + 2025        (rolling from 2024 onward)
//   2026+: 2024 through year  (rolling, anchored at 2024)

function getBaselineSeasons(scoringYear) {
  const year = Number(scoringYear);
  if (year <= 2023) return [2023];
  if (year === 2024) return [2024];
  const seasons = [];
  for (let y = 2024; y <= year; y++) seasons.push(y);
  return seasons;
}

function normalizePos(position, playerId) {
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

/**
 * Computes expected PAR baselines per round from historical draft + season
 * stats + replacement-level data.
 *
 * @param {number|string} scoringYear
 * @param {Array}  allDrafts          - from getAllDrafts()
 * @param {Object} allSeasonStats     - { [year]: { totals: {[id]: pts} } }
 * @param {Object} parTablesBySeason  - { [year]: { replacementLevels: {...} } }
 * @param {Object} allPlayersData     - full player info map (for position lookup)
 * @returns {{ expectedPAR, raw, seasonYears, sampleSizes } | null}
 */
export function computeRoundBaselines(scoringYear, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData) {
  const seasonYears    = getBaselineSeasons(scoringYear);
  const relevantDrafts = allDrafts.filter((d) => seasonYears.includes(Number(d.year)));

  if (relevantDrafts.length === 0) return null;
  if (!allSeasonStats || Object.keys(allSeasonStats).length === 0) return null;

  // Step 1 + 2: compute actualPAR for every historical pick, grouped by round
  const roundData = {};

  relevantDrafts.forEach((draft) => {
    const yearStr      = String(draft.year);
    const stats         = allSeasonStats[yearStr]?.totals || {};
    const parTables     = parTablesBySeason?.[yearStr];
    const repLevels      = parTables?.replacementLevels || {};

    draft.picks.forEach((pick) => {
      const round = Number(pick.round);
      const pos   = normalizePos(pick.position, pick.playerId) ||
                    normalizePos(allPlayersData?.[String(pick.playerId)]?.position, pick.playerId);

      const actualPts = stats[String(pick.playerId)] ?? 0; // unrostered/IR players = 0 pts, real draft risk
      const repLevel  = repLevels[pos] ?? null;

      // Skip if we can't determine a replacement level for this position/season
      if (repLevel == null) return;

      const actualPAR = actualPts - repLevel;

      if (!roundData[round]) roundData[round] = { sum: 0, count: 0 };
      roundData[round].sum   += actualPAR;
      roundData[round].count += 1;
    });
  });

  if (Object.keys(roundData).length === 0) return null;

  // Raw average actualPAR per round = expectedPAR before smoothing
  const raw         = {};
  const sampleSizes = {};
  Object.entries(roundData).forEach(([round, data]) => {
    const r       = Number(round);
    raw[r]         = data.count > 0 ? data.sum / data.count : 0;
    sampleSizes[r] = data.count;
  });

  // Step 3: monotonic smoothing — expectedPAR[r] ≤ expectedPAR[r-1]
  const rounds      = Object.keys(raw).map(Number).sort((a, b) => a - b);
  const expectedPAR = {};
  let ceiling       = Infinity;

  rounds.forEach((r) => {
    const val      = Math.min(raw[r], ceiling);
    expectedPAR[r] = val;
    ceiling        = val;
  });

  return { expectedPAR, raw, seasonYears, sampleSizes };
}
