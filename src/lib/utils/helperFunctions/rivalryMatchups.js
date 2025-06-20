import { getLeagueData } from "./leagueData";
import { leagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "./nflState";
import { waitForAll } from './multiPromise';
import { getRosterIDFromManagerIDAndYear } from '$lib/utils/helperFunctions/universalFunctions';
import { getLeagueTeamManagers } from "./leagueTeamManagers";
import { legacyMatchups } from './legacyMatchups.js';

export const getRivalryMatchups = async (userOneID, userTwoID) => {
	if (!userOneID || !userTwoID) {
		return;
	}

	let curLeagueID = leagueID;

	const [nflState, teamManagers] = await waitForAll(
		getNflState(),
		getLeagueTeamManagers(),
	).catch((err) => { console.error(err); });

	let week = 1;
	if (nflState.season_type === 'regular') {
		week = nflState.display_week;
	} else if (nflState.season_type === 'post') {
		week = 18;
	}

	const rivalry = {
		points: {
			one: 0,
			two: 0,
		},
		wins: {
			one: 0,
			two: 0,
		},
		ties: 0,
		matchups: []
	};

	while (curLeagueID && curLeagueID != 0) {
		const leagueData = await getLeagueData(curLeagueID).catch((err) => { console.error(err); });
		const year = leagueData.season;
		const rosterIDOne = getRosterIDFromManagerIDAndYear(teamManagers, userOneID, year);
		const rosterIDTwo = getRosterIDFromManagerIDAndYear(teamManagers, userTwoID, year);
		if (!rosterIDOne || !rosterIDTwo || rosterIDOne == rosterIDTwo) {
			curLeagueID = leagueData.previous_league_id;
			week = 18;
			continue;
		}

		let matchupsData = [];

		// Use legacy data if available
		if (year === '2023' || year === '2024') {
			const legacyYearMatchups = legacyMatchups[year];
			for (let wk = 1; wk <= 17; wk++) {
				const matchupWeek = legacyYearMatchups?.[wk];
				if (Array.isArray(matchupWeek)) {
					matchupsData.push(matchupWeek);
				}
			}
		} else {
			const matchupsPromises = [];
			for (let i = 1; i < leagueData.settings.playoff_week_start; i++) {
				matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${curLeagueID}/matchups/${i}`, { compress: true }));
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
			matchupsData = await waitForAll(...matchupsJsonPromises).catch((err) => { console.error(err); });
		}

		// Process matchups
		for (let i = 1; i < matchupsData.length + 1; i++) {
			const processed = processRivalryMatchups(matchupsData[i - 1], i, rosterIDOne, rosterIDTwo);
			if (processed) {
				const { matchup, week } = processed;
				const sideA = matchup[0];
				const sideB = matchup[1];
				let sideAPoints = sideA.points.reduce((t, nV) => t + nV, 0);
				let sideBPoints = sideB.points.reduce((t, nV) => t + nV, 0);
				rivalry.points.one += sideAPoints;
				rivalry.points.two += sideBPoints;
				if (sideAPoints > sideBPoints) {
					rivalry.wins.one++;
				} else if (sideAPoints < sideBPoints) {
					rivalry.wins.two++;
				} else {
					rivalry.ties++;
				}
				rivalry.matchups.push({
					week,
					year,
					matchup,
				});
			}
		}

		curLeagueID = leagueData.previous_league_id;
		week = 18;
	}

	rivalry.matchups.sort((a, b) => {
		const yearOrder = b.year - a.year;
		const weekOrder = b.week - a.week;
		return yearOrder || weekOrder;
	});

	return rivalry;
};

const processRivalryMatchups = (inputMatchups, week, rosterIDOne, rosterIDTwo) => {
	if (!inputMatchups || inputMatchups.length === 0) {
		return false;
	}
	const matchups = {};
	for (const match of inputMatchups) {
		if (match.roster_id === rosterIDOne || match.roster_id === rosterIDTwo) {
			if (!matchups[match.matchup_id]) {
				matchups[match.matchup_id] = [];
			}
			matchups[match.matchup_id].push({
				roster_id: match.roster_id,
				starters: match.starters,
				points: match.starters_points,
			});
		}
	}
	const keys = Object.keys(matchups);
	const matchup = matchups[keys[0]];
	if (keys.length > 1 || matchup.length === 1) {
		return;
	}
	if (matchup[0].roster_id === rosterIDTwo) {
		const two = matchup.shift();
		matchup.push(two);
	}
	return { matchup, week };
};
