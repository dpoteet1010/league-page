import { getLeagueData } from "$lib/utils/helperFunctions/leagueData.js";
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "$lib/utils/helperFunctions/nflState.js";
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise.js';
import { get } from 'svelte/store';
import { engineMatchupsStore } from '$lib/stores';
import { legacyMatchups } from '$lib/utils/helperFunctions/legacyMatchups.js';

const FINAL_POSSIBLE_WEEK = 18;

export const getSpecificYearMatchups = async (queryLeagueID = mainLeagueID) => {
	const currentStore = get(engineMatchupsStore);

	if (currentStore.history && currentStore.history[queryLeagueID]) {
		engineMatchupsStore.update(s => ({ ...s, ...s.history[queryLeagueID] }));
		return currentStore.history[queryLeagueID];
	}

	const isLegacyYear = isNaN(queryLeagueID) === false && queryLeagueID.toString().length === 4;

	if (isLegacyYear) {
		const yearStr = queryLeagueID.toString();
		const yearMatchups = legacyMatchups[yearStr];

		if (!yearMatchups) {
			console.error(`No legacy matchups found for year ${yearStr}`);
			return null;
		}

		const matchupWeeks = [];
		const playerResultsList = [];
		const debug = [];

		Object.entries(yearMatchups).forEach(([weekNum, inputMatchups]) => {
			const weekNumber = parseInt(weekNum);
			const processed = processMatchups(inputMatchups, weekNumber);
			if (processed) {
				matchupWeeks.push({
					matchups: processed.matchups,
					week: processed.week
				});
				playerResultsList.push(...processed.playerResults);
				if (processed.byeRosterIds.length) {
					debug.push(`Week ${processed.week}: bye for roster(s) ${processed.byeRosterIds.join(', ')}.`);
				}
			}
		});

		const legacySeasonData = {
			matchupWeeks,
			playerResults: playerResultsList,
			leagueID: yearStr,
			year: yearStr,
			week: 14,
			regularSeasonLength: 14,
			debug
		};

		engineMatchupsStore.update(s => ({
			...legacySeasonData,
			history: { ...(s.history || {}), [queryLeagueID]: legacySeasonData }
		}));

		return legacySeasonData;
	}

	const [nflState, leagueData] = await waitForAll(
		getNflState(),
		getLeagueData(queryLeagueID),
	).catch((err) => {
		console.error("Error fetching metadata:", err);
		return [null, null];
	});

	if (!leagueData) return null;

	let week = 1;
	if (nflState.season_type === 'regular') week = nflState.display_week;
	else if (nflState.season_type === 'post') week = 18;

	const year = leagueData.season;
	const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

	const matchupsPromises = [];
	for (let i = 1; i <= FINAL_POSSIBLE_WEEK; i++) {
		matchupsPromises.push(
			fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`, { compress: true })
		);
	}

	const matchupsRes = await waitForAll(...matchupsPromises);

	const matchupsJsonPromises = matchupsRes.map((res) =>
		res && res.ok ? res.json() : Promise.resolve(null)
	);

	const matchupsData = await Promise.all(matchupsJsonPromises).catch((err) => {
		console.error("Error parsing matchups JSON:", err);
		return [];
	});

	const matchupWeeks = [];
	const playerResultsList = [];
	const debug = [];

	for (let i = 1; i <= matchupsData.length; i++) {
		const weekData = matchupsData[i - 1];
		if (!weekData) continue;
		const processed = processMatchups(weekData, i);
		if (processed) {
			matchupWeeks.push({ matchups: processed.matchups, week: processed.week });
			playerResultsList.push(...processed.playerResults);
			if (processed.byeRosterIds.length) {
				debug.push(`Week ${processed.week}: bye for roster(s) ${processed.byeRosterIds.join(', ')}.`);
			}
		}
	}

	const seasonData = {
		matchupWeeks,
		playerResults: playerResultsList,
		leagueID: queryLeagueID,
		year,
		week,
		regularSeasonLength,
		debug
	};

	engineMatchupsStore.update(s => ({
		...seasonData,
		history: { ...(s.history || {}), [queryLeagueID]: seasonData }
	}));

	return seasonData;
};

// FIXED: Extract per-player points in addition to team totals.
// players_points is a dict keyed by player_id with point values.
// starters is an array of player_ids that were in the starting lineup.
const processMatchups = (inputMatchups, week) => {
	if (!inputMatchups || inputMatchups.length === 0) return false;
	const matchups = {};
	const byeRosterIds = [];
	const playerResults = [];

	for (const match of inputMatchups) {
		if (match.matchup_id == null) {
			byeRosterIds.push(match.roster_id);
			continue;
		}

		if (!matchups[match.matchup_id]) {
			matchups[match.matchup_id] = [];
		}
		matchups[match.matchup_id].push({
			roster_id: match.roster_id,
			starters: match.starters,
			points: match.points,
		});

		// Extract per-player results
		const playersPoints = match.players_points || {};
		const starters = match.starters || [];
		for (const playerId in playersPoints) {
			const pointsTotal = Number(playersPoints[playerId] || 0);
			const isStarter = starters.includes(playerId);
			playerResults.push({
				week,
				rosterId: match.roster_id,
				playerId,
				pointsTotal,
				pointsStarted: isStarter ? pointsTotal : 0
			});
		}
	}

	return { matchups, week, byeRosterIds, playerResults };
};
