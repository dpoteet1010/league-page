import { leagueID } from '$lib/utils/helperFunctions/leagueInfo.js';
import { legacyLeagueUsers } from './helperFunctions/legacyLeagueUsers.js';

/**
 * Server-side version of getLeagueTeamManagers.
 * Corrected: Path to leagueInfo, .js extension, and structural alignment for Gemini.
 */
export const getLeagueTeamManagers = async () => {
    // 1. Fetch Current Sleeper Users
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/users`);
    if (!res.ok) throw new Error("Managers Fetch Failed");
    const currentUsers = await res.json();
    
    // 2. Initialize the master data object
    // Note: We use 'teamManagersMap' to match the expectations of your Gemini system prompt
    const finalData = {
        users: {},           // Global map of user_id -> user object
        teamManagersMap: {}  // Seasonal map: { "2023": { user_id: user }, ... }
    };

    // 3. Process Current Users (Assuming 2026 based on your current project state)
    const currentYear = "2026"; 
    finalData.teamManagersMap[currentYear] = {};

    for (const user of currentUsers) {
        const userData = {
            user_id: user.user_id,
            display_name: user.display_name,
            avatar: user.avatar
        };
        finalData.users[user.user_id] = userData;
        finalData.teamManagersMap[currentYear][user.user_id] = userData;
    }

    // 4. Inject Legacy Users (2023 & 2024)
    for (const year in legacyLeagueUsers) {
        finalData.teamManagersMap[year] = {};
        for (const user of legacyLeagueUsers[year]) {
            const userData = {
                user_id: user.user_id,
                display_name: user.display_name || user.user_name,
                avatar: user.avatar
            };
            
            // Add to seasonal map
            finalData.teamManagersMap[year][user.user_id] = userData;
            
            // Add to global map if not already there
            if (!finalData.users[user.user_id]) {
                finalData.users[user.user_id] = userData;
            }
        }
    }

    return finalData;
}
