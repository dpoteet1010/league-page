// allTimeHistory.js
//
// Runs the full engine across EVERY known season and re-keys everything
// from season-local roster_id to the stable manager user_id, so results
// can be safely merged across seasons. This is the piece that was missing
// for both rivalries and all-time totals — everything upstream of this
// (allMatchups.js, allPlayoffs.js, leagueState.js) only ever looked at one
// season at a time.

import { get } from 'svelte/store';
import { teamManagersStore, leagueData as leagueDataStore } from '$lib/stores';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
import { getSpecificYearMatchups } from './allMatchups.js';
import { getLeaguePlayoffs } from './allPlayoffs.js';
import { getLeagueState } from './leagueState.js';

function resolveYear(currentLeagueID, allMetadata) {
	let year = allMetadata?.[currentLeagueID]?.season;
	if (!year && !isNaN(currentLeagueID)) {
		year = currentLeagueID.toString();
	}
	return year;
}

/**
 * Flattens teamManagersMap[year] into { rosterId: { name, avatar, managerNames, managerId } }.
 * Since every roster has exactly one manager in this league, managerId is
 * that single Sleeper user_id (kept as a string — do not Number() it).
 */
function buildManagersForYear(managersSnapshot, year) {
	const yearMap = managersSnapshot?.teamManagersMap?.[year] || {};
	const out = {};
	Object.entries(yearMap).forEach(([rosterId, teamInfo]) => {
		const managerId = teamInfo?.managers?.[0] ?? null;
		const managerName = managerId != null
			? (managersSnapshot.users?.[managerId]?.display_name || 'Unknown')
			: 'Unknown Manager';
		out[rosterId] = {
			name: teamInfo?.team?.name || `Team ${rosterId}`,
			avatar: teamInfo?.team?.avatar || '',
			managerNames: managerName,
			managerId
		};
	});
	return out;
}

/**
 * Returns every known season as { year, id } pairs, oldest first.
 */
export async function getAllSeasons() {
	const managers = await getLeagueTeamManagers();
	const allMetadata = get(leagueDataStore) || {};

	return Object.keys(managers?.teamManagersMap || {})
		.sort((a, b) => Number(a) - Number(b))
		.map((year) => {
			const matchedLeagueID = Object.keys(allMetadata).find((key) => allMetadata[key]?.season == year);
			return { year, id: matchedLeagueID || year };
		});
}

/**
 * Runs matchups + brackets + state for every season and combines them,
 * re-keyed by manager user_id instead of roster_id.
 *
 * @returns {Promise<{ seasons: Array, weeklyResults: Array, managers: Object, debug: string[] }>}
 *   weeklyResults: every weekly result from every season, each row carrying
 *     `managerId`/`opponentManagerId` in addition to the original
 *     rosterId/opponentRosterId/week/year/pointsFor/pointsAgainst/result/
 *     isPlayoffs/bracket fields — so you can filter by season, playoffs-only,
 *     bracket, etc. on top of the rivalry/all-time use cases.
 *   managers: { [managerId]: { managerId, displayName, seasons: [...] } }
 */
export async function getAllSeasonsHistory() {
	const debug = [];
	const seasons = await getAllSeasons();
	const managersSnapshot = get(teamManagersStore) || {};

	const allWeeklyResults = [];
	const seasonOutputs = [];
	const managers = {};

	for (const { year, id } of seasons) {
		await getLeagueData(id).catch((err) => {
			debug.push(`[${year}] getLeagueData note: ${err.message}`);
		});

		const allMetadata = get(leagueDataStore) || {};
		const resolvedYear = resolveYear(id, allMetadata) || year;
		const managersForYear = buildManagersForYear(managersSnapshot, resolvedYear);
		const numRosters = Object.keys(managersForYear).length;

		const matchupsData = await getSpecificYearMatchups(id).catch((err) => {
			debug.push(`[${year}] getSpecificYearMatchups failed: ${err.message}`);
			return null;
		});

		if (!matchupsData) {
			debug.push(`[${year}] No matchups data — skipping season.`);
			continue;
		}

		const playoffData = await getLeaguePlayoffs(id);
		debug.push(...playoffData.debug.map((line) => `[${year}] ${line}`));

		const result = getLeagueState(matchupsData, managersForYear, allMetadata?.[id] || null, {
			winnersBracket: playoffData.winnersBracket,
			losersBracket: playoffData.losersBracket,
			numRosters
		});
		debug.push(...result.debug.map((line) => `[${year}] ${line}`));

		const rosterToManagerId = {};
		Object.entries(managersForYear).forEach(([rosterId, info]) => {
			rosterToManagerId[rosterId] = info.managerId;
		});

		result.weeklyResults.forEach((row) => {
			const managerId = rosterToManagerId[row.rosterId];
			const opponentManagerId = rosterToManagerId[row.opponentRosterId];
			if (managerId == null || opponentManagerId == null) {
				debug.push(`[${year}] Week ${row.week}: couldn't resolve manager for roster ${row.rosterId} or ${row.opponentRosterId} — skipped from combined history.`);
				return;
			}
			allWeeklyResults.push({ ...row, year: resolvedYear, managerId, opponentManagerId });
		});

		result.standings.forEach((team) => {
			const managerId = rosterToManagerId[team.rosterId];
			if (managerId == null) return;
			if (!managers[managerId]) {
				managers[managerId] = {
					managerId,
					displayName: managersSnapshot.users?.[managerId]?.display_name || 'Unknown',
					seasons: []
				};
			}
			managers[managerId].seasons.push({
				year: resolvedYear,
				teamName: team.name,
				regularSeason: team.regularSeason,
				playoffs: team.playoffs,
				finalPlacement: team.finalPlacement,
				numRosters
			});
		});

		seasonOutputs.push({ year: resolvedYear, leagueId: id, ...result });
	}

	debug.push(`Combined ${allWeeklyResults.length} weekly result rows across ${seasonOutputs.length} seasons.`);

	return { seasons: seasonOutputs, weeklyResults: allWeeklyResults, managers, debug };
}

/**
 * Historical head-to-head record between two managers.
 *
 * @param {Array} allWeeklyResults - weeklyResults from getAllSeasonsHistory()
 * @param {string} managerIdA
 * @param {string} managerIdB
 */
export function getRivalry(allWeeklyResults, managerIdA, managerIdB) {
	const games = allWeeklyResults
		.filter((r) => r.managerId === managerIdA && r.opponentManagerId === managerIdB)
		.sort((x, y) => Number(x.year) - Number(y.year) || x.week - y.week);

	const record = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
	let biggestBlowout = null;
	let closestGame = null;

	games.forEach((g) => {
		record.pointsFor += g.pointsFor;
		record.pointsAgainst += g.pointsAgainst;
		if (g.result === 'W') record.wins += 1;
		else if (g.result === 'L') record.losses += 1;
		else record.ties += 1;

		const margin = Math.abs(g.pointsFor - g.pointsAgainst);
		if (!biggestBlowout || margin > biggestBlowout.margin) biggestBlowout = { ...g, margin };
		if (!closestGame || margin < closestGame.margin) closestGame = { ...g, margin };
	});

	let streak = { type: null, count: 0 };
	for (let i = games.length - 1; i >= 0; i--) {
		const { result } = games[i];
		if (result === 'T') break;
		if (streak.type === null) streak = { type: result, count: 1 };
		else if (result === streak.type) streak.count += 1;
		else break;
	}

	return {
		managerIdA, managerIdB,
		gamesPlayed: games.length,
		record,
		avgPointsFor: games.length ? record.pointsFor / games.length : 0,
		avgPointsAgainst: games.length ? record.pointsAgainst / games.length : 0,
		streak,
		biggestBlowout,
		closestGame,
		games
	};
}

/**
 * Career totals per manager, summed from their per-season standings.
 */
export function getAllTimeTotals(managers) {
	const totals = Object.values(managers).map((manager) => {
		const allTime = {
			managerId: manager.managerId,
			displayName: manager.displayName,
			seasonsPlayed: manager.seasons.length,
			regularSeason: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0 },
			playoffs: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0 },
			championships: 0,
			lastPlaceFinishes: 0,
			placements: []
		};

		manager.seasons.forEach((season) => {
			allTime.regularSeason.wins += season.regularSeason.wins;
			allTime.regularSeason.losses += season.regularSeason.losses;
			allTime.regularSeason.ties += season.regularSeason.ties;
			allTime.regularSeason.fptsFor += season.regularSeason.fptsFor;
			allTime.regularSeason.fptsAgainst += season.regularSeason.fptsAgainst;

			allTime.playoffs.wins += season.playoffs.wins;
			allTime.playoffs.losses += season.playoffs.losses;
			allTime.playoffs.ties += season.playoffs.ties;
			allTime.playoffs.fptsFor += season.playoffs.fptsFor;
			allTime.playoffs.fptsAgainst += season.playoffs.fptsAgainst;

			if (season.finalPlacement === 1) allTime.championships += 1;
			if (season.finalPlacement != null && season.numRosters && season.finalPlacement === season.numRosters) {
				allTime.lastPlaceFinishes += 1;
			}
			allTime.placements.push({ year: season.year, place: season.finalPlacement, outOf: season.numRosters });
		});

		return allTime;
	});

	return totals.sort((a, b) =>
		b.regularSeason.wins - a.regularSeason.wins || b.regularSeason.fptsFor - a.regularSeason.fptsFor
	);
}
