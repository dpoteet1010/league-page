import { getLeagueData } from './leagueDataServer.js';
import { getNflState } from './nflStateServer.js';
import { getLeagueRosters } from "./leagueRostersServer.js";
import { getBrackets } from './bracketsServer.js';
import { leagueID as defaultLeagueID } from '$lib/utils/helperFunctions/leagueInfo.js';
import { getManagers, round, sortHighAndLow } from '$lib/utils/helperFunctions/universalFunctions.js';
import { Records } from '$lib/utils/dataClasses.js'; // Added .js
import { legacyMatchups } from './helperFunctions/legacyMatchups.js';

/**
 * Server-side version of getLeagueRecords.
 */
export const getLeagueRecords = async () => {
    const nflState = await getNflState();
    let week = 0;
    if (nflState.season_type === 'regular') {
        week = nflState.week - 1;
    } else if (nflState.season_type === 'post') {
        week = 18;
    }

    let curSeason = defaultLeagueID;
    let currentYear;
    let lastYear;

    let regularSeason = new Records();
    let playoffRecords = new Records();

    // 1. WALK BACK THROUGH LIVE SLEEPER SEASONS
    while (curSeason && curSeason != "0") {
        const [rosterRes, leagueData] = await Promise.all([
            getLeagueRosters(curSeason),
            getLeagueData(curSeason)
        ]);

        if (!rosterRes || !leagueData) break;

        const rosters = rosterRes.rosters;
        let processingWeek = week;

        if (leagueData.status === 'complete' || processingWeek > (leagueData.settings.playoff_week_start - 1)) {
            processingWeek = 99;
        }

        const { year } = await processRegularSeason({
            leagueData,
            rosters,
            curSeason,
            week: processingWeek,
            regularSeason
        });

        const pS = await processPlayoffs({
            year,
            curSeason,
            week: processingWeek,
            playoffRecords,
            rosters
        });

        if (pS) playoffRecords = pS;

        if (!currentYear && year) currentYear = year;
        lastYear = year;
        curSeason = leagueData.previous_league_id;
    }

    // 2. PROCESS MANUAL/LEGACY SEASONS (2023, 2024)
    const manualSeasons = [2024, 2023];
    for (const manualSeason of manualSeasons) {
        const curSeasonStr = String(manualSeason);
        const [rosterRes, leagueData] = await Promise.all([
            getLeagueRosters(curSeasonStr),
            getLeagueData(curSeasonStr)
        ]);

        if(!rosterRes || !leagueData) continue;

        const rosters = rosterRes.rosters;
        const { year } = await processRegularSeason({
            leagueData,
            rosters,
            curSeason: curSeasonStr,
            week: 99,
            regularSeason
        });

        const pS = await processPlayoffs({
            year,
            curSeason: curSeasonStr,
            week: 99,
            playoffRecords,
            rosters
        });
        if (pS) playoffRecords = pS;
    }

    // 3. FINALIZE AND RETURN
    currentYear = currentYear || 2026; 
    lastYear = 2023;

    regularSeason.finalizeAllTimeRecords({ currentYear, lastYear });
    playoffRecords.finalizeAllTimeRecords({ currentYear, lastYear });

    return { 
        regularSeasonData: regularSeason.returnRecords(), 
        playoffData: playoffRecords.returnRecords() 
    };
};

// --- INTERNAL HELPERS ---
// (Ensure these remain below the main export or are defined as const/function)

const processRegularSeason = async ({ rosters, leagueData, curSeason, week, regularSeason }) => {
    let year = Number(leagueData.season);
    let processingWeek = week;

    if (leagueData.status === 'complete' || processingWeek > (leagueData.settings.playoff_week_start - 1)) {
        processingWeek = leagueData.settings.playoff_week_start - 1;
    }

    for (const rosterID in rosters) {
        analyzeRosters({ year, roster: rosters[rosterID], regularSeason });
    }

    let seasonPointsRecord = [];
    let matchupDifferentials = [];

    if (year === 2023 || year === 2024) {
        const yearMatchups = legacyMatchups[year];
        for (let w = 1; w <= 14; w++) {
            const matchupWeek = yearMatchups?.[w];
            if (!matchupWeek) continue;

            const { sPR, mD } = processMatchups({
                matchupWeek,
                seasonPointsRecord,
                record: regularSeason,
                startWeek: w,
                matchupDifferentials,
                year,
            });
            seasonPointsRecord = sPR;
            matchupDifferentials = mD;
        }
    } else {
        const matchupsPromises = [];
        let tempWeek = processingWeek;
        while (tempWeek > 0) {
            matchupsPromises.push(
                fetch(`https://api.sleeper.app/v1/league/${curSeason}/matchups/${tempWeek}`).then(res => res.json())
            );
            tempWeek--;
        }

        const matchupsData = await Promise.all(matchupsPromises);
        let weekCounter = processingWeek;
        for (const matchupWeek of matchupsData) {
            const { sPR, mD } = processMatchups({
                matchupWeek,
                seasonPointsRecord,
                record: regularSeason,
                startWeek: weekCounter,
                matchupDifferentials,
                year
            });
            seasonPointsRecord = sPR;
            matchupDifferentials = mD;
            weekCounter--;
        }
    }

    const [biggestBlowouts, closestMatchups] = sortHighAndLow(matchupDifferentials, 'differential');
    const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(seasonPointsRecord, 'fpts');

    regularSeason.addAllTimeMatchupDifferentials(matchupDifferentials);

    if (seasonPointsHighs.length > 0) {
        regularSeason.addSeasonWeekRecord({
            year: Number(year),
            biggestBlowouts,
            closestMatchups,
            seasonPointsLows,
            seasonPointsHighs,
        });
    }

    return { season: leagueData.previous_league_id, year };
};

const analyzeRosters = ({ year, roster, regularSeason }) => {
    if (!roster?.settings) return;
    const { wins, losses, ties, fpts, fpts_decimal, fpts_against, fpts_against_decimal, ppts, ppts_decimal } = roster.settings;
    
    const safe = (val) => (typeof val === 'number' ? val : 0);
    const fptsFor = safe(fpts) + safe(fpts_decimal) / 100;
    const fptsAgainst = safe(fpts_against) + safe(fpts_against_decimal) / 100;
    const potentialPoints = safe(ppts) + safe(ppts_decimal) / 100;
    const gamesPlayed = wins + losses + ties;

    if (gamesPlayed === 0) return;

    const fptsPerGame = round(fptsFor / gamesPlayed);
    const managers = getManagers(roster);

    regularSeason.updateManagerRecord(managers, {
        wins, losses, ties, fptsFor, fptsAgainst, fptsPerGame, potentialPoints, rosterID: roster.roster_id, year
    });
    regularSeason.addSeasonLongPoints({ rosterID: roster.roster_id, fpts: fptsFor, fptsPerGame, year });
};

const processMatchups = ({ matchupWeek, seasonPointsRecord, record, startWeek, matchupDifferentials, year }) => {
    let matchups = {};
    for (const matchup of matchupWeek) {
        const rosterID = matchup?.roster_id;
        if (!rosterID || typeof matchup.points !== 'number') continue;

        let mID = matchup?.matchup_id || `PS:${matchup?.m}`;
        const entry = { rosterID, fpts: matchup.points, week: startWeek, year };

        if (!matchups[mID]) matchups[mID] = [];
        matchups[mID].push(entry);
        record.addLeagueWeekRecord(entry);
        seasonPointsRecord.push(entry);
    }

    for (const matchupKey in matchups) {
        const matchup = matchups[matchupKey];
        if (!Array.isArray(matchup) || matchup.length < 2) continue;

        let [home, away] = matchup[0].fpts < matchup[1].fpts ? [matchup[1], matchup[0]] : [matchup[0], matchup[1]];
        const diff = home.fpts - away.fpts;

        matchupDifferentials.push({
            year: home.year, week: home.week,
            home: { rosterID: home.rosterID, fpts: home.fpts },
            away: { rosterID: away.rosterID, fpts: away.fpts },
            differential: diff
        });
    }

    return { sPR: seasonPointsRecord, mD: matchupDifferentials };
};

const processPlayoffs = async ({curSeason, playoffRecords, year, week, rosters}) => {
    const bracketData = await getBrackets(curSeason);
    if (!bracketData || week <= bracketData.playoffsStart || !year) return null;

    const { champs, playoffsStart, playoffRounds } = bracketData;
    let context = { 
        matchupDifferentials: [], 
        postSeasonData: {}, 
        playoffRecords, 
        playoffRounds, 
        seasonPointsRecord: [], 
        playoffsStart, 
        year 
    };

    context = digestBracket({ ...context, bracket: champs.bracket, consolation: false });
    context = digestBracket({ ...context, bracket: champs.consolations, consolation: true });

    for (const rosterID in context.postSeasonData) {
        const pSD = context.postSeasonData[rosterID];
        const games = pSD.wins + pSD.losses + (pSD.ties || 0);
        const fptsPerGame = games > 0 ? round(pSD.fptsFor / games) : 0;
        
        playoffRecords.addSeasonLongPoints({ fpts: pSD.fptsFor, fptsPerGame, year, rosterID });
        playoffRecords.updateManagerRecord(getManagers(rosters[rosterID]), { ...pSD, fptsPerGame, year, rosterID });
    }

    const [biggestBlowouts, closestMatchups] = sortHighAndLow(context.matchupDifferentials, 'differential');
    const [seasonPointsHighs, seasonPointsLows] = sortHighAndLow(context.seasonPointsRecord, 'fpts');

    playoffRecords.addAllTimeMatchupDifferentials(context.matchupDifferentials);
    if (seasonPointsHighs.length > 0) {
        playoffRecords.addSeasonWeekRecord({ year, biggestBlowouts, closestMatchups, seasonPointsLows, seasonPointsHighs });
    }
    
    return playoffRecords;
};

const digestBracket = (params) => {
    let { bracket, playoffRecords, playoffRounds, matchupDifferentials, postSeasonData, consolation, seasonPointsRecord, playoffsStart, year } = params;
    
    for (let i = 0; i < bracket.length; i++) {
        const startWeek = getStartWeek(i + (playoffRounds - bracket.length), playoffRounds, consolation, playoffsStart);
        const matchupWeek = [];

        for (let matchups of bracket[i]) {
            if (consolation) matchups = matchups.flat();
            for (const matchup of matchups) {
                if (matchup.r) {
                    let points = 0;
                    for (const k in matchup.points) {
                        const arr = matchup.points[k];
                        if (Array.isArray(arr)) points += arr.reduce((t, nV) => t + nV, 0);
                    }
                    matchupWeek.push({ ...matchup, points });
                }
            }
        }

        const { sPR, mD } = processMatchups({
            matchupWeek, seasonPointsRecord, record: playoffRecords, startWeek, matchupDifferentials, year
        });

        seasonPointsRecord = sPR;
        matchupDifferentials = mD;
    }

    return { ...params, postSeasonData, seasonPointsRecord, playoffRecords, matchupDifferentials };
};

const getStartWeek = (i, playoffRounds, consolation, playoffsStart) => {
    if (consolation) return `(C) Week ${playoffsStart + i}`;
    const diff = playoffRounds - i;
    if (diff === 1) return "Finals";
    if (diff === 2) return "Semi-Finals";
    if (diff === 3) return "Quarter-Finals";
    return "Qualifiers";
};
