import { getLeagueRecords, getLeagueTeamManagers, getLeagueTransactions, waitForAll } from '$lib/utils/helper';

export async function load() {
    const recordsInfo = await waitForAll(
        getLeagueRecords(false),
        getLeagueTransactions(false),
        getLeagueTeamManagers(),
    );

    return {
        recordsInfo
    };
}
