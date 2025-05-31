import { getLeagueData } from "./leagueData";
import { leagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "./nflState";
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { matchupsStore } from '$lib/stores';
import { legacyMatchups } from './legacyMatchups.js'; // ✅ Import legacy data

let legacyAppended = false; // ✅ Ensure legacy data is added only once per session

export const getLeagueMatchups = async () => {
	if (get(matchupsStore).matchupWeeks) {
		return get(matchupsStore);
	}

	const [nflState, leagueData] = await waitForAll(
		getNflState(),
		getLeagueData(),
	).catch((err) => {
		console.error(err);
	});

	let week = 1;
	if (nflState.season_type === 'regular') {
		week = nflState.display_week;
	} else if (nflState.season_type === 'post') {
		week = 18;
	}

	const year = leagueData.season;
	const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

	// Fetch current season matchups
	const matchupsPromises = [];
	for (let i = 1; i < leagueData.settings.playoff_week_start; i++) {
		matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${i}`, { compress: true }));
	}

	const matchupsRes = await waitForAll(...matchupsPromises);
	const matchupsJsonPromises = [];

	for (const matchupRes of matchupsRes) {
		const data = matchupRes.json();
		matchupsJsonPromises.push(data);
		if (!matchupRes.ok) {
			throw new Error(data);
		}
	}

	const matchupsData = await waitForAll(...matchupsJsonPromises).catch((err) => {
		console.error(err);
	});

	const matchupWeeks = [];

	// ✅ Append legacy matchups once
	if (!legacyAppended) {
		for (const legacyYear in legacyMatchups) {
			const weeks = legacyMatchups[legacyYear];
			if (weeks && typeof weeks === 'object') {
				for (const weekKey in weeks) {
					const weekNum = Number(weekKey);
					const matchupsArray = weeks[weekKey];
					const processed = processMatchups(matchupsArray, weekNum);
					if (processed) {
						matchupWeeks.push({
							matchups: processed.matchups,
							week: processed.week,
							year: Number(legacyYear)
						});
					}
				}
			}
		}
		legacyAppended = true;
	}

	// ✅ Process current season matchups
	for (let i = 1; i <= matchupsData.length; i++) {
		const processed = processMatchups(matchupsData[i - 1], i);
		if (processed) {
			matchupWeeks.push({
				matchups: processed.matchups,
				week: processed.week,
				year
			});
		}
	}

	const matchupsResponse = {
		matchupWeeks,
		year,
		week,
		regularSeasonLength
	};

	matchupsStore.update(() => matchupsResponse);
	return matchupsResponse;
};

const processMatchups = (inputMatchups, week) => {
	if (!inputMatchups || inputMatchups.length === 0) {
		return false;
	}
	const matchups = {};
	for (const match of inputMatchups) {
		if (!matchups[match.matchup_id]) {
			matchups[match.matchup_id] = [];
		}
		matchups[match.matchup_id].push({
			roster_id: match.roster_id,
			starters: match.starters,
			points: match.starters_points,
		});
	}
	return { matchups, week };
};
