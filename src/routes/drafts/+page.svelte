<script>
    export let upcomingDraftData;
    export let previousDraftsData;
    export let leagueTeamManagersData;
    export let playersData;

    console.log('🧪 Drafts received props:', {
        upcomingDraftData,
        previousDraftsData,
        leagueTeamManagersData,
        playersData
    });
</script>
<script>
	import { Drafts } from '$lib/components';

    export let data;
    const {upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData} = data;
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
