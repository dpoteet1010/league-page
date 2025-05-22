<script>
	import { waitForAll } from '$lib/utils/helper';
    import LinearProgress from '@smui/linear-progress';
    import Draft from './Draft.svelte'; 

    export let upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData;
</script>

<style>
	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
	}

    h4 {
        text-align: center;
    }

    h6 {
        text-align: center;
    }
</style>

<!-- Awaiting upcoming draft data -->
{#await waitForAll(upcomingDraftData, leagueTeamManagersData, playersData) }
	<div class="loading">
		<p>Retrieving upcoming draft...</p>
		<br />
		<LinearProgress indeterminate />
	</div>
{:then [upcomingDraft, leagueTeamManagers, {players}] }
    <h4>Upcoming {upcomingDraft.year} Draft</h4>
    <Draft draftData={upcomingDraft} {leagueTeamManagers} year={upcomingDraft.year} {players} />
{:catch error}
	<!-- Error handling for upcoming drafts -->
	<p>Something went wrong: {error.message}</p>
{/await}

<!-- Awaiting previous drafts data -->
{#await waitForAll(previousDraftsData, leagueTeamManagersData, playersData) }
	<div class="loading">
		<p>Retrieving previous drafts...</p>
		<br />
		<LinearProgress indeterminate />
	</div>
{:then [previousDrafts, leagueTeamManagers, {players}] }
	<!-- Only show previous drafts if there is data -->
	{#if previousDrafts && previousDrafts.length > 0}
		<hr />
		<h4>Previous Drafts</h4>
		{#each previousDrafts as previousDraft}
			<h6>{previousDraft.year} Draft</h6>
			<Draft draftData={previousDraft} previous={true} {leagueTeamManagers} year={previousDraft.year} {players} />
		{/each}
	{:else}
		<!-- If no previous drafts, show a message -->
		<p>No previous drafts available.</p>
	{/if}
{:catch error}
	<!-- Error handling for previous drafts -->
	<p>Something went wrong: {error.message}</p>
{/await}
