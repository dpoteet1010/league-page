import { leagueID } from '$lib/utils/leagueInfo.js';

/**
 * Server-side version of getLeagueData.
 * Fetches core league settings with deep safety guarding.
 */
export const getLeagueData = async (queryLeagueID = leagueID) => {
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}`);
        
        if (!res.ok) {
            console.error(`Sleeper API Error: League ${queryLeagueID} not found.`);
            return createEmptyLeague(queryLeagueID);
        }

        const data = await res.json();

        // Safety Guard: Ensure the structure is what the other utilities expect
        if (!data || typeof data !== 'object') return createEmptyLeague(queryLeagueID);

        return {
            ...data,
            settings: data.settings || { playoff_week_start: 15, divisions: 0 },
            status: data.status || 'pre_draft',
            season: data.season || '2026'
        };

    } catch (err) {
        console.error(`Fetch Error for League ${queryLeagueID}:`, err);
        return createEmptyLeague(queryLeagueID);
    }
};

/**
 * Creates a "Safe Object" so that dependent files like 
 * leagueRecordsServer don't crash on undefined properties.
 */
const createEmptyLeague = (id) => {
    return {
        league_id: id,
        name: "Unknown League",
        status: "closed",
        settings: {
            playoff_week_start: 15,
            divisions: 0
        },
        season: "0000",
        previous_league_id: null
    };
};
