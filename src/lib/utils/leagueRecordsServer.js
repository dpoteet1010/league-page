import { getLeagueData } from './leagueDataServer.js';
import { getNflState } from './nflStateServer.js';
import { getLeagueRosters } from "./leagueRostersServer.js";
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { round } from '$lib/utils/helperFunctions/universalFunctions.js';
import { legacyMatchups } from './helperFunctions/legacyMatchups.js';

/**
 * Server-side version of getLeagueRecords.
 * Compiles all-time records with high resilience.
 */
export const getLeagueRecords = async () => {
    const nflState = await getNflState().catch(() => null);
    if (!nflState) return null;

    const week = nflState.week > 0 ? nflState.week : 1;
    const { leagueDataArray, currentSeason } = await combThroughLeagues(defaultLeagueID);

    let records = {
        allTimeHighScores: [],
        allTimeLowScores: [],
        mostConsecutiveWins: { amount: 0, rosterID: null, year: null },
        mostConsecutiveLosses: { amount: 0, rosterID: null, year: null },
        seasons: []
    };

    for (const leagueData of leagueDataArray) {
        // 1. STRICT GUARD: If leagueData or settings is missing, skip this loop entirely.
        if (!leagueData || !leagueData.settings || !leagueData.league_id) {
            continue;
        }

        const rostersData = await getLeagueRosters(leagueData.league_id).catch(() => null);
        if (!rostersData || !rostersData.rosters) continue;

        const seasonRecords = await processRegularSeason({
            rosters: rostersData.rosters,
            leagueData,
            curSeason: currentSeason,
            week,
        });

        if (seasonRecords) {
            records.seasons.push(seasonRecords);
        }
    }

    return records;
};

const combThroughLeagues = async (currentLeagueID) => {
    const leagueDataArray = [];
    let currentSeason = null;
    let loopID = currentLeagueID;

    while (loopID && loopID !== "0") {
        const leagueData = await getLeagueData(loopID).catch(() => null);
        if (!leagueData) break;
        
        leagueDataArray.push(leagueData);
        if (!currentSeason) currentSeason = leagueData.season;
        loopID = leagueData.previous_league_id;
    }

    return { leagueDataArray, currentSeason };
};

const processRegularSeason = async ({ rosters, leagueData, curSeason, week }) => {
    // 2. DOUBLE CHECK: Ensure settings exists before destructuring or accessing properties
    if (!leagueData?.settings) return null;

    const year = leagueData.season;
    const playoffStart = leagueData.settings?.playoff_week_start || 15;
    let regularSeasonLength = playoffStart - 1;

    if (year === curSeason && week <= regularSeasonLength) {
        regularSeasonLength = week - 1;
    }

    const seasonData = {
        year,
        regularSeasonLength,
        rosterRecords: {}
    };

    for (const rosterID in rosters) {
        const roster = rosters[rosterID];
        // 3. ROSTER SAFETY: Ensure settings exist for the individual roster
        const rosterSettings = roster.settings || {};
        
        seasonData.rosterRecords[rosterID] = {
            wins: rosterSettings.wins || 0,
            losses: rosterSettings.losses || 0,
            ties: rosterSettings.ties || 0,
            fpts: round((rosterSettings.fpts || 0) + ((rosterSettings.fpts_decimal || 0) / 100)),
            fptsAgainst: round((rosterSettings.fpts_against || 0) + ((rosterSettings.fpts_against_decimal || 0) / 100)),
        };
    }

    if (legacyMatchups[year]) {
        seasonData.matchups = legacyMatchups[year];
    }

    return seasonData;
};
