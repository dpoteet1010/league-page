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
		console.log("🛑 Records already exist in store — returning cached data");
		return get(records);
	}

	if (!refresh && browser) {
		let localRecords = await JSON.parse(localStorage.getItem("records"));
		if (localRecords && localRecords.playoffData) {
			console.log("💾 Returning records from localStorage (stale: true)");
			localRecords.stale = true;
			return localRecords;
		}
	}

	console.log("🔄 Fetching NFL state...");
	const nflState = await getNflState().catch((err) => {
		console.error("❌ Error fetching NFL state:", err);
	});
	console.log("🏈 NFL state:", nflState);

	let week = 0;
	if (nflState.season_type === 'regular') {
		week = nflState.week - 1;
	} else if (nflState.season_type === 'post') {
		week = 18;
	}
	console.log(`📆 Current analysis week: ${week}`);

	let curSeason = leagueID;
	let currentYear;
	let lastYear;

	let regularSeason = new Records();
	let playoffRecords = new Records();

	// Step 1: Traverse connected leagues (previous_league_id chain)
	while (curSeason && curSeason !== 0) {
		try {
			console.log(`🔗 Traversing league chain. Processing league ID: ${curSeason}`);
			const [rosterRes, leagueData] = await waitForAll(
				getLeagueRosters(curSeason),
				getLeagueData(curSeason),
			);

			const rosters = rosterRes.rosters;
			console.log(`📦 League ${leagueData.name} (${leagueData.season}) — ${rosters.length} rosters loaded`);

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
			console.log(`✅ Finished regular season for ${year}, leagueID ${curSeason}`);

			const pS = await processPlayoffs({
				year,
				curSeason,
				week: tempWeek,
				playoffRecords,
				rosters
			});

			if (pS) {
				playoffRecords = pS;
				console.log(`🏆 Processed playoffs for ${year}`);
			}

			lastYear = year;
			if (!currentYear && year) currentYear = year;

			curSeason = leagueData.previous_league_id;
		} catch (err) {
			console.error("❌ Error processing league chain season:", err);
			break;
		}
	}

	// Step 2: Handle static legacy seasons
	const staticSeasons = ['2024', '2023'];

	for (const staticID of staticSeasons) {
		try {
			console.log(`📘 Starting legacy season ${staticID}`);
			const [rosterRes, leagueData] = await waitForAll(
				getLeagueRosters(staticID),
				getLeagueData(staticID),
			);

			const rosters = rosterRes.rosters;
			console.log(`📦 Legacy season ${staticID}: ${rosters.length} rosters from league "${leagueData.name}"`);

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
			console.log(`✅ Finished regular season for legacy ${year}, leagueID ${staticID}`);

			const pS = await processPlayoffs({
				year,
				curSeason: staticID,
				week: tempWeek,
				playoffRecords,
				rosters
			});

			if (pS) {
				playoffRecords = pS;
				console.log(`🏆 Processed playoffs for legacy ${year}`);
			}

			lastYear = year;
			if (!currentYear && year) currentYear = year;
		} catch (err) {
			console.error(`❌ Error processing static season ${staticID}:`, err);
		}
	}

	// Finalize records
	console.log("📍 Finalizing records...");
	playoffRecords.currentYear = regularSeason.currentYear;
	playoffRecords.lastYear = regularSeason.lastYear;

	regularSeason.finalizeAllTimeRecords({ currentYear, lastYear });
	playoffRecords.finalizeAllTimeRecords({ currentYear, lastYear });

	const regularSeasonData = regularSeason.returnRecords();
	const playoffData = playoffRecords.returnRecords();

	console.log("📊 Final regular season data:", regularSeasonData);
	console.log("📊 Final playoff data:", playoffData);

	const recordsData = { regularSeasonData, playoffData };

	if (browser) {
		localStorage.setItem("records", JSON.stringify(recordsData));
		console.log("💽 Records saved to localStorage");
		records.update(() => recordsData);
	}

	return recordsData;
};

/**
 * processes a regular season by calling Sleeper APIs to get the data fro a season and turn
 * it into league records (both season records and all-time records)
 * @param {Object} regularSeasonInfo an object with the function arguments needed to process a regular season
 * @param {Object[]} regularSeasonInfo.rosters the rosters of the league that year
 * @param {Object} regularSeasonInfo.leagueData the basic info for the league that season
 * @param {string} regularSeasonInfo.curSeason the league ID of the current season
 * @param {int} regularSeasonInfo.week the week to start analyzing (most recently completed week)
 * @param {Records} regularSeasonInfo.regularSeason the global regularSeason record object
 * @returns {Object} { season: (curSeason), year}
 */
import { legacyMatchups } from './legacyMatchups'; // ✅ Make sure to import this

const processRegularSeason = async ({ rosters, leagueData, curSeason, week, regularSeason }) => {
	let year = parseInt(leagueData.season);
	const isLegacy = ['2023', '2024'].includes(String(year));

	console.log(`🔍 Processing regular season for year ${year}, leagueID: ${curSeason}`);
	console.log(`📋 League status: ${leagueData.status}, playoff_week_start: ${leagueData.settings.playoff_week_start}, week param: ${week}`);
	
	if (leagueData.status === 'complete' || week > leagueData.settings.playoff_week_start - 1) {
		week = leagueData.settings.playoff_week_start - 1;
		console.log(`⏱️ Adjusted week for complete season: ${week}`);
	}

	// Analyze rosters
	console.log(`👥 Analyzing ${Object.keys(rosters).length} rosters...`);
	for (const rosterID in rosters) {
		analyzeRosters({ year, roster: rosters[rosterID], regularSeason });
	}
	console.log(`✅ Roster analysis complete for ${year}`);

	// Get matchups
	let matchupsData = [];
	let startWeek = parseInt(week);

	if (isLegacy && legacyMatchups[year]) {
		console.log(`📜 Using legacy matchups for year ${year}`);
		for (let w = startWeek; w > 0; w--) {
			if (legacyMatchups[year][w]) {
				matchupsData.push(legacyMatchups[year][w]);
			} else {
				console.warn(`⚠️ No legacy matchups for week ${w} in season ${year}`);
				matchupsData.push([]); // Maintain structure
			}
		}
	} else {
		console.log(`🌐 Fetching matchups from Sleeper API for leagueID ${curSeason}`);
		const matchupsPromises = [];
		while (week > 0) {
			matchupsPromises.push(
				fetch(`https://api.sleeper.app/v1/league/${curSeason}/matchups/${week}`, { compress: true })
			);
			week--;
		}

		const matchupsRes = await waitForAll(...matchupsPromises).catch((err) => {
			console.error(`❌ Error fetching matchups from Sleeper:`, err);
		});

		const matchupsJsonPromises = matchupsRes.map((res, i) => {
			if (!res.ok) {
				console.warn(`⚠️ Week ${startWeek - i} API response not OK`);
			}
			return res.json();
		});

		matchupsData = await waitForAll(...matchupsJsonPromises).catch((err) => {
			console.error("❌ Error parsing matchups JSON:", err);
		});
	}

	console.log(`📅 Retrieved matchups for ${matchupsData.length} weeks in season ${year}`);

	matchupsData.forEach((matchupWeek, i) => {
		if (!Array.isArray(matchupWeek)) {
			console.warn(`⚠️ Week ${i + 1} in season ${year} is not an array:`, matchupWeek);
		} else {
			console.log(`✅ Week ${i + 1} in season ${year} has ${matchupWeek.length} matchups`);
		}
	});

	let seasonPointsRecord = [];
	let matchupDifferentials = [];

	// Process matchups week by week
	for (const matchupWeek of matchupsData) {
		if (!matchupWeek || matchupWeek.length === 0) {
			console.warn(`⚠️ Skipping empty matchup week at index ${startWeek}`);
			startWeek--;
			continue;
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

	// Sort and apply to records
	const [biggestBlowouts, closestMatchups] = sortHighAndLow(matchupDifferentials, 'differential');
	const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(seasonPointsRecord, 'fpts');

	console.log(`📈 Processed ${matchupDifferentials.length} differentials for season ${year}`);
	console.log(`🔥 High scoring games:`, seasonPointsHighs.slice(0, 3));
	console.log(`🧊 Low scoring games:`, seasonPointsLows.slice(0, 3));

	regularSeason.addAllTimeMatchupDifferentials(matchupDifferentials);

	if (seasonPointsHighs.length > 0) {
		regularSeason.addSeasonWeekRecord({
			year,
			biggestBlowouts,
			closestMatchups,
			seasonPointsLows,
			seasonPointsHighs,
		});
		console.log(`✅ Season week record added for ${year}`);
	} else {
		console.warn(`⚠️ No points recorded — skipping week record for ${year}`);
		year = null;
	}

	return {
		season: curSeason,
		year,
	};
};


/**
 * Analyzes an individual roster and adds entries for that roster's
 * individual records as well as updating the league season long points.
 * @param {Object} rosterData the roster data to be analyzed
 * @param {int} rosterData.year the year being analyzed
 * @param {Object} rosterData.roster the roster being analyzed
 * @param {Records} rosterData.regularSeason the global regularSeason object that will be updated and returned
 */
const analyzeRosters = ({ year, roster, regularSeason }) => {
	const rosterID = roster.roster_id;
	const managers = getManagers(roster);

	console.log(`🔍 Analyzing roster ID: ${rosterID}, Managers: ${managers.join(', ')}`);

	// Skip if the team has no record (likely inactive or preseason)
	if (roster.settings.wins === 0 && roster.settings.ties === 0 && roster.settings.losses === 0) {
		console.warn(`⚠️ Skipping roster ${rosterID} (no games played in season ${year})`);
		return;
	}

	const fptsFor = roster.settings.fpts + (roster.settings.fpts_decimal / 100);
	const fptsAgainst = roster.settings.fpts_against + (roster.settings.fpts_against_decimal / 100);
	const potentialPoints = roster.settings.ppts + (roster.settings.ppts_decimal / 100);
	const gamesPlayed = roster.settings.wins + roster.settings.losses + roster.settings.ties;

	if (gamesPlayed === 0) {
		console.warn(`⚠️ Roster ${rosterID} has 0 games played — skipping`);
		return;
	}

	const fptsPerGame = round(fptsFor / gamesPlayed);

	const rosterRecords = {
		wins: roster.settings.wins,
		losses: roster.settings.losses,
		ties: roster.settings.ties,
		fptsFor,
		fptsAgainst,
		fptsPerGame,
		potentialPoints,
		rosterID,
		year,
	};

	console.log(`📊 Roster stats for ${rosterID} (year ${year}):`, rosterRecords);

	// Update manager records
	regularSeason.updateManagerRecord(managers, rosterRecords);
	console.log(`✅ Updated manager record for roster ${rosterID}`);

	// Add to season-long points
	regularSeason.addSeasonLongPoints({
		rosterID,
		fpts: fptsFor,
		fptsPerGame,
		year,
	});
	console.log(`📈 Added season-long points for roster ${rosterID}`);
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
const processMatchups = ({matchupWeek, seasonPointsRecord, record, startWeek, matchupDifferentials, year}) => {
	let matchups = {};

	// only used when building post season record
	let pSD = {};

	for(const matchup of matchupWeek) {
        // exit if there's no roster ID
        const rosterID = matchup.roster_id;
        if(!rosterID) continue;

        let mID = matchup.matchup_id;

        if(!mID) {
            if(!pSD[rosterID]) {
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
                }
            }
            pSD[rosterID].pOGames = 1;
            const m = matchup.m;
            if(!m) {
                pSD[rosterID].byes = 1;
                continue;
            }
            mID = `PS:${m}`
        }
        
        const entry = {
            rosterID,
            fpts: matchup.points,
            week: startWeek,
            year,
        }

        // add each entry to the matchup object
        if(!matchups[mID]) {
            matchups[mID] = [];
        }
        matchups[mID].push(entry);
        record.addLeagueWeekRecord(entry);
        seasonPointsRecord.push(entry);
	}
	startWeek--;

	// create matchup differentials from matchups obj
	for(const matchupKey in matchups) {
		const matchup = matchups[matchupKey];
		let home = matchup[0];
		let away = matchup[1];

        // if there are no teams or only one, continue
        if(!away || !home) continue;
        
		if(home.fpts < away.fpts) {
			home = matchup[1];
			away = matchup[0];
		}
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
			differential: home.fpts - away.fpts
		}
		matchupDifferentials.push(matchupDifferential);

		// handle post-season data
		if(matchupKey.split(":")[0] == "PS") {
            pSD[home.rosterID].wins = 1;
            pSD[home.rosterID].fptsFor = home.fpts;
            pSD[home.rosterID].fptsAgainst = away.fpts;
            
            pSD[away.rosterID].losses = 1;
            pSD[away.rosterID].fptsFor = away.fpts;
            pSD[away.rosterID].fptsAgainst = home.fpts;
		}
	}
	console.log(`📈 Processed ${Object.keys(matchups).length} matchups in week ${startWeek + 1}`);
	console.log(`🏆 Matchup differentials this week:`, matchupDifferentials.slice(-3)); // Show last 3 for brevity

	return {
		sPR: seasonPointsRecord,
		mD: matchupDifferentials,
		sW: startWeek,
		pSD
	}
}

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

const digestBracket = ({bracket, playoffRecords, playoffRounds, matchupDifferentials, postSeasonData, consolation, seasonPointsRecord, playoffsStart, year}) => {
	for(let i = 0; i < bracket.length; i++) {
		const startWeek = getStartWeek(i + (playoffRounds - bracket.length), playoffRounds, consolation, playoffsStart);
		const matchupWeek = [];

		for(let matchups of bracket[i]) {
			if(consolation) {
				// consolation matchups are nested within an additional array, we need to flatten them before proceeding
				matchups.flat();
			}
			for(const matchup of matchups) {
				if(matchup.r) {
					const newMatchup = {...matchup}
					let points = 0;
					for(const k in newMatchup.points) {
						points += newMatchup.points[k].reduce((t, nV) => t + nV, 0);
					}
					newMatchup.points = points;
					matchupWeek.push(newMatchup);
				}
			}
		}
		const {sPR, mD, pSD} =  processMatchups({matchupWeek, seasonPointsRecord, record: playoffRecords, startWeek, matchupDifferentials, year})

		postSeasonData = meshPostSeasonData(postSeasonData, pSD);

		seasonPointsRecord = sPR;
		matchupDifferentials = mD;
	}

	return {postSeasonData, seasonPointsRecord, playoffRecords, matchupDifferentials}
}

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
