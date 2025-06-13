import { getLeagueData } from './leagueData'; 
import { leagueID } from '$lib/utils/leagueInfo';
import { getNflState } from './nflState';
import { getLeagueRosters } from "./leagueRosters";
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { records } from '$lib/stores';
import { getManagers, round, sortHighAndLow } from './universalFunctions';
import { Records } from '$lib/utils/dataClasses';
import { getBrackets } from './leagueBrackets';
import { browser } from '$app/environment';

/**
 * getLeagueRecords obtains all the record for a league since it was first created
 * @param {bool} refresh if set to false, getLeagueRecords returns the records stored in localStorage
 * @returns {Object} { allTimeBiggestBlowouts, allTimeClosestMatchups, leastSeasonLongPoints, mostSeasonLongPoints, leagueWeekLows, leagueWeekHighs, seasonWeekRecords, leagueManagerRecords, currentYear, lastYear}
 */
export const getLeagueRecords = async (refresh = false) => {
	if (get(records).leagueWeekHighs) {
		return get(records);
	}

	if (!refresh && browser) {
		let localRecords = await JSON.parse(localStorage.getItem("records"));
		if (localRecords && localRecords.playoffData) {
			localRecords.stale = true;
			return localRecords;
		}
	}

	const nflState = await getNflState().catch(() => {});
	
	let week = 0;
	if (nflState?.season_type === 'regular') {
		week = nflState.week - 1;
	} else if (nflState?.season_type === 'post') {
		week = 18;
	}

	let curSeason = leagueID;
	let currentYear;
	let lastYear;

	let regularSeason = new Records();
	let playoffRecords = new Records();

	// Step 1: Traverse connected leagues (previous_league_id chain)
	while (curSeason && curSeason !== 0) {
		try {
			const [rosterRes, leagueData] = await waitForAll(
				getLeagueRosters(curSeason),
				getLeagueData(curSeason),
			);

			const rosters = rosterRes.rosters;

			let tempWeek = week;
			if (leagueData.status === 'complete' || tempWeek > leagueData.settings.playoff_week_start - 1) {
				tempWeek = 99;
			}

			const {
				season,
				year,
			} = await processRegularSeason({
				leagueData,
				rosters,
				curSeason,
				week: tempWeek,
				regularSeason
			});

			const pS = await processPlayoffs({
				year,
				curSeason,
				week: tempWeek,
				playoffRecords,
				rosters
			});

			if (pS) {
				playoffRecords = pS;
			}

			lastYear = year;
			if (!currentYear && year) currentYear = year;

			curSeason = leagueData.previous_league_id;
		} catch {
			break;
		}
	}

	// Step 2: Handle static legacy seasons
	const staticSeasons = ['2024', '2023'];

	for (const staticID of staticSeasons) {
		try {
			const [rosterRes, leagueData] = await waitForAll(
				getLeagueRosters(staticID),
				getLeagueData(staticID),
			);

			const rosters = rosterRes.rosters;

			let tempWeek = week;
			if (leagueData.status === 'complete' || tempWeek > leagueData.settings.playoff_week_start - 1) {
				tempWeek = 99;
			}

			const {
				season,
				year,
			} = await processRegularSeason({
				leagueData,
				rosters,
				curSeason: staticID,
				week: tempWeek,
				regularSeason
			});

			const pS = await processPlayoffs({
				year,
				curSeason: staticID,
				week: tempWeek,
				playoffRecords,
				rosters
			});

			if (pS) {
				playoffRecords = pS;
			}

			lastYear = year;
			if (!currentYear && year) currentYear = year;
		} catch {}
	}

	// Finalize records
	playoffRecords.currentYear = regularSeason.currentYear;
	playoffRecords.lastYear = regularSeason.lastYear;

	regularSeason.finalizeAllTimeRecords({ currentYear, lastYear });
	playoffRecords.finalizeAllTimeRecords({ currentYear, lastYear });

	const regularSeasonData = regularSeason.returnRecords();
	const playoffData = playoffRecords.returnRecords();

	// Only logging leagueWeekHighs as requested
	console.log("🔎 leagueWeekHighs (regularSeason):", regularSeasonData.leagueWeekHighs);
	console.log("🔎 leagueWeekHighs (playoffs):", playoffData.leagueWeekHighs);

	const recordsData = { regularSeasonData, playoffData };
	
	if (browser) {
		localStorage.setItem("records", JSON.stringify(recordsData));
		records.update(() => recordsData);
	}
	
	return recordsData;

};
