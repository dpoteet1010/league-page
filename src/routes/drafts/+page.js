import { getUpcomingDraft, getPreviousDrafts, getLeagueTeamManagers, loadPlayers } from '$lib/utils/helper';

export async function load({ fetch }) {
    const upcomingDraftData = await getUpcomingDraft();
    const previousDraftsData = await getPreviousDrafts();
    const leagueTeamManagersData = await getLeagueTeamManagers();
    const playersData = await loadPlayers(fetch);

    return {
        upcomingDraftData,
        previousDraftsData,
        leagueTeamManagersData,
        playersData,
    };
}
