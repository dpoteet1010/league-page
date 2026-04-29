import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { legacyLeagueData } from './helperFunctions/legacyLeagueData.js';

/**
 * Server-side version of getLeagueData.
 * Mirrored logic from the frontend: Checks legacy data first, then fetches.
 */
export const getLeagueData = async (queryLeagueID = defaultLeagueID) => {
    
    // 1. Check if the requested ID exists in our legacy object (Logic from your currentCache check)
    if (legacyLeagueData[queryLeagueID]) {
        return legacyLeagueData[queryLeagueID];
    }

    // 2. Fetch from Sleeper API if not in legacy data
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}`, {
            compress: true
        });

        if (!res.ok) {
            // Instead of throwing an error that crashes the AI, we return a safe fallback
            console.error(`Sleeper API Error: ${res.status} for league ${queryLeagueID}`);
            return createEmptyLeague(queryLeagueID);
        }

        const data = await res.json();

        // 3. Optional: Add safety defaults like your frontend might expect
        return {
            ...data,
            settings: data.settings || { playoff_week_start: 15, divisions: 0 },
            status: data.status || 'complete',
            season: data.season || queryLeagueID // Fallback to the ID if season is missing
        };

    } catch (err) {
        console.error("Fetch error:", err);
        return createEmptyLeague(queryLeagueID);
    }
};

/**
 * Minimal fallback object to prevent the AI from seeing "null"
 */
const createEmptyLeague = (id) => {
    return {
        league_id: id,
        name: "Unknown League",
        status: "closed",
        settings: { playoff_week_start: 15, divisions: 0 },
        season: id
    };
};
