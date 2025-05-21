import { getUpcomingDraft, getPreviousDrafts, getLeagueTeamManagers, loadPlayers } from '$lib/utils/helper';

export async function load({ fetch }) {
    // Await the necessary async data
    const [upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData] = await Promise.all([
        getUpcomingDraft(),
        getPreviousDrafts(),
        getLeagueTeamManagers(),
        loadPlayers(fetch),
    ]);

    return {
        upcomingDraftData,
        previousDraftsData,
        leagueTeamManagersData,
        playersData,
    };
}
