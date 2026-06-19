import { getLeagueData } from "$lib/utils/helperFunctions/leagueData.js";
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "$lib/utils/helperFunctions/nflState.js";
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise.js';
import { get } from 'svelte/store';
import { engineMatchupsStore } from '$lib/stores';
import { legacyMatchups } from '$lib/utils/helperFunctions/legacyMatchups.js';

// Fantasy seasons never run past week 18. Fetching through this fixed
// ceiling — instead of stopping at regularSeasonLength — is what actually
// pulls in playoff week matchups/points, not just the regular season weeks.
// Weeks beyond the real season length just come back empty and are skipped.
const FINAL_POSSIBLE_WEEK = 18;

export const getSpecificYearMatchups = async (queryLeagueID = mainLeagueID) => {
	const currentStore = get(engineMatchupsStore);

	// 1. Check cache first
	if (currentStore.history && currentStore.history[queryLeagueID]) {
		engineMatchupsStore.update(s => ({ ...s, ...s.history[queryLeagueID] }));
		return currentStore.history[queryLeagueID];
	}

	// 2. Handle Legacy Seasons (2023, 2024)
	const isLegacyYear = isNaN(queryLeagueID) === false && queryLeagueID.toString().length === 4;

	if (isLegacyYear) {
		const yearStr = queryLeagueID.toString();
		const yearMatchups = legacyMatchups[yearStr];

		if (!yearMatchups) {
			console.error(`No legacy matchups found for year ${yearStr}`);
			return null;
		}

		const matchupWeeks = [];
		Object.entries(yearMatchups).forEach(([weekNum, inputMatchups]) => {
			const processed = processMatchups(inputMatchups, parseInt(weekNum));
			if (processed) {
				matchupWeeks.push({
					matchups: processed.matchups,
					week: processed.week
				});
			}
		});

		const legacySeasonData = {
			matchupWeeks,
			leagueID: yearStr,
			year: yearStr,
			week: 14,
			regularSeasonLength: 14
		};

		engineMatchupsStore.update(s => ({
			...legacySeasonData,
			history: { ...(s.history || {}), [queryLeagueID]: legacySeasonData }
		}));

		return legacySeasonData;
	}

	// 3. API Fetch Logic (2025+)
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

	// FIXED: fetch the whole season (regular season + playoffs), not just
	// weeks 1..regularSeasonLength. That boundary was the bug — playoff week
	// scores were never being requested from Sleeper at all.
	const matchupsPromises = [];
	for (let i = 1; i <= FINAL_POSSIBLE_WEEK; i++) {
		matchupsPromises.push(
			fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`, { compress: true })
		);
	}

	const matchupsRes = await waitForAll(...matchupsPromises);

	// FIXED: preserve week->index alignment even if a given week's fetch
	// fails or is empty. The old `continue`-on-failure approach silently
	// compacted the array, which would misalign every week number after
	// any gap.
	const matchupsJsonPromises = matchupsRes.map((res) =>
		res && res.ok ? res.json() : Promise.resolve(null)
	);

	const matchupsData = await Promise.all(matchupsJsonPromises).catch((err) => {
		console.error("Error parsing matchups JSON:", err);
		return [];
	});

	const matchupWeeks = [];
	for (let i = 1; i <= matchupsData.length; i++) {
		const weekData = matchupsData[i - 1];
		if (!weekData) continue;
		const processed = processMatchups(weekData, i);
		if (processed) {
			matchupWeeks.push({ matchups: processed.matchups, week: processed.week });
		}
	}

	const seasonData = {
		matchupWeeks,
		leagueID: queryLeagueID,
		year,
		week,
		regularSeasonLength
	};

	engineMatchupsStore.update(s => ({
		...seasonData,
		history: { ...(s.history || {}), [queryLeagueID]: seasonData }
	}));

	return seasonData;
};

// FIXED: Looking directly at match.points instead of match.starters_points
const processMatchups = (inputMatchups, week) => {
	if (!inputMatchups || inputMatchups.length === 0) return false;
	const matchups = {};
	for (const match of inputMatchups) {
		if (!matchups[match.matchup_id]) {
			matchups[match.matchup_id] = [];
		}
		matchups[match.matchup_id].push({
			roster_id: match.roster_id,
			starters: match.starters,
			points: match.points,
		});
	}
	return { matchups, week };
};
