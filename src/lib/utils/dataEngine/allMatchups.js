import { getLeagueData } from "$lib/utils/helperFunctions/leagueData.js";
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getNflState } from "$lib/utils/helperFunctions/nflState.js";
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise.js';
import { get } from 'svelte/store';
import { engineMatchupsStore } from '$lib/stores'; 
import { legacyMatchups } from '$lib/utils/helperFunctions/legacyMatchups.js';

export const getSpecificYearMatchups = async (queryLeagueID = mainLeagueID) => {
    const currentStore = get(engineMatchupsStore);
    
    // 1. Check cache first
    if (currentStore.history && currentStore.history[queryLeagueID]) {
        engineMatchupsStore.update(s => ({ ...s, ...s.history[queryLeagueID] }));
        return currentStore.history[queryLeagueID];
    }

    // 2. Handle Legacy Seasons (2023, 2024)
    const isLegacyYear = isNaN(queryLeagueID) === false && queryLeagueID.toString().length === 4;
    
    if (isLegacyYear) {
        const yearStr = queryLeagueID.toString();
        const yearMatchups = legacyMatchups[yearStr];

        if (!yearMatchups) {
            console.error(`No legacy matchups found for year ${yearStr}`);
            return null;
        }

        const matchupWeeks = [];
        Object.entries(yearMatchups).forEach(([weekNum, inputMatchups]) => {
            const processed = processMatchups(inputMatchups, parseInt(weekNum));
            if (processed) {
                matchupWeeks.push({
                    matchups: processed.matchups,
                    week: processed.week
                });
            }
        });

        const legacySeasonData = {
            matchupWeeks,
            leagueID: yearStr,
            year: yearStr,
            week: 14,
            regularSeasonLength: 14
        };

        engineMatchupsStore.update(s => ({
            ...legacySeasonData,
            history: { ...(s.history || {}), [queryLeagueID]: legacySeasonData }
        }));

        return legacySeasonData;
    }

    // 3. API Fetch Logic (2025+)
    const [nflState, leagueData] = await waitForAll(
        getNflState(),
        getLeagueData(queryLeagueID),
    ).catch((err) => { 
        console.error("Error fetching metadata:", err); 
        return [null, null];
    });

    if (!leagueData) return null;

    let week = 1;
    if (nflState.season_type === 'regular') week = nflState.display_week;
    else if (nflState.season_type === 'post') week = 18;
    
    const year = leagueData.season;
    const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

    const matchupsPromises = [];
    for (let i = 1; i <= regularSeasonLength; i++) {
        matchupsPromises.push(
            fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`, { compress: true })
        );
    }
    
    const matchupsRes = await waitForAll(...matchupsPromises);
    const matchupsJsonPromises = [];
    for (const res of matchupsRes) {
        if (!res.ok) continue;
        matchupsJsonPromises.push(res.json());
    }
    
    const matchupsData = await Promise.all(matchupsJsonPromises).catch((err) => { 
        console.error("Error parsing matchups JSON:", err); 
    });

    const matchupWeeks = [];
    for (let i = 1; i <= matchupsData.length; i++) {
        const processed = processMatchups(matchupsData[i - 1], i);
        if (processed) {
            matchupWeeks.push({ matchups: processed.matchups, week: processed.week });
        }
    }

    const seasonData = {
        matchupWeeks,
        leagueID: queryLeagueID,
        year,
        week,
        regularSeasonLength
    };

    engineMatchupsStore.update(s => ({
        ...seasonData,
        history: { ...(s.history || {}), [queryLeagueID]: seasonData }
    }));

    return seasonData;
};

// FIXED: Looking directly at match.points instead of match.starters_points
const processMatchups = (inputMatchups, week) => {
    if (!inputMatchups || inputMatchups.length === 0) return false;
    const matchups = {};
    for (const match of inputMatchups) {
        if (!matchups[match.matchup_id]) {
            matchups[match.matchup_id] = [];
        }
        matchups[match.matchup_id].push({
            roster_id: match.roster_id,
            starters: match.starters,
            points: match.points, // <-- FIXED: Point accurately to schema root
        });
    }
    return { matchups, week };
};
