/**
 * getLeagueState.js
 *
 * Turns one season's normalized matchup data into:
 *   1. weeklyResults — a flat, per-roster-per-week stats engine (the source of truth)
 *   2. standings     — regular season + playoff aggregates per roster, rolled up from weeklyResults
 *   3. podiums       — championId / lastPlaceId for the season
 *
 * Expected input shapes:
 *   seasonMatchupsData = { matchupWeeks: [{ week, matchups: { [matchupId]: [teamA, teamB] } }], regularSeasonLength }
 *     where each team = { roster_id, starters, points }
 *   managersForYear = { [rosterId]: { name, avatar, managerNames } }   // flat, NOT nested by year
 *   leagueData = Sleeper league object (used as a fallback for regularSeasonLength)
 *   bracketData = whatever getBrackets() returns (shape unknown/unverified — see determinePlayoffPodiums)
 */

export function getLeagueState(seasonMatchupsData, managersForYear, leagueData, bracketData) {
  const debug = [];

  if (!seasonMatchupsData?.matchupWeeks?.length) {
    debug.push('getLeagueState: no matchupWeeks supplied — returning empty result.');
    return { standings: [], weeklyResults: [], podiums: { championId: null, lastPlaceId: null }, debug };
  }

  const regularSeasonLength = Number(
    seasonMatchupsData.regularSeasonLength ?? (leagueData?.settings?.playoff_week_start - 1) ?? 14
  );
  debug.push(`Using regularSeasonLength = ${regularSeasonLength}`);

  // ---- 1. Discover every roster that actually appears in the matchup data ----
  // (Don't rely solely on managersForYear — if it's missing a roster, we still want its stats.)
  const rosterIds = new Set(Object.keys(managersForYear || {}).map(Number));
  seasonMatchupsData.matchupWeeks.forEach(({ matchups }) => {
    Object.values(matchups || {}).forEach((pair) => {
      (pair || []).forEach((team) => {
        if (team?.roster_id != null) rosterIds.add(Number(team.roster_id));
      });
    });
  });

  // ---- 2. Initialize standings shell ----
  const standings = {};
  rosterIds.forEach((rosterId) => {
    const meta = managersForYear?.[rosterId] || {};
    standings[rosterId] = {
      rosterId,
      name: meta.name || `Team ${rosterId}`,
      avatar: meta.avatar || '',
      managerNames: meta.managerNames || '',
      regularSeason: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0, streak: { type: null, count: 0 } },
      playoffs: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0 },
    };
  });

  if (!managersForYear || Object.keys(managersForYear).length === 0) {
    debug.push('Warning: managersForYear was empty — team names will fall back to "Team {rosterId}".');
  }

  // ---- 3. Build the weekly engine ----
  const weeklyResults = [];

  seasonMatchupsData.matchupWeeks.forEach(({ week, matchups }) => {
    const weekNum = Number(week);
    if (!matchups || Number.isNaN(weekNum)) return;
    const isPlayoffWeek = weekNum > regularSeasonLength;

    Object.values(matchups).forEach((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) return; // skip byes / incomplete pairs

      const [teamA, teamB] = pair;
      const rA = Number(teamA.roster_id);
      const rB = Number(teamB.roster_id);
      if (!standings[rA] || !standings[rB]) return;

      const pointsA = Number(teamA.points || 0);
      const pointsB = Number(teamB.points || 0);

      let resultA, resultB;
      if (pointsA > pointsB) { resultA = 'W'; resultB = 'L'; }
      else if (pointsB > pointsA) { resultA = 'L'; resultB = 'W'; }
      else { resultA = 'T'; resultB = 'T'; }

      weeklyResults.push({ week: weekNum, rosterId: rA, opponentRosterId: rB, pointsFor: pointsA, pointsAgainst: pointsB, result: resultA, isPlayoffs: isPlayoffWeek });
      weeklyResults.push({ week: weekNum, rosterId: rB, opponentRosterId: rA, pointsFor: pointsB, pointsAgainst: pointsA, result: resultB, isPlayoffs: isPlayoffWeek });

      const bucketA = isPlayoffWeek ? standings[rA].playoffs : standings[rA].regularSeason;
      const bucketB = isPlayoffWeek ? standings[rB].playoffs : standings[rB].regularSeason;

      bucketA.fptsFor += pointsA;
      bucketA.fptsAgainst += pointsB;
      bucketB.fptsFor += pointsB;
      bucketB.fptsAgainst += pointsA;

      if (resultA === 'W') { bucketA.wins += 1; bucketB.losses += 1; }
      else if (resultA === 'L') { bucketA.losses += 1; bucketB.wins += 1; }
      else { bucketA.ties += 1; bucketB.ties += 1; }
    });
  });

  debug.push(`Built ${weeklyResults.length} weekly result rows across ${seasonMatchupsData.matchupWeeks.length} weeks.`);

  // ---- 4. Current win/loss streak (regular season only, walking backward) ----
  rosterIds.forEach((rosterId) => {
    const rosterWeeks = weeklyResults
      .filter((r) => r.rosterId === rosterId && !r.isPlayoffs)
      .sort((a, b) => a.week - b.week);

    let type = null;
    let count = 0;
    for (let i = rosterWeeks.length - 1; i >= 0; i--) {
      const { result } = rosterWeeks[i];
      if (result === 'T') break; // a tie breaks the streak
      if (type === null) { type = result; count = 1; }
      else if (result === type) count += 1;
      else break;
    }
    standings[rosterId].regularSeason.streak = { type, count };
  });

  // ---- 5. Podiums ----
  const { podiums, debug: podiumDebug } = determinePlayoffPodiums(bracketData);
  debug.push(...podiumDebug);

  return {
    standings: Object.values(standings).sort(
      (a, b) => b.regularSeason.wins - a.regularSeason.wins || b.regularSeason.fptsFor - a.regularSeason.fptsFor
    ),
    weeklyResults,
    podiums,
    debug,
  };
}

/**
 * Defensive parser for whatever shape getBrackets() returns.
 * Tries several known key patterns in order and logs which one (if any)
 * matched, so a null result tells you exactly what to inspect next
 * instead of failing silently.
 */
export function determinePlayoffPodiums(bracketData) {
  const debug = [];
  const result = { championId: null, lastPlaceId: null };

  if (!bracketData) {
    debug.push('determinePlayoffPodiums: no bracketData provided.');
    return { podiums: result, debug };
  }

  // --- Champion ---
  if (bracketData.champion != null) {
    result.championId = bracketData.champion;
    debug.push('championId resolved via bracketData.champion');
  } else if (bracketData.champBracket?.champion != null) {
    result.championId = bracketData.champBracket.champion;
    debug.push('championId resolved via bracketData.champBracket.champion');
  } else if (bracketData.champs?.bracket?.length) {
    const championResult = resolveFromBracketRounds(bracketData.champs.bracket, 'highest');
    if (championResult != null) {
      result.championId = championResult;
      debug.push('championId resolved via bracketData.champs.bracket (final round point comparison)');
    }
  } else if (bracketData.bracket?.length) {
    const championResult = resolveFromBracketRounds(bracketData.bracket, 'highest');
    if (championResult != null) {
      result.championId = championResult;
      debug.push('championId resolved via bracketData.bracket (final round point comparison)');
    }
  } else {
    debug.push('Could not find a championId — none of the known bracketData shapes matched. Dump bracketData to inspect.');
  }

  // --- Last place / toilet bowl ---
  if (bracketData.loser != null) {
    result.lastPlaceId = bracketData.loser;
    debug.push('lastPlaceId resolved via bracketData.loser');
  } else if (bracketData.toiletBowlLoser != null) {
    result.lastPlaceId = bracketData.toiletBowlLoser;
    debug.push('lastPlaceId resolved via bracketData.toiletBowlLoser');
  } else if (bracketData.loserBracket?.lastPlace != null) {
    result.lastPlaceId = bracketData.loserBracket.lastPlace;
    debug.push('lastPlaceId resolved via bracketData.loserBracket.lastPlace');
  } else if (bracketData.losers?.bracket?.length) {
    const loserResult = resolveFromBracketRounds(bracketData.losers.bracket, 'lowest');
    if (loserResult != null) {
      result.lastPlaceId = loserResult;
      debug.push('lastPlaceId resolved via bracketData.losers.bracket (final round point comparison)');
    }
  } else {
    debug.push('Could not find a lastPlaceId — none of the known bracketData shapes matched. Dump bracketData to inspect.');
  }

  return { podiums: result, debug };
}

// Walks the final round of a round-by-round bracket array and returns the
// roster_id with the higher ('highest') or lower ('lowest') accumulated points.
function resolveFromBracketRounds(rounds, mode) {
  const finalRound = rounds[rounds.length - 1];
  const finalMatch = finalRound?.[0];
  if (!finalMatch?.[0] || !finalMatch?.[1]) return null;

  const ptsA = sumBracketPoints(finalMatch[0]);
  const ptsB = sumBracketPoints(finalMatch[1]);

  if (mode === 'highest') return ptsA > ptsB ? finalMatch[0].roster_id : finalMatch[1].roster_id;
  return ptsA < ptsB ? finalMatch[0].roster_id : finalMatch[1].roster_id;
}

function sumBracketPoints(side) {
  return Object.values(side.points || {}).reduce(
    (sum, wk) => sum + Object.values(wk || {}).reduce((a, b) => a + Number(b || 0), 0),
    0
  );
}
