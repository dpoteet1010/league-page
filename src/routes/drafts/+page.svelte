<script>
	import { Drafts } from '$lib/components';

    export let data;
    const {upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData} = data;

	console.log('previousDraftsData:', previousDraftsData);
</script>

<style>
    #main {
        position: relative;
        z-index: 1;
    }
</style>

<div id="main">
	<Drafts {upcomingDraftData} {previousDraftsData} {leagueTeamManagersData} {playersData} />
</div>
