import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { legacyLeagueUsers } from './helperFunctions/legacyLeagueUsers.js'; 

/**
 * Server-side version of getLeagueTeamManagers.
 * Maps both Sleeper API and local legacy arrays into a consistent [year][userID] object.
 */
export const getLeagueTeamManagers = async (queryLeagueID = defaultLeagueID) => {
    try {
        const teamManagersMap = {};

        // 1. Process Legacy Data (2023 & 2024)
        // Since these are arrays, we loop through them to build the nested map
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

        // 2. Fetch and Process Current Sleeper Users (e.g., 2025/2026)
        const response = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/users`)
            .catch(() => null);
        
        if (response && response.ok) {
            const sleeperUsers = await response.json();
            
            // We'll assume the active season is 2025 for this slot
            // You can also dynamically pull this from leagueData if preferred
            const currentYear = "2025"; 
            if (!teamManagersMap[currentYear]) teamManagersMap[currentYear] = {};

            sleeperUsers.forEach(user => {
                const uid = user.user_id;
                teamManagersMap[currentYear][uid] = {
                    name: user.metadata?.team_name || user.display_name || "Unknown Manager",
                    avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
                };
            });
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
