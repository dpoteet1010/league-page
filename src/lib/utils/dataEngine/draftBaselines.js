// draftBaselines.js
//
// Computes historical round-by-round EXPECTED PAR baselines.
//
// K and DEF picks are EXCLUDED from this calculation entirely — their
// draft timing is irrelevant (you draft your K/DEF in the last couple
// rounds regardless of skill), and including them artificially inflates/
// deflates the round averages for skill positions. K/DEF get expectedPAR
// forced to 0 in draftAnalysis.js instead — they're judged purely on
// actual PAR vs replacement, with no round-based adjustment.
//
// Step 1: For every historical non-K/DEF pick, compute actualPAR:
//           actualPAR = actualSeasonPts − replacementLevel[position]
//         (replacement level already includes the RB/WR flex-pool adjustment)
//
// Step 2: Group actualPAR by round and average:
//           expectedPAR[round] = avg(actualPAR for all historical non-K/DEF picks in that round)
//
// Step 3: Smooth monotonically so expectedPAR never increases in a later round.

const EXCLUDED_FROM_ROUND_BASELINE = ['K', 'DEF'];

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
 *
 * @param {number|string} scoringYear
 * @param {Array}  allDrafts          - from getAllDrafts()
 * @param {Object} allSeasonStats     - { [year]: { totals: {[id]: pts} } }
 * @param {Object} parTablesBySeason  - { [year]: { replacementLevels: {...} } }
 * @param {Object} allPlayersData     - full player info map
 * @returns {{ expectedPAR, raw, seasonYears, sampleSizes } | null}
 */
export function computeRoundBaselines(scoringYear, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData) {
  const seasonYears    = getBaselineSeasons(scoringYear);
  const relevantDrafts = allDrafts.filter((d) => seasonYears.includes(Number(d.year)));

  if (relevantDrafts.length === 0) return null;
  if (!allSeasonStats || Object.keys(allSeasonStats).length === 0) return null;

  const roundData = {};
  let excludedCount = 0;

  relevantDrafts.forEach((draft) => {
    const yearStr   = String(draft.year);
    const stats     = allSeasonStats[yearStr]?.totals || {};
    const parTables = parTablesBySeason?.[yearStr];
    const repLevels = parTables?.replacementLevels || {};

    draft.picks.forEach((pick) => {
      const round = Number(pick.round);
      const pos   = normalizePos(pick.position, pick.playerId) ||
                    normalizePos(allPlayersData?.[String(pick.playerId)]?.position, pick.playerId);

      // FIX: exclude K/DEF from round baseline calculation entirely
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

  // Monotonic smoothing
  const rounds      = Object.keys(raw).map(Number).sort((a, b) => a - b);
  const expectedPAR = {};
  let ceiling       = Infinity;

  rounds.forEach((r) => {
    const val      = Math.min(raw[r], ceiling);
    expectedPAR[r] = val;
    ceiling        = val;
  });

  return { expectedPAR, raw, seasonYears, sampleSizes, excludedKDefCount: excludedCount };
}
