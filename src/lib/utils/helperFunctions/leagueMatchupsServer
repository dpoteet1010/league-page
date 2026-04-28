import { getLeagueData } from "./leagueDataServer";
import { getNflState } from "./nflStateServer";
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';

/**
 * Server-side version of getLeagueMatchups.
 * Removed Svelte store dependencies and standardized fetch logic.
 */
export const getLeagueMatchups = async () => {
    // 1. Fetch NFL state and League configuration
    const [nflState, leagueData] = await Promise.all([
        getNflState(),
        getLeagueData(),
    ]).catch((err) => { 
        console.error("Matchups Pre-fetch Error:", err); 
        return [null, null];
    });

    if (!nflState || !leagueData) return null;

    // 2. Determine current timeline
    let week = 1;
    if (nflState.season_type == 'regular') {
        week = nflState.display_week;
    } else if (nflState.season_type == 'post') {
        week = 18;
    }

    const year = leagueData.season;
    const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

    // 3. Queue up all regular season matchup fetches
    const matchupsPromises = [];
    for (let i = 1; i < leagueData.settings.playoff_week_start; i++) {
        matchupsPromises.push(
            fetch(`https://api.sleeper.app/v1/league/${defaultLeagueID}/matchups/${i}`)
                .then(res => {
                    if (!res.ok) throw new Error(`Failed to fetch week ${i}`);
                    return res.json();
                })
        );
    }

    // 4. Resolve all weekly data
    const matchupsData = await Promise.all(matchupsPromises).catch((err) => { 
        console.error("Batch Matchup Fetch Error:", err);
        return [];
    });

    const matchupWeeks = [];
    
    // 5. Process weeks into a keyed matchup object
    for (let i = 1; i <= matchupsData.length; i++) {
        const processed = processMatchups(matchupsData[i - 1], i);
        if (processed) {
            matchupWeeks.push({
                matchups: processed.matchups,
                week: processed.week
            });
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
            total_points: match.points // Adding total points as well for easier AI parsing
        });
    }
    return { matchups, week };
}
