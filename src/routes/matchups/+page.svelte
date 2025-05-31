<script>
	import { MatchupsAndBrackets } from '$lib/components';

	export let data;

	const {
		queryWeek,
		matchupsData,
		bracketsData,
		playersData,
		leagueTeamManagersData
	} = data;

	const currentYear = matchupsData.currentYear;

	// Filter to only current season's matchups
	const filteredMatchupsData = {
		...matchupsData,
		matchupWeeks: matchupsData.matchupWeeks.filter(week => week.year === currentYear)
	};
</script>

<style>
	#main {
		position: relative;
		z-index: 1;
	}
</style>

<div id="main">
	<MatchupsAndBrackets
		{queryWeek}
		matchupsData={filteredMatchupsData}
		{bracketsData}
		{playersData}
		{leagueTeamManagersData}
	/>
</div>
