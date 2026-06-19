/**
 * leagueState.js
 *
 * Turns one season's normalized matchup data (from allMatchups.js) plus,
 * optionally, that season's bracket data (from allPlayoffs.js) into:
 *   1. weeklyResults — flat per-roster-per-week stats engine
 *   2. standings     — regular season + playoff weekly aggregates per roster
 *   3. podiums       — { championId, lastPlaceId }
 *   4. placementsByRosterId — full final standings (1st...last) when bracket data is supplied
 */

import { resolvePlayoffPlacements } from './allPlayoffs.js';

export function getLeagueState(seasonMatchupsData, managersForYear, leagueData, playoffBrackets) {
  const debug = [];

  if (!seasonMatchupsData?.matchupWeeks?.length) {
    debug.push('getLeagueState: no matchupWeeks supplied — returning empty result.');
    return { standings: [], weeklyResults: [], podiums: { championId: null, lastPlaceId: null }, placementsByRosterId: {}, debug };
  }

  const regularSeasonLength = Number(
    seasonMatchupsData.regularSeasonLength ?? (leagueData?.settings?.playoff_week_start - 1) ?? 14
  );
  debug.push(`Using regularSeasonLength = ${regularSeasonLength}`);

  // ---- 1. Discover every roster that actually appears in the matchup data ----
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
      finalPlacement: null,
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
      if (!Array.isArray(pair) || pair.length !== 2) return;

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
  debug.push('Note: weekly W/L during multi-week playoff rounds reflects that single week only, not the combined-round outcome — use finalPlacement/podiums for actual bracket results.');

  // ---- 4. Current win/loss streak (regular season only, walking backward) ----
  rosterIds.forEach((rosterId) => {
    const rosterWeeks = weeklyResults
      .filter((r) => r.rosterId === rosterId && !r.isPlayoffs)
      .sort((a, b) => a.week - b.week);

    let type = null;
    let count = 0;
    for (let i = rosterWeeks.length - 1; i >= 0; i--) {
      const { result } = rosterWeeks[i];
      if (result === 'T') break;
      if (type === null) { type = result; count = 1; }
      else if (result === type) count += 1;
      else break;
    }
    standings[rosterId].regularSeason.streak = { type, count };
  });

  // ---- 5. Playoff placements (only if bracket data was supplied) ----
  let podiums = { championId: null, lastPlaceId: null };
  let placementsByRosterId = {};

  if (playoffBrackets) {
    const numRosters = playoffBrackets.numRosters ?? rosterIds.size;
    const resolved = resolvePlayoffPlacements(playoffBrackets.winnersBracket, playoffBrackets.losersBracket, numRosters);
    podiums = { championId: resolved.championId, lastPlaceId: resolved.lastPlaceId };
    placementsByRosterId = resolved.placementsByRosterId;
    debug.push(...resolved.debug);

    Object.values(standings).forEach((team) => {
      team.finalPlacement = placementsByRosterId[team.rosterId] ?? null;
    });
  } else {
    debug.push('No playoffBrackets supplied — skipping placement resolution.');
  }

  return {
    standings: Object.values(standings).sort((a, b) => {
      // Prefer resolved final placement when available, fall back to regular season record
      if (a.finalPlacement != null && b.finalPlacement != null) return a.finalPlacement - b.finalPlacement;
      if (a.finalPlacement != null) return -1;
      if (b.finalPlacement != null) return 1;
      return b.regularSeason.wins - a.regularSeason.wins || b.regularSeason.fptsFor - a.regularSeason.fptsFor;
    }),
    weeklyResults,
    podiums,
    placementsByRosterId,
    debug,
  };
}
