import {
	getBrackets,
	getLeagueMatchups,
	getLeagueTeamManagers,
	loadPlayers
} from '$lib/utils/helper';

export async function load({ url, fetch }) {
	const queryWeek = url?.searchParams?.get('week');

	// Await all data here
	const matchupsData = await getLeagueMatchups();
	const bracketsData = await getBrackets();
	const leagueTeamManagersData = await getLeagueTeamManagers();
	const playersData = await loadPlayers(fetch);

	return {
		queryWeek: isNaN(queryWeek) ? null : queryWeek,
		matchupsData,
		bracketsData,
		leagueTeamManagersData,
		playersData
	};
}
