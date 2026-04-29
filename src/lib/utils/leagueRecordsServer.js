import { getLeagueData } from './leagueDataServer.js';
import { getNflState } from './nflStateServer.js';
import { getLeagueRosters } from "./leagueRostersServer.js";
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { round } from '$lib/utils/helperFunctions/universalFunctions.js';

// Import your local legacy data
import { legacyLeagueData } from './helperFunctions/legacyLeagueData.js';
import { legacyLeagueRosters } from './helperFunctions/legacyLeagueRosters.js';
import { legacyMatchups } from './helperFunctions/legacyMatchups.js';

export const getLeagueRecords = async () => {
    const nflState = await getNflState().catch(() => null);
    if (!nflState) return null;

    const week = nflState.week > 0 ? nflState.week : 1;
    
    // 1. Get the Sleeper seasons (2025/2026)
    const { leagueDataArray, currentSeason } = await combThroughLeagues(defaultLeagueID);

    let records = {
        seasons: []
    };

    // 2. Process Sleeper Seasons
    for (const leagueData of leagueDataArray) {
        if (!leagueData?.settings) continue;
        const rostersData = await getLeagueRosters(leagueData.league_id).catch(() => null);
        if (!rostersData?.rosters) continue;

        const seasonRecords = await processSeasonData({
            rosters: rostersData.rosters,
            leagueData,
            curSeason: currentSeason,
            week,
        });
        if (seasonRecords) records.seasons.push(seasonRecords);
    }

    // 3. MANUALLY INJECT LOCAL LEGACY SEASONS (2024 & 2023)
    const legacyYears = ["2024", "2023"];
    for (const year of legacyYears) {
        // Only inject if the Sleeper chain didn't already find them (safety check)
        if (!records.seasons.some(s => s.year === year)) {
            const lData = legacyLeagueData[year];
            const lRosters = legacyLeagueRosters[year];

            if (lData && lRosters) {
                const legacySeasonRecords = await processSeasonData({
                    rosters: lRosters,
                    leagueData: lData,
                    curSeason: currentSeason,
                    week: 18, // Legacy seasons are always "complete"
                    isLegacy: true
                });
                if (legacySeasonRecords) records.seasons.push(legacySeasonRecords);
            }
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
        if (leagueDataArray.some(l => l.league_id === loopID)) break;
        leagueDataArray.push(leagueData);
        if (!currentSeason) currentSeason = leagueData.season;
        loopID = leagueData.previous_league_id;
    }
    return { leagueDataArray, currentSeason };
};

const processSeasonData = async ({ rosters, leagueData, curSeason, week, isLegacy = false }) => {
    if (!leagueData?.settings) return null;

    const year = leagueData.season;
    const playoffStart = leagueData.settings?.playoff_week_start || 15;
    let regularSeasonLength = playoffStart - 1;

    if (!isLegacy && year === curSeason && week <= regularSeasonLength) {
        regularSeasonLength = week - 1;
    }

    const seasonData = {
        year,
        regularSeasonLength,
        rosterRecords: {}
    };

    // Note: Local legacy rosters are often arrays or keyed differently 
    // than the Sleeper API response; this handles both.
    for (const rosterID in rosters) {
        const roster = rosters[rosterID];
        const rSettings = roster.settings || {};
        
        seasonData.rosterRecords[rosterID] = {
            wins: rSettings.wins || 0,
            losses: rSettings.losses || 0,
            fpts: round((rSettings.fpts || 0) + ((rSettings.fpts_decimal || 0) / 100)),
        };
    }

    if (legacyMatchups[year]) {
        seasonData.matchups = legacyMatchups[year];
    }

    return seasonData;
};
