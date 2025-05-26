import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyRosters } from '$lib/utils/legacyRosters.js';

let legacyAppended = false; // Ensures static data is added only once

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
    // Append legacy rosters once per session
    if (!legacyAppended) {
        rostersStore.update(current => {
            const merged = { ...current };
            for (const key in legacyRosters) {
                if (!merged[key]) {
                    merged[key] = legacyRosters[key];
                }
            }
            return merged;
        });
        legacyAppended = true;
    }

    const storedRoster = get(rostersStore)[queryLeagueID];
    if (
        storedRoster &&
        typeof storedRoster.rosters === 'object' &&
        !Array.isArray(storedRoster.rosters) &&
        storedRoster.rosters !== null
    ) {
        return storedRoster;
    }

    // Fetch from Sleeper API
    let res;
    try {
        res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, { compress: true });
    } catch (err) {
        console.error("Fetch error:", err);
        throw new Error("Network error fetching roster data.");
    }

    let data;
    try {
        data = await res.json();
    } catch (err) {
        console.error("JSON parsing error:", err);
        throw new Error("Invalid JSON in API response.");
    }

    if (res.ok) {
        const processedRosters = processRosters(data);
        rostersStore.update(r => {
            r[queryLeagueID] = processedRosters;
            return r;
        });
        return processedRosters;
    } else {
        throw new Error(data);
    }
};

const processRosters = (rosters) => {
    const startersAndReserve = [];
    const rosterMap = {};
    for (const roster of rosters) {
        for (const starter of roster.starters) {
            startersAndReserve.push(starter);
        }
        if (roster.reserve) {
            for (const ir of roster.reserve) {
                startersAndReserve.push(ir);
            }
        }
        rosterMap[roster.roster_id] = roster;
    }
    return { rosters: rosterMap, startersAndReserve };
};
