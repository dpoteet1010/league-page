// draftAnalysis.js
//
// POST-SEASON (gradeDraftEndOfSeason): adjusted PAR vs historical round baselines.
//   adjustedPAR = actualPAR − expectedPAR[round]
//   K/DEF: expectedPAR forced to 0, adjustedPAR = actualPAR directly.
//
// The actual "Draft Grades" article (right after the draft) is LLM-authored
// using real ADP/expert knowledge — see dataExport.js exportDraftResults +
// PROMPTS.draftGrades. This file only computes the data-based grade once a
// season is complete.

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

// ── POST-SEASON: data-based PAR grade ───────────────────────────────────────

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
