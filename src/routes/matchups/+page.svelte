<script>
	import { MatchupsAndBrackets } from '$lib/components';

	export let data;

	// Destructure loaded promises
	const {
		queryWeek,
		matchupsData,
		bracketsData,
		playersData,
		leagueTeamManagersData
	} = data;

	// Await matchupsData to access the current year
	const matchups = await matchupsData;
	const currentYear = matchups.currentYear;

	// ✅ Filter only current season's matchups
	const filteredMatchupsData = {
		...matchups,
		matchupWeeks: matchups.matchupWeeks.filter(week => week.year === currentYear)
	};
</script>

<style>
	#main {
		position: relative;
		z-index: 1;
	}
</style>

<div id="main">
	<!-- ✅ Pass only current season matchups to the component -->
	<MatchupsAndBrackets
		{queryWeek}
		matchupsData={filteredMatchupsData}
		{bracketsData}
		{playersData}
		{leagueTeamManagersData}
	/>
</div>
