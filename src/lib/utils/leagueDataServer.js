import { leagueID } from '$lib/utils/leagueInfo';

export const getLeagueData = async () => {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}`);
    if (!res.ok) throw new Error("League Data Fetch Failed");
    return await res.json();
}
