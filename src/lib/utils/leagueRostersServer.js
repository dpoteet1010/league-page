import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { legacyLeagueRosters } from './helperFunctions/legacyLeagueRosters.js';

/**
 * Server-side version of getLeagueRosters.
 * Corrected: Fixed import path for leagueInfo and ensured .js extension.
 */
export const getLeagueRosters = async (queryLeagueID = defaultLeagueID) => {
    const leagueIDStr = String(queryLeagueID);

    // 1. Check for Legacy Data First (2023, 2024, etc.)
    if (legacyLeagueRosters[leagueIDStr]) {
        const legacy = legacyLeagueRosters[leagueIDStr];
        
        // Validate legacy data structure
        if (legacy.rosters && typeof legacy.rosters === 'object' && !Array.isArray(legacy.rosters)) {
            const rosterArray = Object.values(legacy.rosters);
            return processRosters(rosterArray);
        }
    }

    // 2. Fetch Live Data from Sleeper
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${leagueIDStr}/rosters`);
        
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(JSON.stringify(errorData));
        }

        const data = await res.json();
        return processRosters(data);
        
    } catch (err) {
        console.error(`Error fetching rosters for league ${leagueIDStr}:`, err);
        // Return a safe empty structure if the fetch fails
        return { rosters: {}, startersAndReserve: [] };
    }
};

/**
 * Maps the raw Sleeper array into a keyed object and extracts player IDs.
 */
const processRosters = (rosters) => {
    const startersAndReserve = [];
    const rosterMap = {};

    for (const roster of rosters) {
        // Collect starters for the master player list
        if (Array.isArray(roster.starters)) {
            for (const starter of roster.starters) {
                startersAndReserve.push(starter);
            }
        }
        
        // Collect IR/Reserve for the master player list
        if (Array.isArray(roster.reserve)) {
            for (const ir of roster.reserve) {
                startersAndReserve.push(ir);
            }
        }
        
        // Key the roster by its ID (1, 2, 3...)
        rosterMap[roster.roster_id] = roster;
    }

    return { 
        rosters: rosterMap, 
        startersAndReserve 
    };
};
