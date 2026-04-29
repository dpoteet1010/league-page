import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { legacyLeagueUsers } from './helperFunctions/legacyLeagueUsers.js'; 
import { getLeagueData } from './leagueDataServer.js';

export const getLeagueTeamManagers = async (queryLeagueID = defaultLeagueID) => {
    try {
        const teamManagersMap = {};

        // 1. Process Legacy Data
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
        let safetyBuffer = 0; // Prevent infinite loops

        while (loopID && loopID !== "0" && loopID !== "2023" && loopID !== "2024" && safetyBuffer < 5) {
            const leagueInfo = await getLeagueData(loopID);
            if (!leagueInfo) break;

            const year = leagueInfo.season;
            const response = await fetch(`https://api.sleeper.app/v1/league/${loopID}/users`).catch(() => null);
            
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

            loopID = leagueInfo.previous_league_id;
            safetyBuffer++;
        }

        return { teamManagersMap, success: true };
    } catch (err) {
        console.error("Error in leagueTeamManagersServer:", err);
        return { teamManagersMap: {}, success: false };
    }
};
