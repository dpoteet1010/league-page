/**
 * getLeagueState.js
 *
 * Turns one season's normalized matchup data (from allMatchups.js's
 * getSpecificYearMatchups) into:
 *   1. weeklyResults — a flat, per-roster-per-week stats engine (the source of truth)
 *   2. standings     — regular season + playoff aggregates per roster, rolled up from weeklyResults
 *
 * Expected input shapes:
 *   seasonMatchupsData = { matchupWeeks: [{ week, matchups: { [matchupId]: [teamA, teamB] } }], regularSeasonLength }
 *     where each team = { roster_id, starters, points }
 *   managersForYear = { [rosterId]: { name, avatar, managerNames } }   // flat, NOT nested by year
 *   leagueData = Sleeper league object (used as a fallback for regularSeasonLength if seasonMatchupsData doesn't have it)
 */

export function getLeagueState(seasonMatchupsData, managersForYear, leagueData) {
  const debug = [];

  if (!seasonMatchupsData?.matchupWeeks?.length) {
    debug.push('getLeagueState: no matchupWeeks supplied — returning empty result.');
    return { standings: [], weeklyResults: [], debug };
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

  return {
    standings: Object.values(standings).sort(
      (a, b) => b.regularSeason.wins - a.regularSeason.wins || b.regularSeason.fptsFor - a.regularSeason.fptsFor
    ),
    weeklyResults,
    debug,
  };
}
