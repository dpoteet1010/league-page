// draftAnalysis.js
//
// Two draft grading modes:
//
// PRE-SEASON (gradeDraftPreSeason):
//   Grades based on positional scarcity within the draft itself.
//   "Did you get this position's player earlier than average?"
//   No external data needed.
//
// END-OF-SEASON (gradeDraftEndOfSeason):
//   Builds an expected-points curve via optimal draft simulation,
//   then measures each pick's actual production against it.
//
// OPTIMAL DRAFT SIMULATION:
//   Mimics how people actually draft using a phase-based approach:
//   - Rounds 1-2:  Only RB/WR (positional scarcity drives early picks)
//   - Rounds 3-5:  Adds QB and TE (elite options go here)
//   - Rounds 6+:   All skill positions (RB/WR/TE/QB)
//   - Last 2 rds:  Adds K and DEF
//
//   Each pick takes the best available player at eligible positions,
//   respecting per-team roster caps so no team stockpiles one position.
//   The resulting pick→expectedPts mapping is the baseline for PAR.
//
// INJURY FLAGS:
//   Picks are flagged when gamesPlayed < 8 (roughly half the season).
//   PAR still reflects full underperformance — injury is a context note,
//   not an excuse. Teams survive bad draft picks through trades/waivers.

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// Minimum games played before flagging as injury-affected
const INJURY_GAMES_THRESHOLD         = 8;   // < 8 = flagged
const INJURY_GAMES_MAJOR_THRESHOLD   = 4;   // < 4 = major injury

export function normalizePos(position, playerId) {
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

function pickValueScore(pickNo, totalPicks) {
  if (!totalPicks || totalPicks <= 1) return 0;
  const normalized = (totalPicks - pickNo) / (totalPicks - 1);
  return Math.round(Math.sqrt(normalized) * 100 * 10) / 10;
}

// ── Optimal draft simulation ───────────────────────────────────────────────

/**
 * Determines which positions are eligible at a given pick number.
 *
 * Phase rules (realistic draft behavior):
 *   Rounds 1-2:  RB and WR only — managers prioritize positional scarcity
 *   Rounds 3-5:  Add QB and TE — elite options (Kelce, Mahomes) go here
 *   Round 6+:    All skill positions
 *   Last 2 rds:  Add K and DEF
 *
 * Additionally respects per-team roster caps — a team won't draft a
 * 3rd QB if they only need 2, keeping the simulation realistic.
 */
function getEligiblePositions(round, totalRounds, teamNeeds) {
  const isLastTwoRounds = round >= totalRounds - 2;

  let eligible = [];

  if (round < 2) {
    // Rounds 1-2: RB/WR only
    eligible = ['RB', 'WR'];
  } else if (round < 5) {
    // Rounds 3-5: skill positions (no K/DEF)
    eligible = ['RB', 'WR', 'TE', 'QB'];
  } else {
    // Round 6+: all skill positions
    eligible = ['RB', 'WR', 'TE', 'QB'];
  }

  if (isLastTwoRounds) {
    eligible = [...eligible, 'K', 'DEF'];
  }

  // Filter to positions the team still needs (has remaining capacity)
  const stillNeeded = eligible.filter((pos) => (teamNeeds[pos] || 0) > 0);

  // If all filtered positions are filled, open up everything remaining
  if (stillNeeded.length === 0) {
    return POSITIONS.filter((pos) => (teamNeeds[pos] || 0) > 0);
  }

  return stillNeeded;
}

/**
 * Simulates an optimal snake draft and returns the expected-points curve.
 *
 * @param {Object} seasonStatTotals - { [playerId]: totalPts }
 * @param {Object} allPlayersData   - full player info map
 * @param {number} numTeams
 * @param {number} rounds
 * @param {Object} leagueSettings   - { QB, RB, WR, TE, FLEX, K, DEF, BN }
 * @returns {Object} { [pickNo]: expectedPts }
 */
export function simulateOptimalDraft(seasonStatTotals, allPlayersData, numTeams, rounds, leagueSettings) {
  const debug = [];
  const totalPicks = numTeams * rounds;

  // Per-team roster caps: how many of each position can one team draft?
  // Starters + bench approximation: 2× starters for skill, 1 for K/DEF
  // FLEX adds capacity to RB/WR/TE
  const flexSlots = leagueSettings?.FLEX || 1;
  const bnSlots   = leagueSettings?.BN   || 6;

  const rosterCap = {
    QB:  (leagueSettings?.QB  || 1) + Math.min(2, Math.floor(bnSlots / 4)),
    RB:  (leagueSettings?.RB  || 2) + Math.ceil(flexSlots / 2) + Math.floor(bnSlots / 3),
    WR:  (leagueSettings?.WR  || 2) + Math.ceil(flexSlots / 2) + Math.floor(bnSlots / 3),
    TE:  (leagueSettings?.TE  || 1) + 1,
    K:   leagueSettings?.K    || 1,
    DEF: leagueSettings?.DEF  || 1
  };

  debug.push(`Roster caps per team: ${JSON.stringify(rosterCap)}`);

  // Build sorted player pool per position
  const poolByPosition = {};
  POSITIONS.forEach((pos) => { poolByPosition[pos] = []; });

  Object.entries(seasonStatTotals || {}).forEach(([playerId, pts]) => {
    if (!pts || pts <= 0) return;
    const pos = normalizePos(allPlayersData[playerId]?.position, playerId);
    if (!pos || !poolByPosition[pos]) return;
    const info = allPlayersData[playerId];
    poolByPosition[pos].push({
      playerId,
      pts,
      name: info?.full_name || `Player ${playerId}`
    });
  });

  POSITIONS.forEach((pos) => {
    poolByPosition[pos].sort((a, b) => b.pts - a.pts);
  });

  // Track next available index per position
  const posIdx = {};
  POSITIONS.forEach((pos) => { posIdx[pos] = 0; });

  // Initialize teams with roster needs
  const teams = Array.from({ length: numTeams }, () => {
    const needs = {};
    POSITIONS.forEach((pos) => { needs[pos] = rosterCap[pos] || 0; });
    return { needs };
  });

  // Simulate snake draft
  const expectedCurve = {};
  const simulationLog = [];

  for (let round = 0; round < rounds; round++) {
    // Snake: even rounds go forward, odd rounds go backward
    const isReverse = round % 2 === 1;
    const pickOrder = Array.from({ length: numTeams }, (_, i) =>
      isReverse ? numTeams - 1 - i : i
    );

    for (const teamIdx of pickOrder) {
      const pickNo = round * numTeams + (isReverse ? numTeams - teamIdx : teamIdx + 1);
      const team   = teams[teamIdx];

      const eligible = getEligiblePositions(round, rounds, team.needs);

      // Find best available player across eligible positions
      let bestPts   = -1;
      let bestPos   = null;
      let bestEntry = null;

      eligible.forEach((pos) => {
        const idx   = posIdx[pos] || 0;
        const entry = poolByPosition[pos]?.[idx];
        if (entry && entry.pts > bestPts) {
          bestPts   = entry.pts;
          bestPos   = pos;
          bestEntry = entry;
        }
      });

      if (bestPos && bestEntry) {
        expectedCurve[pickNo] = bestPts;
        posIdx[bestPos]++;
        team.needs[bestPos] = Math.max(0, (team.needs[bestPos] || 0) - 1);

        if (pickNo <= 36 || pickNo > totalPicks - 24) {
          simulationLog.push(`Pick ${pickNo} (Rd${round+1}): ${bestEntry.name} (${bestPos}) — ${fp(bestPts)} pts`);
        }
      } else {
        // No eligible player — fallback: take anything available
        let fallbackPts = 0;
        let fallbackPos = null;
        POSITIONS.forEach((pos) => {
          if ((team.needs[pos] || 0) <= 0) return;
          const entry = poolByPosition[pos]?.[posIdx[pos] || 0];
          if (entry && entry.pts > fallbackPts) {
            fallbackPts = entry.pts;
            fallbackPos = pos;
          }
        });
        if (fallbackPos) {
          expectedCurve[pickNo] = fallbackPts;
          posIdx[fallbackPos]++;
          team.needs[fallbackPos] = Math.max(0, (team.needs[fallbackPos] || 0) - 1);
        } else {
          expectedCurve[pickNo] = 0;
        }
      }
    }
  }

  debug.push(...simulationLog);
  debug.push(`Simulation complete. Expected pts at pick 1: ${fp(expectedCurve[1])}, pick 12: ${fp(expectedCurve[12])}, pick 13: ${fp(expectedCurve[13])}, pick 36: ${fp(expectedCurve[36])}`);

  return { expectedCurve, debug };
}

// ── Pre-season grade (unchanged) ───────────────────────────────────────────

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
      count:  pickNums.length,
      avgPick: pickNums.reduce((s, v) => s + v, 0) / pickNums.length,
      bySlot: pickNums
    };
  });
  return adp;
}

export function gradeDraftPreSeason(draft) {
  if (!draft?.picks?.length) return null;

  const { picks, numTeams, rounds } = draft;
  const totalPicks    = numTeams * rounds;
  const positionalADP = buildPositionalADP(picks);
  const positionalPickCount = {};

  const gradedPicks = picks
    .slice()
    .sort((a, b) => a.pickNo - b.pickNo)
    .map((pick) => {
      const pos = normalizePos(pick.position, pick.playerId);
      if (!positionalPickCount[pos]) positionalPickCount[pos] = 0;
      positionalPickCount[pos]++;

      const positionalRank  = positionalPickCount[pos];
      const adpForPos       = positionalADP[pos];
      const avgPickAtRank   = adpForPos?.bySlot?.[positionalRank - 1] ?? pick.pickNo;
      const pickValue       = pickValueScore(pick.pickNo, totalPicks);
      const vsMarket        = avgPickAtRank - pick.pickNo;

      return {
        ...pick, pos, positionalRank, pickValue,
        vsMarket:     fp(vsMarket),
        avgPickAtRank: fp(avgPickAtRank),
        valueLabel: vsMarket > 15 ? 'steal'
                  : vsMarket > 5  ? 'value'
                  : vsMarket < -15 ? 'reach'
                  : vsMarket < -5  ? 'slight reach'
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
    if (pick.valueLabel === 'steal')        byRoster[r].steals.push(pick);
    if (pick.valueLabel.includes('reach'))  byRoster[r].reaches.push(pick);
  });

  Object.values(byRoster).forEach((team) => {
    const sorted        = [...team.picks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0));
    team.bestValuePick  = sorted[0] || null;
    team.worstValuePick = sorted[sorted.length - 1] || null;
    const avgVsMarket   = team.picks.length > 0 ? team.vsMarketSum / team.picks.length : 0;
    team.avgVsMarket    = fp(avgVsMarket);
    team.grade = avgVsMarket > 8  ? 'A'
               : avgVsMarket > 3  ? 'B'
               : avgVsMarket > -3 ? 'C'
               : avgVsMarket > -8 ? 'D'
               : 'F';
  });

  return {
    year: draft.year, draftType: draft.draftType, totalPicks,
    positionalADP, gradedPicks, byRoster,
    teamRankings: Object.values(byRoster).sort((a, b) => b.vsMarketSum - a.vsMarketSum),
    leagueTopSteals:  [...gradedPicks].sort((a, b) => (b.vsMarket || 0) - (a.vsMarket || 0)).slice(0, 5),
    leagueTopReaches: [...gradedPicks].sort((a, b) => (a.vsMarket || 0) - (b.vsMarket || 0)).slice(0, 5)
  };
}

// ── End-of-season grade ────────────────────────────────────────────────────

/**
 * Grades a draft against actual season performance using optimal simulation PAR.
 *
 * For each picked player:
 *   expectedPts = what the optimal simulation produced at that pick slot
 *   actualPts   = their real season total from the Sleeper stats API
 *   PAR         = actualPts − expectedPts
 *
 * Injury flags are added as context but don't change the PAR calculation.
 *
 * @param {Object} draft            - from getAllDrafts()
 * @param {Object} seasonStatTotals - { [playerId]: totalPts }
 * @param {Object} gamesPlayed      - { [playerId]: weeksWithStats }
 * @param {Object} allPlayersData   - full player info map
 */
export function gradeDraftEndOfSeason(draft, seasonStatTotals, gamesPlayed, allPlayersData) {
  if (!draft?.picks?.length || !seasonStatTotals) return null;

  const { picks, numTeams, rounds, leagueSettings } = draft;
  const totalPicks = numTeams * rounds;

  // Build the optimal draft expected-points curve
  const { expectedCurve, debug: simDebug } = simulateOptimalDraft(
    seasonStatTotals,
    allPlayersData,
    numTeams,
    rounds,
    leagueSettings
  );

  // Grade each pick
  const gradedPicks = picks.map((pick) => {
    const pos         = normalizePos(pick.position, pick.playerId);
    const actualPts   = seasonStatTotals[pick.playerId] ?? null;
    const expectedPts = expectedCurve[pick.pickNo] ?? 0;
    const par         = actualPts != null ? actualPts - expectedPts : null;
    const pickValue   = pickValueScore(pick.pickNo, totalPicks);

    // Injury detection
    const games          = gamesPlayed?.[pick.playerId] ?? null;
    const isMajorInjury  = games != null && games < INJURY_GAMES_MAJOR_THRESHOLD;
    const isInjury       = games != null && games < INJURY_GAMES_THRESHOLD;
    const injuryFlag     = isMajorInjury ? 'major-injury'
                         : isInjury      ? 'injury'
                         : null;

    // Value label based on PAR
    let valueLabel;
    if (actualPts == null) {
      valueLabel = 'no data';
    } else if (par > 80) {
      valueLabel = 'elite steal';
    } else if (par > 35) {
      valueLabel = 'steal';
    } else if (par > 10) {
      valueLabel = 'value';
    } else if (par > -10) {
      valueLabel = 'as expected';
    } else if (par > -35) {
      valueLabel = 'slight bust';
    } else if (par > -80) {
      valueLabel = 'bust';
    } else {
      valueLabel = 'major bust';
    }

    return {
      ...pick,
      pos,
      actualPts:    fp(actualPts),
      expectedPts:  fp(expectedPts),
      par:          fp(par),
      pickValue,
      valueLabel,
      injuryFlag,
      gamesPlayed:  games
    };
  });

  // Group by roster
  const byRoster = {};
  gradedPicks.forEach((pick) => {
    const r = pick.rosterId;
    if (!byRoster[r]) {
      byRoster[r] = {
        rosterId: r, managerId: pick.managerId,
        picks: [],
        totalActualPts:   0,
        totalExpectedPts: 0,
        totalPAR:         0,
        steals:  [],
        busts:   [],
        injured: []
      };
    }

    byRoster[r].picks.push(pick);
    if (pick.actualPts   != null) byRoster[r].totalActualPts   += pick.actualPts;
    if (pick.expectedPts != null) byRoster[r].totalExpectedPts += pick.expectedPts;
    if (pick.par         != null) byRoster[r].totalPAR         += pick.par;

    if (pick.valueLabel === 'steal' || pick.valueLabel === 'elite steal') {
      byRoster[r].steals.push(pick);
    }
    if (pick.valueLabel === 'bust' || pick.valueLabel === 'major bust') {
      byRoster[r].busts.push(pick);
    }
    if (pick.injuryFlag) {
      byRoster[r].injured.push(pick);
    }
  });

  Object.values(byRoster).forEach((team) => {
    const sorted = [...team.picks]
      .filter((p) => p.par != null)
      .sort((a, b) => (b.par || 0) - (a.par || 0));

    team.bestPick  = sorted[0]                       || null;
    team.worstPick = sorted[sorted.length - 1]        || null;

    // Positional breakdown
    const positional = {};
    team.picks.forEach((pick) => {
      const pos = pick.pos;
      if (!positional[pos]) positional[pos] = { picks: 0, totalPts: 0, totalPAR: 0 };
      positional[pos].picks    += 1;
      positional[pos].totalPts += pick.actualPts  || 0;
      positional[pos].totalPAR += pick.par        || 0;
    });
    team.positionalBreakdown = positional;

    // Round-by-round PAR breakdown
    const byRound = {};
    team.picks.forEach((pick) => {
      if (!byRound[pick.round]) byRound[pick.round] = { picks: 0, totalPAR: 0 };
      byRound[pick.round].picks  += 1;
      byRound[pick.round].totalPAR += pick.par || 0;
    });
    team.byRound = byRound;

    // Injury-adjusted PAR (what PAR would be without injured players)
    const injuredPAR = team.injured.reduce((s, p) => s + (p.par || 0), 0);
    team.injuryAdjustedPAR = fp(team.totalPAR - injuredPAR);

    // Overall grade
    const par = team.totalPAR;
    team.grade = par > 250 ? 'A+'
               : par > 125 ? 'A'
               : par > 50  ? 'B'
               : par > -50 ? 'C'
               : par > -125 ? 'D'
               : 'F';

    team.totalActualPts   = fp(team.totalActualPts);
    team.totalExpectedPts = fp(team.totalExpectedPts);
    team.totalPAR         = fp(team.totalPAR);
  });

  const teamRankings = Object.values(byRoster).sort((a, b) => (b.totalPAR || 0) - (a.totalPAR || 0));

  return {
    year: draft.year, draftType: draft.draftType, totalPicks,
    expectedCurve, gradedPicks, byRoster, teamRankings,
    simulationDebug: simDebug,
    leagueTopSteals: [...gradedPicks]
      .filter((p) => p.par != null)
      .sort((a, b) => (b.par || 0) - (a.par || 0))
      .slice(0, 10),
    leagueTopBusts: [...gradedPicks]
      .filter((p) => p.par != null)
      .sort((a, b) => (a.par || 0) - (b.par || 0))
      .slice(0, 10)
  };
}
