import { leagueID } from '$lib/utils/leagueInfo';
import { legacyLeagueUsers } from './helperFunctions/legacyLeagueUsers.js'; // Ensure path is correct

export const getLeagueTeamManagers = async () => {
    // 1. Fetch Current Sleeper Users (2025/2026)
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/users`);
    if (!res.ok) throw new Error("Managers Fetch Failed");
    const currentUsers = await res.json();
    
    // 2. Initialize the master data object
    const finalData = {
        users: {},       // Global map of user_id -> user object
        byYear: {}       // Seasonal map: { "2023": { user_id: user }, ... }
    };

    // 3. Process Current Users
    for (const user of currentUsers) {
        const userData = {
            user_id: user.user_id,
            display_name: user.display_name,
            avatar: user.avatar
        };
        finalData.users[user.user_id] = userData;
    }

    // 4. Inject Legacy Users (2023 & 2024)
    // legacyLeagueUsers is usually structured as { 2023: [...], 2024: [...] }
    for (const year in legacyLeagueUsers) {
        finalData.byYear[year] = {};
        for (const user of legacyLeagueUsers[year]) {
            const userData = {
                user_id: user.user_id,
                display_name: user.display_name || user.user_name,
                avatar: user.avatar
            };
            
            // Add to seasonal map
            finalData.byYear[year][user.user_id] = userData;
            
            // Add to global map if not already there (preserves most recent info)
            if (!finalData.users[user.user_id]) {
                finalData.users[user.user_id] = userData;
            }
        }
    }

    return finalData;
}
