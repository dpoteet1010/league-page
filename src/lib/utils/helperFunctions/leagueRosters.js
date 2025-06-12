import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from './legacyLeagueRosters.js';

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
    const storedRoster = get(rostersStore)[queryLeagueID];

    if (
        storedRoster &&
        typeof storedRoster.rosters === 'object' &&
        !Array.isArray(storedRoster.rosters) &&
        storedRoster.rosters !== null
    ) {
        return storedRoster;
    }

    // Handle legacy years
    if (queryLeagueID === '2023' || queryLeagueID === '2024') {
        console.log(`📦 Using legacy rosters for league ${queryLeagueID}`);
        const legacyArray = legacyLeagueRosters[queryLeagueID];
        if (!Array.isArray(legacyArray)) {
            throw new Error(`❌ Legacy data for ${queryLeagueID} must be an array`);
        }

        const processed = processRosters(legacyArray);
        rostersStore.update(r => {
            r[queryLeagueID] = processed;
            return r;
        });
        return processed;
    }

    // Otherwise fetch from Sleeper API
    const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, { compress: true }).catch(err => {
        console.error("❌ Network error:", err);
        throw new Error("Network error fetching rosters");
    });

    const data = await res.json().catch(err => {
        console.error("❌ JSON parsing error:", err);
        throw new Error("Invalid JSON response from Sleeper API");
    });

    if (res.ok) {
        const processed = processRosters(data);
        rostersStore.update(r => {
            r[queryLeagueID] = processed;
            return r;
        });
        return processed;
    } else {
        throw new Error(data);
    }
};

// Helper to process Sleeper or legacy roster arrays
const processRosters = (rosters) => {
    const startersAndReserve = [];
    const rosterMap = {};
    for (const roster of rosters) {
        if (Array.isArray(roster.starters)) {
            for (const starter of roster.starters) {
                startersAndReserve.push(starter);
            }
        }
        if (Array.isArray(roster.reserve)) {
            for (const ir of roster.reserve) {
                startersAndReserve.push(ir);
            }
        }
        rosterMap[roster.roster_id] = roster;
    }
    return { rosters: rosterMap, startersAndReserve };
};
