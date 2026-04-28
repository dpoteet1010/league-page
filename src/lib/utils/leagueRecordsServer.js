import { getLeagueData } from './leagueDataServer.js';
import { getNflState } from './nflStateServer.js';
import { getLeagueRosters } from "./leagueRostersServer.js";
import { getBrackets } from './bracketsServer.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { round } from '$lib/utils/helperFunctions/universalFunctions.js';
import { legacyMatchups } from './helperFunctions/legacyMatchups.js';

/**
 * Server-side version of getLeagueRecords.
 * Compiles all-time records, high scores, and seasonal data.
 */
export const getLeagueRecords = async () => {
    const nflState = await getNflState().catch(() => null);
    if (!nflState) return null;

    const week = nflState.week > 0 ? nflState.week : 1;
    
    // 1. Walk through the league history chain
    const { leagueDataArray, currentSeason } = await combThroughLeagues(defaultLeagueID);

    // 2. Initialize records structure
    let records = {
        allTimeHighScores: [],
        allTimeLowScores: [],
        mostConsecutiveWins: { amount: 0, rosterID: null, year: null },
        mostConsecutiveLosses: { amount: 0, rosterID: null, year: null },
        leagueManagers: {}, // Keyed by rosterID-year
        seasons: []
    };

    // 3. Process each season
    for (const leagueData of leagueDataArray) {
        const rostersData = await getLeagueRosters(leagueData.league_id);
        const rosters = rostersData.rosters;

        const seasonRecords = await processRegularSeason({
            rosters,
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

/**
 * Walks the chain of previous_league_id to get all historical data
 */
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

/**
 * Processes a single season's regular season data with safety checks
 */
const processRegularSeason = async ({ rosters, leagueData, curSeason, week }) => {
    // CRITICAL SAFETY CHECK: Ensure settings exist
    if (!leagueData || !leagueData.settings) {
        return null;
    }

    const year = leagueData.season;
    // Optional chaining to prevent the "playoff_week_start" undefined crash
    const playoffStart = leagueData.settings?.playoff_week_start || 15;
    let regularSeasonLength = playoffStart - 1;

    // If it's the current year, don't look past the current week
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
        seasonData.rosterRecords[rosterID] = {
            wins: roster.settings?.wins || 0,
            losses: roster.settings?.losses || 0,
            ties: roster.settings?.ties || 0,
            fpts: round((roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100)),
            fptsAgainst: round((roster.settings?.fpts_against || 0) + ((roster.settings?.fpts_against_decimal || 0) / 100)),
        };
    }

    // Process legacy matchups if available for this year
    if (legacyMatchups[year]) {
        seasonData.matchups = legacyMatchups[year];
    }

    return seasonData;
};
