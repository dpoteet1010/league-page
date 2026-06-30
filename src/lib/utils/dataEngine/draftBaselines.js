// draftBaselines.js
//
// Computes historical round-by-round EXPECTED PAR baselines, used by the
// post-season data-based draft grade.
//
// IMPORTANT: for baseline purposes only, ALL seasons (including 2023) are
// evaluated using a 2-FLEX replacement level assumption, so historical
// data is consistent across years regardless of the real league setting
// that season. This does NOT affect real per-season PAR grading elsewhere
// (trades/waivers/actual draft grades), which still correctly use 1 FLEX
// for 2023 and 2 FLEX for 2024+.
//
// K and DEF are excluded entirely from round baseline calculation — their
// draft timing doesn't reflect skill and would distort skill-position rounds.

import { buildSeasonPARTables } from './parGrading.js';

const EXCLUDED_FROM_ROUND_BASELINE = ['K', 'DEF'];
const BASELINE_FLEX_SLOTS = 2; // forced for all years, for baseline consistency only

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
 * Computes expected PAR baselines per round, excluding K/DEF picks.
 * Builds its OWN baseline-only PAR tables (always 2 FLEX) rather than
 * using the real per-season parTables, so 2023 is treated consistently
 * with 2024+ for this calculation specifically.
 *
 * @param {number|string} scoringYear
 * @param {Array}  allDrafts      - from getAllDrafts()
 * @param {Object} allSeasonStats - { [year]: { totals: {[id]: pts} } }
 * @param {Object} allPlayersData - full player info map
 * @returns {{ expectedPAR, raw, seasonYears, sampleSizes, excludedKDefCount } | null}
 */
export function computeRoundBaselines(scoringYear, allDrafts, allSeasonStats, allPlayersData) {
  const seasonYears    = getBaselineSeasons(scoringYear);
  const relevantDrafts = allDrafts.filter((d) => seasonYears.includes(Number(d.year)));

  if (relevantDrafts.length === 0) return null;
  if (!allSeasonStats || Object.keys(allSeasonStats).length === 0) return null;

  const debug = [];

  // Build baseline-only PAR tables for each relevant season — ALWAYS 2 FLEX,
  // independent of that season's real setting (this is the 2023-consistency fix).
  const baselineParTables = {};
  relevantDrafts.forEach((draft) => {
    const yearStr = String(draft.year);
    const stats   = allSeasonStats[yearStr]?.totals || {};
    baselineParTables[yearStr] = buildSeasonPARTables(stats, allPlayersData, draft.numTeams, BASELINE_FLEX_SLOTS);
    debug.push(`[Baseline ${yearStr}] Recomputed with forced 2-FLEX assumption for historical consistency.`);
  });

  const roundData = {};
  let excludedCount = 0;

  relevantDrafts.forEach((draft) => {
    const yearStr   = String(draft.year);
    const stats     = allSeasonStats[yearStr]?.totals || {};
    const repLevels = baselineParTables[yearStr]?.replacementLevels || {};

    draft.picks.forEach((pick) => {
      const round = Number(pick.round);
      const pos   = normalizePos(pick.position, pick.playerId) ||
                    normalizePos(allPlayersData?.[String(pick.playerId)]?.position, pick.playerId);

      if (EXCLUDED_FROM_ROUND_BASELINE.includes(pos)) {
        excludedCount++;
        return;
      }

      const actualPts = stats[String(pick.playerId)] ?? 0;
      const repLevel  = repLevels[pos] ?? null;
      if (repLevel == null) return;

      const actualPAR = actualPts - repLevel;

      if (!roundData[round]) roundData[round] = { sum: 0, count: 0 };
      roundData[round].sum   += actualPAR;
      roundData[round].count += 1;
    });
  });

  if (Object.keys(roundData).length === 0) return null;

  const raw         = {};
  const sampleSizes = {};
  Object.entries(roundData).forEach(([round, data]) => {
    const r       = Number(round);
    raw[r]         = data.count > 0 ? data.sum / data.count : 0;
    sampleSizes[r] = data.count;
  });

  // Monotonic smoothing — expectedPAR[r] ≤ expectedPAR[r-1]
  const rounds      = Object.keys(raw).map(Number).sort((a, b) => a - b);
  const expectedPAR = {};
  let ceiling       = Infinity;
  rounds.forEach((r) => {
    const val      = Math.min(raw[r], ceiling);
    expectedPAR[r] = val;
    ceiling        = val;
  });

  return { expectedPAR, raw, seasonYears, sampleSizes, excludedKDefCount: excludedCount, debug };
}
