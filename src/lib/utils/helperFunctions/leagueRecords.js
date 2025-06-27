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
import { legacyMatchups } from './legacyMatchups.js';

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

	const nflState = await getNflState();
	let week = 0;
	if (nflState.season_type === 'regular') {
		week = nflState.week - 1;
	} else if (nflState.season_type === 'post') {
		week = 18;
	}

	let curSeason = leagueID;
	let currentYear;
	let lastYear;

	let regularSeason = new Records();
	let playoffRecords = new Records();

	while (curSeason && curSeason != 0) {
		const [rosterRes, leagueData] = await waitForAll(
			getLeagueRosters(curSeason),
			getLeagueData(curSeason)
		);

		const rosters = rosterRes.rosters;

		if (leagueData.status === 'complete' || week > leagueData.settings.playoff_week_start - 1) {
			week = 99;
		}

		const { season, year } = await processRegularSeason({
			leagueData,
			rosters,
			curSeason,
			week,
			regularSeason
		});

		const pS = await processPlayoffs({
			year,
			curSeason,
			week,
			playoffRecords,
			rosters
		});
		if (pS) {
			playoffRecords = pS;
		}

		if (!currentYear && year) {
			currentYear = year;
		}
		lastYear = year;

		curSeason = season;
	}

	const manualSeasons = [2024, 2023];

	for (const manualSeason of manualSeasons) {
		const curSeason = String(manualSeason);
		
		const [rosterRes, leagueData] = await waitForAll(
			getLeagueRosters(curSeason),
			getLeagueData(curSeason)
		);

		const rosters = rosterRes.rosters;
		const week = 99;

		const { season, year } = await processRegularSeason({
			leagueData,
			rosters,
			curSeason,
			week,
			regularSeason
		});

		const pS = await processPlayoffs({
			year,
			curSeason,
			week,
			playoffRecords,
			rosters
		});
		if (pS) {
			playoffRecords = pS;
		}
	}

	currentYear = 2024;
	lastYear = 2023;

	playoffRecords.currentYear = regularSeason.currentYear;
	playoffRecords.lastYear = regularSeason.lastYear;

	regularSeason.finalizeAllTimeRecords({ currentYear, lastYear });
	console.log("[DEBUG] leagueWeekHighs after finalize:", regularSeason.leagueWeekHighs?.length);
	playoffRecords.finalizeAllTimeRecords({ currentYear, lastYear });

	const regularSeasonData = regularSeason.returnRecords();
	const playoffData = playoffRecords.returnRecords();
	
	console.log("[DEBUG] regularSeasonData keys:", Object.keys(regularSeasonData));
	console.log("[DEBUG] leagueWeekHighs sample:", JSON.stringify(regularSeasonData.leagueWeekHighs?.slice(0, 2), null, 2)); // 👈 preview 2 entries
	
	const recordsData = { regularSeasonData, playoffData };
	
	if (browser) {
		localStorage.setItem("records", JSON.stringify(recordsData));
		records.update(() => recordsData);
	}
	
	return recordsData;
};

const processRegularSeason = async ({ rosters, leagueData, curSeason, week, regularSeason }) => {
	let year = Number(leagueData.season);

	if (leagueData.status == 'complete' || week > leagueData.settings.playoff_week_start - 1) {
		week = leagueData.settings.playoff_week_start - 1;
	}

	for (const rosterID in rosters) {
		analyzeRosters({ year, roster: rosters[rosterID], regularSeason });
	}

	let startWeek = parseInt(week);
	let seasonPointsRecord = [];
	let matchupDifferentials = [];

	if (year === 2023 || year === 2024) {
		const yearMatchups = legacyMatchups[year];
		for (let week = 1; week <= 17; week++) {
			const matchupWeek = yearMatchups[week];

			if (!matchupWeek || !Array.isArray(matchupWeek)) {
			}

			const { sPR, mD, sW } = processMatchups({
				matchupWeek,
				seasonPointsRecord,
				record: regularSeason,
				startWeek: week,
				matchupDifferentials,
				year,
			});
			seasonPointsRecord = sPR;
			matchupDifferentials = mD;
			startWeek = sW;
		}
	} else {
		const matchupsPromises = [];
		while (week > 0) {
			matchupsPromises.push(fetch(`https://api.sleeper.app/v1/league/${curSeason}/matchups/${week}`, { compress: true }));
			week--;
		}

		const matchupsRes = await waitForAll(...matchupsPromises);
		const matchupsJsonPromises = [];
		for (const matchupRes of matchupsRes) {
			const data = matchupRes.json();
			matchupsJsonPromises.push(data);
		}
		const matchupsData = await waitForAll(...matchupsJsonPromises);
		curSeason = leagueData.previous_league_id;

		for (const matchupWeek of matchupsData) {
			if (!Array.isArray(matchupWeek)) {
			}

			const { sPR, mD, sW } = processMatchups({
				matchupWeek,
				seasonPointsRecord,
				record: regularSeason,
				startWeek,
				matchupDifferentials,
				year
			});
			seasonPointsRecord = sPR;
			matchupDifferentials = mD;
			startWeek = sW;
		}
	}
	console.log(`[DEBUG] seasonPointsRecord length: ${seasonPointsRecord.length}`);

	const [biggestBlowouts, closestMatchups] = sortHighAndLow(matchupDifferentials, 'differential');
	const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(seasonPointsRecord, 'fpts');

	regularSeason.addAllTimeMatchupDifferentials(matchupDifferentials);

	console.log(`[DEBUG processRegularSeason] year: ${year}, seasonPointsRecord.length: ${seasonPointsRecord.length}`);
	console.log(`[DEBUG processRegularSeason] seasonPointsHighs.length: ${seasonPointsHighs.length}`);
	if (seasonPointsHighs.length > 0) {
		regularSeason.addSeasonWeekRecord({
			year: Number(year),
			biggestBlowouts,
			closestMatchups,
			seasonPointsLows,
			seasonPointsHighs,
		});
	} else {
		year = null;
	}
	console.log(`[DEBUG] Finished processRegularSeason for ${year}. leagueWeekHighs length:`, regularSeason.leagueWeekHighs?.length);
	return {
		season: curSeason,
		year,
	};
};

const analyzeRosters = ({ year, roster, regularSeason }) => {
	if (!roster) {
		return;
	}

	const rosterID = roster.roster_id;
	if (rosterID == null) {
		return;
	}

	if (!roster.settings) {
		return;
	}

	const { wins, losses, ties, fpts, fpts_decimal, fpts_against, fpts_against_decimal, ppts, ppts_decimal } = roster.settings;

	// Skip rosters with no recorded activity
	if (wins == 0 && ties == 0 && losses == 0) {
		return;
	}

	// Handle undefined numeric values gracefully
	const safe = (val) => (typeof val === 'number' ? val : 0);

	const fptsFor = safe(fpts) + safe(fpts_decimal) / 100;
	const fptsAgainst = safe(fpts_against) + safe(fpts_against_decimal) / 100;
	const potentialPoints = safe(ppts) + safe(ppts_decimal) / 100;
	const gamesPlayed = wins + losses + ties;

	if (gamesPlayed === 0) {
		return;
	}

	const fptsPerGame = round(fptsFor / gamesPlayed);

	const managers = getManagers(roster);

	const rosterRecords = {
		wins,
		losses,
		ties,
		fptsFor,
		fptsAgainst,
		fptsPerGame,
		potentialPoints,
		rosterID,
		year,
	};

	try {
		regularSeason.updateManagerRecord(managers, rosterRecords);
		regularSeason.addSeasonLongPoints({
			rosterID,
			fpts: fptsFor,
			fptsPerGame,
			year,
		});
	} catch (err) {
		console.error(`[analyzeRosters] Error updating records for roster ${rosterID} in year ${year}:`, err);
	}
};

/**
 * Processes the matchups for a given week of a season. Calculates weekly points,
 * differentials, and adds the points to the season-long points
 * @param {Object} matchupData the data needed to process a matchup
 * @param {Object[]} matchupData.matchupWeek the week being analyzed
 * @param {Object[]} matchupData.seasonPointsRecord
 * @param {Records} matchupData.record
 * @param {int} matchupData.startWeek
 * @param {Object[]} matchupData.matchupDifferentials
 * @param {int} matchupData.year
 * @returns {any}
 */
const processMatchups = ({ matchupWeek, seasonPointsRecord, record, startWeek, matchupDifferentials, year }) => {
	let matchups = {};
	let pSD = {}; // post-season data

	for (const matchup of matchupWeek) {
		const rosterID = matchup?.roster_id;
		if (!rosterID || typeof matchup.points !== 'number') continue;

		let mID = matchup?.matchup_id;

		// Handle playoff special cases
		if (!mID) {
			if (!pSD[rosterID]) {
				pSD[rosterID] = {
					wins: 0,
					losses: 0,
					ties: 0,
					fptsFor: 0,
					fptsAgainst: 0,
					potentialPoints: 0,
					fptspg: 0,
					pOGames: 0,
					byes: 0,
				};
			}
			pSD[rosterID].pOGames = 1;

			const m = matchup?.m;
			if (!m) {
				pSD[rosterID].byes = 1;
				continue;
			}

			mID = `PS:${m}`;
		}

		const entry = {
			rosterID,
			fpts: matchup.points,
			week: startWeek,
			year,
		};

		if (!matchups[mID]) {
			matchups[mID] = [];
		}

		matchups[mID].push(entry);
		record.addLeagueWeekRecord(entry);
		seasonPointsRecord.push(entry);
	}

	startWeek--;

	for (const matchupKey in matchups) {
		const matchup = matchups[matchupKey];

		if (!Array.isArray(matchup) || matchup.length < 2) continue;

		let home = matchup[0];
		let away = matchup[1];

		if (home.fpts < away.fpts) {
			home = matchup[1];
			away = matchup[0];
		}

		const diff = home.fpts - away.fpts;

		const matchupDifferential = {
			year: home.year,
			week: home.week,
			home: {
				rosterID: home.rosterID,
				fpts: home.fpts,
			},
			away: {
				rosterID: away.rosterID,
				fpts: away.fpts,
			},
			differential: diff,
		};

		matchupDifferentials.push(matchupDifferential);
		if (matchupKey.startsWith("PS")) {
			if (!pSD[home.rosterID]) pSD[home.rosterID] = { ...home };
			if (!pSD[away.rosterID]) pSD[away.rosterID] = { ...away };

			pSD[home.rosterID].wins = 1;
			pSD[home.rosterID].fptsFor = home.fpts;
			pSD[home.rosterID].fptsAgainst = away.fpts;

			pSD[away.rosterID].losses = 1;
			pSD[away.rosterID].fptsFor = away.fpts;
			pSD[away.rosterID].fptsAgainst = home.fpts;
		}
	}

	return {
		sPR: seasonPointsRecord,
		mD: matchupDifferentials,
		sW: startWeek,
		pSD
	};
};

const processPlayoffs = async ({curSeason, playoffRecords, year, week, rosters}) => {
	const {
        playoffsStart,
        playoffRounds,
        champs,
    } = await getBrackets(curSeason);

	if(week <= playoffsStart || !year) {
		return null;
	}

	let seasonPointsRecord = [];
	let matchupDifferentials = [];
	let postSeasonData = {};

	// process all the championship matches
	const champBracket = digestBracket({bracket: champs.bracket, playoffsStart, matchupDifferentials, postSeasonData, playoffRecords, playoffRounds, consolation: false, seasonPointsRecord, year});

	postSeasonData = champBracket.postSeasonData;
	seasonPointsRecord = champBracket.seasonPointsRecord;
	playoffRecords = champBracket.playoffRecords;
	matchupDifferentials = champBracket.matchupDifferentials;

	// process all the consolation matches
	const consolationBracket = digestBracket({bracket: champs.consolations, playoffsStart, matchupDifferentials, postSeasonData, playoffRecords, playoffRounds, consolation: true, seasonPointsRecord, year});

	postSeasonData = consolationBracket.postSeasonData;
	seasonPointsRecord = consolationBracket.seasonPointsRecord;
	playoffRecords = consolationBracket.playoffRecords;
	matchupDifferentials = consolationBracket.matchupDifferentials;

	for(const rosterID in postSeasonData) {
		const pSD = postSeasonData[rosterID];
		const fptsPerGame = round(pSD.fptsFor / (pSD.wins + pSD.losses + pSD.ties));
		pSD.fptsPerGame = fptsPerGame;
		pSD.year = year;
		pSD.rosterID = rosterID;

		// add season long points entry
		playoffRecords.addSeasonLongPoints({
			fpts: pSD.fptsFor,
			fptsPerGame,
			year,
			rosterID: rosterID,
		})

		// update the manager records for this roster ID
        const managers = getManagers(rosters[rosterID]);
		playoffRecords.updateManagerRecord(managers, pSD);
	}

	// sort matchup differentials
	const [biggestBlowouts, closestMatchups] = sortHighAndLow(matchupDifferentials, 'differential')

	// sort season point records
	const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(seasonPointsRecord, 'fpts')

	// add matchupDifferentials to the all time records
	playoffRecords.addAllTimeMatchupDifferentials(matchupDifferentials);


	if(seasonPointsHighs.length > 0) {
		playoffRecords.addSeasonWeekRecord({
			year,
			biggestBlowouts,
			closestMatchups,
			seasonPointsLows,
			seasonPointsHighs,
		});
	}
	
	return playoffRecords;
}

const digestBracket = ({ bracket, playoffRecords, playoffRounds, matchupDifferentials, postSeasonData, consolation, seasonPointsRecord, playoffsStart, year }) => {
	for (let i = 0; i < bracket.length; i++) {
		const startWeek = getStartWeek(i + (playoffRounds - bracket.length), playoffRounds, consolation, playoffsStart);
		const matchupWeek = [];

		for (let matchups of bracket[i]) {
			if (consolation) {
				// flatten and assign properly
				matchups = matchups.flat();
			}

			for (const matchup of matchups) {
				if (matchup.r) {
					const newMatchup = { ...matchup };
					let points = 0;

					for (const k in newMatchup.points) {
						const arr = newMatchup.points[k];
						if (Array.isArray(arr)) {
							points += arr.reduce((t, nV) => t + nV, 0);
						} else {
							console.warn(`Unexpected points structure for matchup in bracket:`, newMatchup);
						}
					}

					newMatchup.points = points;
					matchupWeek.push(newMatchup);
				}
			}
		}

		const { sPR, mD, pSD } = processMatchups({
			matchupWeek,
			seasonPointsRecord,
			record: playoffRecords,
			startWeek,
			matchupDifferentials,
			year
		});

		postSeasonData = meshPostSeasonData(postSeasonData, pSD);
		seasonPointsRecord = sPR;
		matchupDifferentials = mD;
	}

	return { postSeasonData, seasonPointsRecord, playoffRecords, matchupDifferentials };
};

const meshPostSeasonData = (postSeasonData, pSD) => {
	for(const key in pSD) {
		if(!postSeasonData[key]) {
			postSeasonData[key] = pSD[key];
			continue;
		}
		for(const k in pSD[key]) {
			if(k == 'manager') continue;
			postSeasonData[key][k] += pSD[key][k];
		}
	}

	return postSeasonData;
}

const getStartWeek = (i, playoffRounds, consolation, playoffsStart) => {
	if (consolation) {
		return `(C) Week ${playoffsStart + i}`;
	}

	switch (playoffRounds - i) {
		case 1:
			return "Finals";
		case 2:
			return "Semi-Finals"
		case 3:
			return "Quarter-Finals"
	
		default:
			return "Qualifiers";
	}
}
