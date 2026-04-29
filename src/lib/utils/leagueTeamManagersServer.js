import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { legacyLeagueUsers } from './helperFunctions/legacyLeagueUsers.js'; 
import { getLeagueData } from './leagueDataServer.js';

/**
 * Server-side version of getLeagueTeamManagers.
 * Dynamically walks the Sleeper chain and merges with local legacy data.
 */
export const getLeagueTeamManagers = async (queryLeagueID = defaultLeagueID) => {
    try {
        const teamManagersMap = {};

        // 1. Process Legacy Data (The only hardcoded part)
        for (const year in legacyLeagueUsers) {
            teamManagersMap[year] = {};
            legacyLeagueUsers[year].forEach(user => {
                const uid = user.user_id;
                teamManagersMap[year][uid] = {
                    name: user.metadata?.team_name || user.display_name || "Unknown Manager",
                    avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
                };
            });
        }

        // 2. Dynamically walk the Sleeper Chain
        let loopID = queryLeagueID;
        while (loopID && loopID !== "0" && loopID !== "2023" && loopID !== "2024") {
            // Get league info to find out what YEAR this ID belongs to
            const leagueInfo = await getLeagueData(loopID);
            if (!leagueInfo) break;

            const year = leagueInfo.season;
            
            // Fetch users for this specific year in the chain
            const response = await fetch(`https://api.sleeper.app/v1/league/${loopID}/users`)
                .catch(() => null);
            
            if (response && response.ok) {
                const sleeperUsers = await response.json();
                
                if (!teamManagersMap[year]) teamManagersMap[year] = {};

                sleeperUsers.forEach(user => {
                    const uid = user.user_id;
                    teamManagersMap[year][uid] = {
                        name: user.metadata?.team_name || user.display_name || "Unknown Manager",
                        avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
                    };
                });
            }

            // Move to the previous year in the Sleeper chain
            loopID = leagueInfo.previous_league_id;
        }

        return { 
            teamManagersMap,
            success: true 
        };

    } catch (err) {
        console.error("Error in leagueTeamManagersServer:", err);
        return { teamManagersMap: {}, success: false };
    }
};
