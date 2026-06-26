// draftAnalysis.js
//
// Two independent draft grading analyses:
//
// 1. PRE-SEASON GRADE (gradeDraftPreSeason)
//    Evaluates pick value based on positional scarcity within the draft itself.
//    No external ADP data needed — uses the actual draft as its own baseline.
//    "Good value" = got a player at a position earlier than when the average
//    player at that position was taken by other teams.
//
// 2. END-OF-SEASON GRADE (gradeDraftEndOfSeason)
//    Evaluates how each pick actually performed. Uses actual season points
//    from the Sleeper stats API, builds an expected-points curve by pick
//    position, then measures each pick's actual production vs expectation.
//    Steals = late pick, high production.
//    Busts  = early pick, low production.

const POSITIONS_OF_INTEREST = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function normalizePos(position, playerId) {
  if (!position) {
    if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) return 'DEF';
    return null;
  }
  const p = position.toUpperCase();
  if (p === 'QB') return 'QB';
  if (p === 'RB') return 'RB';
  if (p === 'WR') return 'WR';
  if (p === 'TE') return 'TE';
  if (p === 'K')  return 'K';
  if (p === 'DEF' || p === 'DST') return 'DEF';
  return p;
}

function fp(val, d = 1) {
  return typeof val === 'number' ? Number(val.toFixed(d)) : null;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Assigns a pick value score using a smooth curve.
 * Pick 1 = ~100, final pick ≈ 0. Uses square-root decay so mid-round
 * picks retain meaningful value rather than collapsing linearly.
 */
function pickValueScore(pickNo, totalPicks) {
  if (!totalPicks || totalPicks <= 1) return 0;
  const normalized = (totalPicks - pickNo) / (totalPicks - 1);
  return Math.round(Math.sqrt(normalized) * 100 * 10) / 10;
}

/**
 * Groups picks by position and calculates the average pick number
 * at which each position was taken across the entire draft.
 * Used as the "market ADP" for pre-season value calculations.
 */
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
      // Per-slot ADP: what pick number was the Nth player at this position taken?
      bySlot:  pickNums // sorted ascending
    };
  });
  return adp;
}

// ── Pre-season grade ───────────────────────────────────────────────────────

/**
 * Grades a draft before the season starts using positional scarcity.
 *
 * For each pick:
 *   positional rank = rank among all players drafted at that position
 *   average pick for this positional rank = positionalADP.bySlot[rank - 1]
 *   value = averagePickForThisRank - actualPickNo
 *     positive → got this player earlier than avg (good value / steal)
 *     negative → waited longer than avg (late pick / reach)
 *
 * Team scores are summed pick values weighted by positional importance
 * (earlier positional picks matter more).
 *
 * @param {Object} draft   - normalized draft object from getAllDrafts()
 * @returns {Object} pre-season grade with per-team and per-pick breakdowns
 */
export function gradeDraftPreSeason(draft) {
  if (!draft?.picks?.length) return null;

  const { picks, numTeams, rounds } = draft;
  const totalPicks = numTeams * rounds;
  const positionalADP = buildPositionalADP(picks);

  // Track per-position pick rank as we process (how many of this position picked so far)
  const positionalPickCount = {};

  // Assign pick-level value scores
  const gradedPicks = picks
    .slice()
    .sort((a, b) => a.pickNo - b.pickNo)
    .map((pick) => {
      const pos = normalizePos(pick.position, pick.playerId);

      if (!positionalPickCount[pos]) positionalPickCount[pos] = 0;
      positionalPickCount[pos]++;

      const positionalRank = positionalPickCount[pos]; // 1-based
      const adpForPos      = positionalADP[pos];
      const avgPickAtRank  = adpForPos?.bySlot?.[positionalRank - 1] ?? pick.pickNo;
      const pickValue      = pickValueScore(pick.pickNo, totalPicks);

      // Value vs market: how many picks earlier/later than the typical
      // player taken at this positional rank
      const vsMarket = avgPickAtRank - pick.pickNo;

      return {
        ...pick,
        positionalRank,
        pos,
        pickValue,
        vsMarket: fp(vsMarket),
        avgPickAtRank: fp(avgPickAtRank),
        valueLabel: vsMarket > 15
          ? 'steal'
          : vsMarket > 5
            ? 'value'
            : vsMarket < -15
              ? 'reach'
              : vsMarket < -5
                ? 'slight reach'
                : 'fair'
      };
    });

  // Group by roster
  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId:   r,
        managerId:  pick.managerId,
        picks:      [],
        totalPickValue: 0,
        vsMarketSum:    0,
        steals:    [],
        reaches:   []
      };
    }
    byRoster[r].picks.push(pick);
    byRoster[r].totalPickValue += pick.pickValue;
    byRoster[r].vsMarketSum    += pick.vsMarket || 0;

    if (pick.valueLabel === 'steal')       byRoster[r].steals.push(pick);
    if (pick.valueLabel === 'reach')       byRoster[r].reaches.push(pick);
    if (pick.valueLabel === 'slight reach') byRoster[r].reaches.push(pick);
  });

  // Positional summary per team: when did they draft each position?
  Object.values(byRoster).forEach((team) => {
    const positional = {};
    team.picks.forEach((pick) => {
      const pos = pick.pos;
      if (!positional[pos]) positional[pos] = [];
      positional[pos].push({ round: pick.round, pickNo: pick.pickNo, playerName: pick.playerName });
    });
    team.positionalSummary = positional;

    // Best and worst value picks for this team
    const sorted = [...team.picks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0));
    team.bestValuePick  = sorted[0]   || null;
    team.worstValuePick = sorted[sorted.length - 1] || null;

    // Overall grade label
    const avgVsMarket = team.picks.length > 0 ? team.vsMarketSum / team.picks.length : 0;
    team.avgVsMarket = fp(avgVsMarket);
    team.grade = avgVsMarket > 8  ? 'A'
               : avgVsMarket > 3  ? 'B'
               : avgVsMarket > -3 ? 'C'
               : avgVsMarket > -8 ? 'D'
               : 'F';
  });

  // League-wide pick value rankings
  const teamRankings = Object.values(byRoster)
    .sort((a, b) => b.vsMarketSum - a.vsMarketSum);

  return {
    year:            draft.year,
    draftType:       draft.draftType,
    totalPicks,
    positionalADP,
    gradedPicks,
    byRoster,
    teamRankings,
    leagueTopSteals: [...gradedPicks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0)).slice(0, 5),
    leagueTopReaches: [...gradedPicks].sort((a, b) => (a.vsMarket || 0) - (b.vsMarket || 0)).slice(0, 5)
  };
}

// ── End-of-season grade ────────────────────────────────────────────────────

/**
 * Builds the expected points curve by pick position.
 *
 * Takes all drafted players with actual season stats and fits a curve:
 *   expectedPts(pickNo) = smooth trend of actual points by pick number
 *
 * Implementation: buckets picks into groups of ~6, averages actual points
 * per bucket, then interpolates. Simple and doesn't require curve-fitting math.
 */
function buildExpectedPointsCurve(gradedPicksWithActuals, totalPicks) {
  const bucketSize = Math.max(6, Math.floor(totalPicks / 20));
  const buckets = {};

  gradedPicksWithActuals.forEach(({ pickNo, actualPts }) => {
    if (actualPts == null) return;
    const bucket = Math.floor((pickNo - 1) / bucketSize);
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(actualPts);
  });

  const curve = {};
  Object.entries(buckets).forEach(([bucket, vals]) => {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const startPick = parseInt(bucket) * bucketSize + 1;
    const endPick   = startPick + bucketSize - 1;
    for (let p = startPick; p <= Math.min(endPick, totalPicks); p++) {
      curve[p] = avg;
    }
  });

  // Fill any gaps with nearest neighbor
  for (let p = 1; p <= totalPicks; p++) {
    if (curve[p] == null) {
      let nearest = null;
      let nearestDist = Infinity;
      Object.keys(curve).forEach((k) => {
        const dist = Math.abs(parseInt(k) - p);
        if (dist < nearestDist) { nearest = curve[k]; nearestDist = dist; }
      });
      curve[p] = nearest || 0;
    }
  }

  return curve;
}

/**
 * Grades a completed draft against actual season performance.
 *
 * For each drafted player:
 *   actualPts   = their total season points from getSeasonStatTotals()
 *   expectedPts = the smooth expected-points curve at their pick number
 *   PAR         = actualPts - expectedPts
 *     positive → outperformed their draft slot (steal)
 *     negative → underperformed their draft slot (bust)
 *
 * @param {Object} draft           - normalized draft object
 * @param {Object} seasonStatTotals - { [playerId]: totalPts } from getSeasonStatTotals()
 * @param {Object} allPlayersData   - from getAllPlayers()
 * @returns {Object} end-of-season grade with per-team and per-pick breakdowns
 */
export function gradeDraftEndOfSeason(draft, seasonStatTotals, allPlayersData) {
  if (!draft?.picks?.length || !seasonStatTotals) return null;

  const { picks, numTeams, rounds } = draft;
  const totalPicks = numTeams * rounds;

  // Attach actual points to each pick
  const picksWithActuals = picks.map((pick) => {
    const actualPts = seasonStatTotals[pick.playerId] ?? null;
    return { ...pick, actualPts, pos: normalizePos(pick.position, pick.playerId) };
  });

  // Build expected points curve from this draft's actual outcomes
  const expectedCurve = buildExpectedPointsCurve(picksWithActuals, totalPicks);

  // Grade each pick
  const gradedPicks = picksWithActuals.map((pick) => {
    const expectedPts = expectedCurve[pick.pickNo] ?? 0;
    const actualPts   = pick.actualPts ?? 0;
    const par         = actualPts - expectedPts;
    const pickValue   = pickValueScore(pick.pickNo, totalPicks);

    let valueLabel;
    if (pick.actualPts == null) {
      valueLabel = 'no data';
    } else if (par > 60) {
      valueLabel = 'elite steal';
    } else if (par > 25) {
      valueLabel = 'steal';
    } else if (par > 5) {
      valueLabel = 'value';
    } else if (par < -60) {
      valueLabel = 'major bust';
    } else if (par < -25) {
      valueLabel = 'bust';
    } else if (par < -5) {
      valueLabel = 'slight bust';
    } else {
      valueLabel = 'as expected';
    }

    return {
      ...pick,
      actualPts: fp(actualPts),
      expectedPts: fp(expectedPts),
      par: fp(par),
      pickValue,
      valueLabel
    };
  });

  // Group by roster
  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId:  r,
        managerId: pick.managerId,
        picks:     [],
        totalActualPts:   0,
        totalExpectedPts: 0,
        totalPAR:  0,
        steals:    [],
        busts:     []
      };
    }

    byRoster[r].picks.push(pick);
    byRoster[r].totalActualPts   += pick.actualPts   || 0;
    byRoster[r].totalExpectedPts += pick.expectedPts || 0;
    byRoster[r].totalPAR         += pick.par         || 0;

    if (pick.valueLabel === 'steal' || pick.valueLabel === 'elite steal') {
      byRoster[r].steals.push(pick);
    }
    if (pick.valueLabel === 'bust' || pick.valueLabel === 'major bust') {
      byRoster[r].busts.push(pick);
    }
  });

  Object.values(byRoster).forEach((team) => {
    // Round 1 picks only for headline grade (most impactful)
    const round1 = team.picks.filter((p) => p.round === 1);
    const round1PAR = round1.reduce((s, p) => s + (p.par || 0), 0);

    // Best/worst picks by PAR
    const sorted = [...team.picks]
      .filter((p) => p.actualPts != null)
      .sort((a, b) => (b.par || 0) - (a.par || 0));

    team.bestPick  = sorted[0]   || null;
    team.worstPick = sorted[sorted.length - 1] || null;

    // Positional breakdown: how many pts did each position contribute
    const positional = {};
    team.picks.forEach((pick) => {
      const pos = pick.pos;
      if (!positional[pos]) positional[pos] = { picks: 0, totalPts: 0, totalPAR: 0 };
      positional[pos].picks    += 1;
      positional[pos].totalPts += pick.actualPts  || 0;
      positional[pos].totalPAR += pick.par        || 0;
    });
    team.positionalBreakdown = positional;

    // Overall grade
    const totalPAR = team.totalPAR;
    team.grade = totalPAR > 200 ? 'A+'
               : totalPAR > 100 ? 'A'
               : totalPAR > 40  ? 'B'
               : totalPAR > -40 ? 'C'
               : totalPAR > -100 ? 'D'
               : 'F';

    team.totalActualPts   = fp(team.totalActualPts);
    team.totalExpectedPts = fp(team.totalExpectedPts);
    team.totalPAR         = fp(team.totalPAR);
  });

  const teamRankings = Object.values(byRoster)
    .sort((a, b) => (b.totalPAR || 0) - (a.totalPAR || 0));

  return {
    year:       draft.year,
    draftType:  draft.draftType,
    totalPicks,
    expectedCurve,
    gradedPicks,
    byRoster,
    teamRankings,
    leagueTopSteals: [...gradedPicks]
      .filter((p) => p.actualPts != null)
      .sort((a, b) => (b.par || 0) - (a.par || 0))
      .slice(0, 10),
    leagueTopBusts: [...gradedPicks]
      .filter((p) => p.actualPts != null)
      .sort((a, b) => (a.par || 0) - (b.par || 0))
      .slice(0, 10)
  };
}
