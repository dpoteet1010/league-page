import { leagueID } from '$lib/utils/leagueInfo';

export const getLeagueTeamManagers = async () => {
    // We fetch the users for the league directly
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/users`);
    if (!res.ok) throw new Error("Managers Fetch Failed");
    const users = await res.json();
    
    // Convert array to a map for easy AI lookup
    const usersMap = {};
    for(const user of users) {
        usersMap[user.user_id] = user;
    }
    return { users: usersMap };
}
