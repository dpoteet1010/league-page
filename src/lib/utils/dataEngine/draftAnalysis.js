// draftAnalysis.js
//
// PRE-SEASON (gradeDraftPreSeason): positional scarcity within the draft — unchanged.
//
// END-OF-SEASON (gradeDraftEndOfSeason):
//   For QB/RB/WR/TE:
//     actualPAR   = actualSeasonPts − replacementLevel[position]  (flex-aware for RB/WR)
//     expectedPAR = historical average actualPAR for that round
//     adjustedPAR = actualPAR − expectedPAR[round]
//
//   For K/DEF:
//     expectedPAR is forced to 0 — draft timing for K/DEF is irrelevant,
//     so adjustedPAR = actualPAR directly. No round adjustment applied.

const PICK_THRESHOLDS = {
  eliteSteal:  80,
  steal:       40,
  value:       15,
  asExpected:  -15,
  slightBust:  -35,
  bust:        -70,
};

const INJURY_MAJOR = 4;
const INJURY_MIN   = 8;
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

function fp(val, d = 1) {
  return typeof val === 'number' ? Number(val.toFixed(d)) : null;
}

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

// ── Pre-season grade (unchanged) ────────────────────────────────────────────

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
    adp[pos] = {
      count:   pickNums.length,
      avgPick: pickNums.reduce((s, v) => s + v, 0) / pickNums.length,
      bySlot:  pickNums
    };
  });
  return adp;
}

function pickValueScore(pickNo, totalPicks) {
  if (!totalPicks || totalPicks <= 1) return 0;
  const normalized = (totalPicks - pickNo) / (totalPicks - 1);
  return Math.round(Math.sqrt(normalized) * 100 * 10) / 10;
}

export function gradeDraftPreSeason(draft) {
  if (!draft?.picks?.length) return null;

  const { picks, numTeams, rounds } = draft;
  const totalPicks    = numTeams * rounds;
  const positionalADP = buildPositionalADP(picks);
  const posPickCount  = {};

  const gradedPicks = picks
    .slice()
    .sort((a, b) => a.pickNo - b.pickNo)
    .map((pick) => {
      const pos = normalizePos(pick.position, pick.playerId);
      if (!posPickCount[pos]) posPickCount[pos] = 0;
      posPickCount[pos]++;

      const positionalRank  = posPickCount[pos];
      const adpForPos       = positionalADP[pos];
      const avgPickAtRank   = adpForPos?.bySlot?.[positionalRank - 1] ?? pick.pickNo;
      const pickValue       = pickValueScore(pick.pickNo, totalPicks);
      const vsMarket        = avgPickAtRank - pick.pickNo;

      return {
        ...pick, pos, positionalRank, pickValue,
        vsMarket:      fp(vsMarket),
        avgPickAtRank: fp(avgPickAtRank),
        valueLabel:    vsMarket >  15 ? 'steal'
                     : vsMarket >   5 ? 'value'
                     : vsMarket < -15 ? 'reach'
                     : vsMarket <  -5 ? 'slight reach'
                     : 'fair'
      };
    });

  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks: [], totalPickValue: 0, vsMarketSum: 0,
        steals: [], reaches: []
      };
    }
    byRoster[r].picks.push(pick);
    byRoster[r].totalPickValue += pick.pickValue;
    byRoster[r].vsMarketSum    += pick.vsMarket || 0;
    if (pick.valueLabel === 'steal')               byRoster[r].steals.push(pick);
    if (pick.valueLabel.includes('reach'))         byRoster[r].reaches.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    const sorted = [...team.picks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0));
    team.bestValuePick  = sorted[0] || null;
    team.worstValuePick = sorted[sorted.length - 1] || null;
    const avgVsMarket   = team.picks.length > 0 ? team.vsMarketSum / team.picks.length : 0;
    team.avgVsMarket    = fp(avgVsMarket);
    team.grade = avgVsMarket >  8 ? 'A'
               : avgVsMarket >  3 ? 'B'
               : avgVsMarket > -3 ? 'C'
               : avgVsMarket > -8 ? 'D'
               : 'F';
  });

  return {
    year: draft.year, draftType: draft.draftType, totalPicks,
    positionalADP, gradedPicks, byRoster,
    teamRankings:     Object.values(byRoster).sort((a, b) => b.vsMarketSum - a.vsMarketSum),
    leagueTopSteals:  [...gradedPicks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0)).slice(0, 5),
    leagueTopReaches: [...gradedPicks].sort((a, b) => (a.vsMarket || 0) - (b.vsMarket || 0)).slice(0, 5)
  };
}

// ── End-of-season grade ────────────────────────────────────────────────────

export function gradeDraftEndOfSeason(
  draft, seasonStatTotals, gamesPlayed, roundBaselinesData, parTables, allPlayersData
) {
  if (!draft?.picks?.length || !seasonStatTotals || !roundBaselinesData || !parTables) return null;

  const { expectedPAR, raw, seasonYears, sampleSizes, excludedKDefCount } = roundBaselinesData;
  const debug = [];

  debug.push(`Grading ${draft.year} — adjusted PAR using round expectations from seasons: ${seasonYears.join(', ')}`);
  debug.push(`K/DEF picks excluded from round baseline calc: ${excludedKDefCount ?? 0} (K/DEF get expectedPAR=0, no round adjustment)`);
  debug.push(`Replacement levels (this season, flex-aware for RB/WR):`);
  Object.entries(parTables.replacementLevels || {}).forEach(([pos, pts]) => {
    debug.push(`  ${pos}: ${fp(pts)} pts (${parTables.replacementPlayerNames?.[pos] || '?'})`);
  });
  debug.push(`Expected PAR by round (smoothed, K/DEF excluded):`);
  Object.entries(expectedPAR)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([r, val]) => {
      debug.push(`  Round ${r}: ${fp(val)} expected PAR (raw: ${fp(raw[r])}, n=${sampleSizes[r]})`);
    });

  const gradedPicks = draft.picks.map((pick) => {
    const pos       = normalizePos(pick.position, pick.playerId) ||
                       normalizePos(allPlayersData?.[String(pick.playerId)]?.position, pick.playerId);
    const actualPts = seasonStatTotals[String(pick.playerId)] ?? null;
    const repLevel  = parTables.replacementLevels?.[pos]      ?? null;
    const repName   = parTables.replacementPlayerNames?.[pos]  ?? '(none)';

    const actualPAR = actualPts != null && repLevel != null ? actualPts - repLevel : null;

    // FIX: K/DEF get expectedPAR forced to 0 — no round-based adjustment.
    // Draft timing for K/DEF doesn't reflect skill, so adjustedPAR = actualPAR directly.
    const isExempt = NO_ROUND_ADJUSTMENT_POSITIONS.includes(pos);
    const expPAR   = isExempt ? 0 : (expectedPAR[Number(pick.round)] ?? null);
    const adjustedPAR = actualPAR != null && expPAR != null ? actualPAR - expPAR : null;

    const valueLabel = getPickLabel(adjustedPAR);

    const games      = gamesPlayed?.[String(pick.playerId)] ?? null;
    const injuryFlag = games != null && games < INJURY_MAJOR ? 'major-injury'
                     : games != null && games < INJURY_MIN   ? 'injury'
                     : null;

    return {
      ...pick,
      pos,
      actualPts:    fp(actualPts),
      repLevel:     fp(repLevel),
      repName,
      actualPAR:    fp(actualPAR),
      expectedPAR:  fp(expPAR),
      adjustedPAR:  fp(adjustedPAR),
      noRoundAdjustment: isExempt,
      valueLabel,
      injuryFlag,
      gamesPlayed:  games
    };
  });

  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks:          [],
        totalAdjustedPAR: 0,
        totalActualPAR:   0,
        totalActualPts:   0,
        steals:  [],
        busts:   [],
        injured: []
      };
    }

    byRoster[r].picks.push(pick);
    if (pick.adjustedPAR != null) byRoster[r].totalAdjustedPAR += parseFloat(pick.adjustedPAR);
    if (pick.actualPAR   != null) byRoster[r].totalActualPAR   += parseFloat(pick.actualPAR);
    if (pick.actualPts   != null) byRoster[r].totalActualPts   += parseFloat(pick.actualPts);

    if (pick.valueLabel === 'steal' || pick.valueLabel === 'elite steal') byRoster[r].steals.push(pick);
    if (pick.valueLabel === 'bust'  || pick.valueLabel === 'major bust')  byRoster[r].busts.push(pick);
    if (pick.injuryFlag)                                                   byRoster[r].injured.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    team.picks.sort((a, b) => Number(a.round) - Number(b.round) || Number(a.pickNo) - Number(b.pickNo));

    const sorted = [...team.picks]
      .filter((p) => p.adjustedPAR != null)
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

    const injuredAdjustedPAR = team.injured.reduce((s, p) => s + (parseFloat(p.adjustedPAR) || 0), 0);
    team.injuryExcludedPAR   = fp(team.totalAdjustedPAR - injuredAdjustedPAR);

    team.grade            = getTeamGrade(team.totalAdjustedPAR);
    team.totalAdjustedPAR = fp(team.totalAdjustedPAR);
    team.totalActualPAR   = fp(team.totalActualPAR);
    team.totalActualPts   = fp(team.totalActualPts);
  });

  const teamRankings = Object.values(byRoster)
    .sort((a, b) => parseFloat(b.totalAdjustedPAR) - parseFloat(a.totalAdjustedPAR));

  return {
    year:              draft.year,
    draftType:         draft.draftType,
    expectedPARByRound: expectedPAR,
    rawExpectedPAR:     raw,
    sampleSizes,
    baselineSeasons:    seasonYears,
    gradedPicks, byRoster, teamRankings, debug,
    replacementLevels:  parTables?.replacementLevels || {},
    replacementNames:   parTables?.replacementPlayerNames || {},
    flexLevel:          parTables?.flexLevel,
    flexPlayerName:     parTables?.flexPlayerName,
    leagueTopSteals: [...gradedPicks]
      .filter((p) => p.adjustedPAR != null)
      .sort((a, b) => parseFloat(b.adjustedPAR) - parseFloat(a.adjustedPAR))
      .slice(0, 10),
    leagueTopBusts: [...gradedPicks]
      .filter((p) => p.adjustedPAR != null)
      .sort((a, b) => parseFloat(a.adjustedPAR) - parseFloat(b.adjustedPAR))
      .slice(0, 10)
  };
}
