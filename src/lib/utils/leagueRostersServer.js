import { leagueID } from '$lib/utils/leagueInfo.js';
import { legacyLeagueRosters } from './helperFunctions/legacyLeagueRosters.js';

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
    // 1. Check for Legacy Years
    if (queryLeagueID === "2023" || queryLeagueID === "2024") {
        return {
            rosters: legacyLeagueRosters[queryLeagueID] || {},
            leagueID: queryLeagueID
        };
    }

    // 2. Otherwise, fetch from Sleeper
    try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`);
        if (!res.ok) return { rosters: {}, leagueID: queryLeagueID };
        
        const rostersData = await res.json();
        const rosters = {};
        for(const roster of rostersData) {
            rosters[roster.roster_id] = roster;
        }
        return { rosters, leagueID: queryLeagueID };
    } catch (err) {
        return { rosters: {}, leagueID: queryLeagueID };
    }
};
