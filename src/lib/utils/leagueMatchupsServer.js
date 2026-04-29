import { getLeagueData } from "./leagueDataServer.js";
import { getNflState } from "./nflStateServer.js";
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { legacyMatchups } from './helperFunctions/legacyMatchups.js';

/**
 * Server-side version of getLeagueMatchups.
 * Handles both Sleeper API chains and local legacy years.
 */
export const getLeagueMatchups = async (queryLeagueID = defaultLeagueID) => {
    // 1. Fetch NFL state and League configuration (Hybrid-aware)
    const [nflState, leagueData] = await Promise.all([
        getNflState(),
        getLeagueData(queryLeagueID),
    ]).catch((err) => { 
        console.error("Matchups Pre-fetch Error:", err); 
        return [null, null];
    });

    if (!nflState || !leagueData) return null;

    const year = leagueData.season;
    const isLegacy = queryLeagueID === "2023" || queryLeagueID === "2024";
    const regularSeasonLength = (leagueData.settings?.playoff_week_start || 15) - 1;

    // 2. Determine current timeline for Sleeper seasons
    let week = 1;
    if (nflState.season_type == 'regular') {
        week = nflState.display_week;
    } else if (nflState.season_type == 'post') {
        week = 18;
    }

    const matchupWeeks = [];

    // 3. HYBRID LOGIC: Check for Legacy Data First
    if (isLegacy) {
        // If 2023/2024, pull from local legacyMatchups.js
        const legacyData = legacyMatchups[year] || [];
        
        // Legacy data is usually already processed or stored as weekly arrays
        for (let i = 0; i < legacyData.length; i++) {
            const processed = processMatchups(legacyData[i], i + 1);
            if (processed) {
                matchupWeeks.push(processed);
            }
        }
    } else {
        // 4. SLEEPER LOGIC: Fetch from API
        const matchupsPromises = [];
        for (let i = 1; i <= regularSeasonLength; i++) {
            matchupsPromises.push(
                fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`)
                    .then(res => res.ok ? res.json() : [])
                    .catch(() => [])
            );
        }

        const matchupsData = await Promise.all(matchupsPromises).catch((err) => { 
            console.error("Batch Matchup Fetch Error:", err);
            return [];
        });

        // Process weeks into a keyed matchup object
        for (let i = 1; i <= matchupsData.length; i++) {
            const processed = processMatchups(matchupsData[i - 1], i);
            if (processed) {
                matchupWeeks.push(processed);
            }
        }
    }

    return {
        matchupWeeks,
        year,
        week,
        regularSeasonLength
    };
}

/**
 * Internal helper to group rosters by their matchup_id
 */
const processMatchups = (inputMatchups, week) => {
    if (!inputMatchups || inputMatchups.length == 0) {
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
            total_points: match.points // Useful for AI context
        });
    }
    return { matchups, week };
}
