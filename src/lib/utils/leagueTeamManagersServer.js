import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
// Import your local legacy user data (2023/2024)
import { legacyUsers } from './helperFunctions/legacyUsers.js'; 

/**
 * Server-side version of getLeagueTeamManagers.
 * Consolidates Sleeper users and legacy local users into a single map.
 */
export const getLeagueTeamManagers = async (queryLeagueID = defaultLeagueID) => {
    try {
        // 1. Fetch current Sleeper users (for 2025/2026)
        const response = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/users`)
            .catch(() => null);
        
        let sleeperUsers = [];
        if (response && response.ok) {
            sleeperUsers = await response.json();
        }

        // 2. Initialize the Global Manager Map with your Legacy Data
        // legacyUsers should be structured as: { "2023": { "1": { name: "..." }, ... }, "2024": {...} }
        const teamManagersMap = {
            ...legacyUsers, 
        };

        // 3. Process Sleeper users into the current season slot
        // We'll dynamically determine the year from the context or a default
        const currentYear = "2025"; 
        
        // Ensure we don't overwrite if it already exists, or initialize it
        if (!teamManagersMap[currentYear]) {
            teamManagersMap[currentYear] = {};
        }
        
        for (const user of sleeperUsers) {
            // Sleeper uses user_id to link to rosters
            const uid = user.user_id;
            
            teamManagersMap[currentYear][uid] = {
                name: user.metadata?.team_name || user.display_name || "Unknown Manager",
                avatar: user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null,
                display_name: user.display_name
            };
        }

        return { 
            teamManagersMap,
            success: true 
        };

    } catch (err) {
        console.error("Error in leagueTeamManagersServer:", err);
        // Fallback to just legacy data if the API fetch fails
        return { 
            teamManagersMap: legacyUsers || {}, 
            success: false 
        };
    }
};
