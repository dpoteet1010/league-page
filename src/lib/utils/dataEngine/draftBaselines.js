// draftBaselines.js
//
// Computes expected PAR per round for post-season draft grading.
//
// Season inclusion rules:
//   2023:  2023 data only, REAL 1-FLEX settings (as the league actually played)
//   2024:  2023 (forced 2-FLEX) + 2024, averaged equally per round
//   2025+: 2023 (forced 2-FLEX) + 2024 through scoringYear, averaged per round
//
// The 2-FLEX forcing of 2023 data ONLY applies when 2023 is used as a
// historical reference for 2024+ baselines, ensuring the PAR scales are
// consistent. The 2023 season's OWN grade still uses real 1-FLEX settings.
//
// Averaging is per-year, not per-pick: if round 1 expected PAR in 2023
// is 100 and in 2024 is 120, the 2024 baseline for round 1 is 110.
//
// K/DEF excluded entirely — draft timing for K/DEF doesn't reflect skill.

import { buildSeasonPARTables } from './parGrading.js';

const EXCLUDED_FROM_ROUND_BASELINE = ['K', 'DEF'];

function normalizePos(position, playerId) {
  if (!position) {
    if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) return 'DEF';
    return null;
  }
  const p = position.toUpperCase();
  if (p === 'QB')                  return 'QB';
  if (p === 'RB')                  return 'RB';
  if (p === 'WR')                  return 'WR';
  if (p === 'TE')                  return 'TE';
  if (p === 'K')                   return 'K';
  if (p === 'DEF' || p === 'DST')  return 'DEF';
  return p;
}

/**
 * Builds the baseline config for a given scoring year:
 * which historical seasons to include, and whether to force 2-FLEX for each.
 */
function getBaselineConfig(scoringYear) {
  const year = Number(scoringYear);
  if (year <= 2023) {
    // 2023's own grade: only 2023 data with REAL 1-FLEX (unchanged)
    return [{ year: 2023, useForced2Flex: false }];
  }
  if (year === 2024) {
    // 2024 baseline: 2023 (forced 2-FLEX for consistency) + 2024 (real 2-FLEX)
    return [
      { year: 2023, useForced2Flex: true },
      { year: 2024, useForced2Flex: false }
    ];
  }
  // 2025+: 2023 (forced 2-FLEX) + 2024 through scoringYear (all real)
  const config = [{ year: 2023, useForced2Flex: true }];
  for (let y = 2024; y <= year; y++) {
    config.push({ year: y, useForced2Flex: false });
  }
  return config;
}

/**
 * Computes the average actualPAR per round for one season, using the
 * supplied replacement levels (which may be forced 2-FLEX or real).
 */
function computeYearRoundAverages(draft, stats, repLevels, allPlayersData) {
  const roundData = {};
  let excludedCount = 0;

  draft.picks.forEach((pick) => {
    const pos = normalizePos(pick.position, pick.playerId) ||
                normalizePos(allPlayersData?.[String(pick.playerId)]?.position, pick.playerId);

    if (EXCLUDED_FROM_ROUND_BASELINE.includes(pos)) {
      excludedCount++;
      return;
    }

    const repLevel  = repLevels[pos] ?? null;
    if (repLevel == null) return;

    const actualPts = stats[String(pick.playerId)] ?? 0;
    const actualPAR = actualPts - repLevel;
    const round     = Number(pick.round);

    if (!roundData[round]) roundData[round] = { sum: 0, count: 0 };
    roundData[round].sum   += actualPAR;
    roundData[round].count += 1;
  });

  const averages = {};
  Object.entries(roundData).forEach(([round, data]) => {
    averages[Number(round)] = data.count > 0 ? data.sum / data.count : 0;
  });

  return { averages, excludedCount };
}

/**
 * Computes expected PAR baselines per round from historical draft + season
 * stats. Uses the correct treatment for each season and averages equally
 * across years (not weighted by pick count).
 *
 * @param {number|string} scoringYear
 * @param {Array}  allDrafts         - from getAllDrafts()
 * @param {Object} allSeasonStats    - { [year]: { totals, gamesPlayed } }
 * @param {Object} parTablesBySeason - { [year]: { replacementLevels, ... } }
 * @param {Object} allPlayersData    - full player info map
 */
export function computeRoundBaselines(scoringYear, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData) {
  const baselineConfig = getBaselineConfig(scoringYear);
  const debug          = [];
  debug.push(`Computing round baselines for ${scoringYear} using seasons: ${baselineConfig.map(c => `${c.year}${c.useForced2Flex ? '(2-FLEX forced)' : ''}`).join(', ')}`);

  const perYearRoundAverages = {};
  let totalExcluded = 0;

  for (const { year: baseYear, useForced2Flex } of baselineConfig) {
    const draft    = allDrafts.find((d) => Number(d.year) === baseYear);
    const yearStr  = String(baseYear);
    const stats    = allSeasonStats[yearStr]?.totals || {};

    if (!draft) {
      debug.push(`  ${baseYear}: no draft data found — skipping.`);
      continue;
    }
    if (Object.keys(stats).length === 0) {
      debug.push(`  ${baseYear}: no season stats found — skipping.`);
      continue;
    }

    let repLevels;
    if (useForced2Flex) {
      // Build a temporary PAR table with forced 2-FLEX for baseline consistency
      const forcedTable = buildSeasonPARTables(stats, allPlayersData, draft.numTeams, 2);
      repLevels = forcedTable.replacementLevels;
      debug.push(`  ${baseYear}: using FORCED 2-FLEX replacement levels for consistency. RB=${forcedTable.replacementLevels.RB?.toFixed(1)}, WR=${forcedTable.replacementLevels.WR?.toFixed(1)}`);
    } else {
      // Use the real PAR table for this season (correct flex setting)
      repLevels = parTablesBySeason[yearStr]?.replacementLevels || {};
      debug.push(`  ${baseYear}: using REAL replacement levels. RB=${repLevels.RB?.toFixed(1)}, WR=${repLevels.WR?.toFixed(1)}`);
    }

    const { averages, excludedCount } = computeYearRoundAverages(draft, stats, repLevels, allPlayersData);
    perYearRoundAverages[baseYear] = averages;
    totalExcluded += excludedCount;
    debug.push(`  ${baseYear}: computed round averages (${excludedCount} K/DEF picks excluded). Sample rounds: R1=${averages[1]?.toFixed(1)}, R2=${averages[2]?.toFixed(1)}, R5=${averages[5]?.toFixed(1)}`);
  }

  if (Object.keys(perYearRoundAverages).length === 0) {
    debug.push('No valid baseline data — cannot compute expected PAR.');
    return null;
  }

  // Collect all rounds that appear in at least one year
  const allRounds = new Set();
  Object.values(perYearRoundAverages).forEach((yearAvgs) => {
    Object.keys(yearAvgs).forEach((r) => allRounds.add(Number(r)));
  });

  // Average per-year values equally (each year has equal weight regardless of pick count)
  const raw         = {};
  const sampleSizes = {}; // = number of seasons contributing to this round's average
  const perYearContributions = {}; // for debug display

  allRounds.forEach((round) => {
    const contributions = [];
    Object.entries(perYearRoundAverages).forEach(([yr, yearAvgs]) => {
      if (yearAvgs[round] != null) {
        contributions.push({ year: Number(yr), value: yearAvgs[round] });
      }
    });

    if (contributions.length > 0) {
      raw[round]         = contributions.reduce((s, c) => s + c.value, 0) / contributions.length;
      sampleSizes[round] = contributions.length;
      perYearContributions[round] = contributions;
    }
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

  debug.push(`Expected PAR by round (smoothed, K/DEF excluded, ${totalExcluded} total K/DEF picks excluded):`);
  rounds.forEach((r) => {
    const contribs = (perYearContributions[r] || []).map((c) => `${c.year}:${c.value.toFixed(1)}`).join(', ');
    debug.push(`  Round ${r}: ${expectedPAR[r].toFixed(1)} (raw avg: ${raw[r].toFixed(1)} from [${contribs}]${raw[r] !== expectedPAR[r] ? ' → smoothed from ' + raw[r].toFixed(1) : ''})`);
  });

  return {
    expectedPAR,
    raw,
    seasonYears:          baselineConfig.map((c) => c.year),
    baselineConfig,
    sampleSizes,          // number of years averaged per round
    perYearRoundAverages, // per-year raw averages for debugging
    excludedKDefCount:    totalExcluded,
    debug
  };
}
