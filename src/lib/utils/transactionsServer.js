import { leagueID } from '$lib/utils/leagueInfo';

export const getTransactions = async (week) => {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/transactions/${week}`);
    if (!res.ok) throw new Error("Transactions Fetch Failed");
    return await res.json();
}
