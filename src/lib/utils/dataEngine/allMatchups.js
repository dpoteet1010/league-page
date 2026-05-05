import { getLeagueData } from "./leagueData";
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "./nflState";
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { engineMatchupsStore } from '$lib/stores'; 

/**
 * Fetches matchups for a specific league ID and stores them in a 
 * dedicated engine store to avoid polluting the main site matchups.
 */
export const getSpecificYearMatchups = async (queryLeagueID = mainLeagueID) => {
    const currentStore = get(engineMatchupsStore);
    
    // 1. Check if we already have this specific ID in our private history cache
    if (currentStore.history && currentStore.history[queryLeagueID]) {
        // Update the "active" view to this cached version
        engineMatchupsStore.update(s => ({
            ...s,
            ...s.history[queryLeagueID]
        }));
        return currentStore.history[queryLeagueID];
    }

    // 2. Fetch Metadata for the specific year
    const [nflState, leagueData] = await waitForAll(
        getNflState(),
        getLeagueData(queryLeagueID),
    ).catch((err) => { 
        console.error("Error fetching metadata:", err); 
        return [null, null];
    });

    if (!leagueData) return null;

    // 3. Determine how many weeks to fetch
    let week = 1;
    if (nflState.season_type === 'regular') {
        week = nflState.display_week;
    } else if (nflState.season_type === 'post') {
        week = 18;
    }
    
    const year = leagueData.season;
    const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

    // 4. Batch fetch matchup data for the season
    const matchupsPromises = [];
    for (let i = 1; i <= regularSeasonLength; i++) {
        matchupsPromises.push(
            fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`, { compress: true })
        );
    }
    
    const matchupsRes = await waitForAll(...matchupsPromises);

    // 5. Parse JSON responses
    const matchupsJsonPromises = [];
    for (const res of matchupsRes) {
        if (!res.ok) {
            console.error(`Failed to fetch week matchups: ${res.status}`);
            continue;
        }
        matchupsJsonPromises.push(res.json());
    }
    
    const matchupsData = await Promise.all(matchupsJsonPromises).catch((err) => { 
        console.error("Error parsing matchups JSON:", err); 
    });

    // 6. Process the raw Sleeper data into your engine's format
    const matchupWeeks = [];
    for (let i = 1; i <= matchupsData.length; i++) {
        const processed = processMatchups(matchupsData[i - 1], i);
        if (processed) {
            matchupWeeks.push({
                matchups: processed.matchups,
                week: processed.week
            });
        }
    }

    const seasonData = {
        matchupWeeks,
        leagueID: queryLeagueID,
        year,
        week,
        regularSeasonLength
    };

    // 7. Update the Dedicated Engine Store
    // We update the root properties for the current view AND the history for caching
    engineMatchupsStore.update(s => ({
        ...seasonData,
        history: {
            ...(s.history || {}),
            [queryLeagueID]: seasonData
        }
    }));

    return seasonData;
};

/**
 * Internal helper to group raw Sleeper players into matchup pairs
 */
const processMatchups = (inputMatchups, week) => {
    if (!inputMatchups || inputMatchups.length === 0) {
        return false;
    }
    const matchups = {};
    for (const match of inputMatchups) {
        if (!matchups[match.matchup_id]) {
            matchups[match.matchup_id] = [];
        }
        matchups[match.matchup_id].push({
            roster_id: match.roster_id,
            starters: match.starters,
            points: match.starters_points,
        });
    }
    return { matchups, week };
};
