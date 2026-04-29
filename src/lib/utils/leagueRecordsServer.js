import { getLeagueData } from './leagueDataServer.js';
import { getNflState } from './nflStateServer.js';
import { getLeagueRosters } from "./leagueRostersServer.js";
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { round } from '$lib/utils/helperFunctions/universalFunctions.js';
import { legacyMatchups } from './helperFunctions/legacyMatchups.js';

/**
 * Server-side version of getLeagueRecords.
 * Compiles all-time records by walking the Sleeper chain AND hitting legacy IDs.
 */
export const getLeagueRecords = async () => {
    const nflState = await getNflState().catch(() => null);
    if (!nflState) return null;

    const week = nflState.week > 0 ? nflState.week : 1;
    
    // 1. Walk through the league history chain + manual legacy IDs
    const { leagueDataArray, currentSeason } = await combThroughLeagues(defaultLeagueID);

    let records = {
        allTimeHighScores: [],
        allTimeLowScores: [],
        seasons: []
    };

    // 2. Process each season found in the chain
    for (const leagueData of leagueDataArray) {
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

/**
 * Follows previous_league_id links and then adds hardcoded legacy years.
 */
const combThroughLeagues = async (currentLeagueID) => {
    const leagueDataArray = [];
    let currentSeason = null;
    let loopID = currentLeagueID;

    // Follow the Sleeper chain (2026 -> 2025)
    while (loopID && loopID !== "0") {
        const leagueData = await getLeagueData(loopID).catch(() => null);
        if (!leagueData) break;
        
        // Prevent duplicates if a legacy ID is already in the chain
        if (leagueDataArray.some(l => l.league_id === loopID)) break;

        leagueDataArray.push(leagueData);
        if (!currentSeason) currentSeason = leagueData.season;
        loopID = leagueData.previous_league_id;
    }

    // MANUALLY INJECT 2024 and 2023 if they weren't found in the chain
    const processedYears = leagueDataArray.map(l => l.season);
    
    const legacyConfigs = [
        { year: "2024", id: "1048473852877918208" }, 
        { year: "2023", id: "917244510005710848" }
    ];

    for (const legacy of legacyConfigs) {
        if (!processedYears.includes(legacy.year)) {
            const legacyData = await getLeagueData(legacy.id).catch(() => null);
            if (legacyData && legacyData.league_id) {
                leagueDataArray.push(legacyData);
            }
        }
    }

    return { leagueDataArray, currentSeason };
};

/**
 * Processes a single season's regular season data with safety checks
 */
const processRegularSeason = async ({ rosters, leagueData, curSeason, week }) => {
    if (!leagueData?.settings) return null;

    const year = leagueData.season;
    const playoffStart = leagueData.settings?.playoff_week_start || 15;
    let regularSeasonLength = playoffStart - 1;

    // If it's the current year, truncate to current week
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
        const rSettings = roster.settings || {};
        
        seasonData.rosterRecords[rosterID] = {
            wins: rSettings.wins || 0,
            losses: rSettings.losses || 0,
            ties: rSettings.ties || 0,
            fpts: round((rSettings.fpts || 0) + ((rSettings.fpts_decimal || 0) / 100)),
            fptsAgainst: round((rSettings.fpts_against || 0) + ((rSettings.fpts_against_decimal || 0) / 100)),
        };
    }

    // Merge in local legacy matchups if they exist in helperFunctions
    if (legacyMatchups[year]) {
        seasonData.matchups = legacyMatchups[year];
    }

    return seasonData;
};
