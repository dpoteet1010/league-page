import { get } from 'svelte/store';
import { leagueData } from '$lib/stores';
import { leagueID } from '$lib/utils/leagueInfo';
import { legacyLeagueData } from './legacyLeagueData.js';

let legacyAppended = false; // Ensures we only append once per session

export const getLeagueData = async (queryLeagueID = leagueID) => {
    // Append legacy data once if not already done
    if (!legacyAppended) {
        leagueData.update(current => {
            const merged = { ...current };
            for (const key in legacyLeagueData) {
                if (!merged[key]) {
                    merged[key] = legacyLeagueData[key];
                }
            }
            return merged;
        });
        legacyAppended = true;
    }

    const currentCache = get(leagueData);
    if (currentCache[queryLeagueID]) {
        return currentCache[queryLeagueID];
    }

    // Fetch from Sleeper API if not in cache or legacy data
    let res;
    try {
        res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}`, {
            compress: true
        });
    } catch (err) {
        console.error("Fetch error:", err);
        throw new Error("Network error fetching league data.");
    }

    let data;
    try {
        data = await res.json();
    } catch (err) {
        console.error("JSON parsing error:", err);
        throw new Error("Invalid JSON in API response.");
    }

    if (res.ok) {
        leagueData.update(ld => {
            ld[queryLeagueID] = data;
            return ld;
        });
        return data;
    } else {
        throw new Error(data);
    }
};
