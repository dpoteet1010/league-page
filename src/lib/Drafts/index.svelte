<script>
	import { waitForAll } from '$lib/utils/helper';
	import LinearProgress from '@smui/linear-progress';
	import Draft from './Draft.svelte';

	export let upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData;

	// Debug logs to check data shape
	console.log('upcomingDraftData:', upcomingDraftData);
	console.log('previousDraftsData:', previousDraftsData);
	console.log('leagueTeamManagersData:', leagueTeamManagersData);
</script>

<style>
	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
		text-align: center;
	}

	h4, h6 {
		text-align: center;
	}
</style>

<!-- Await upcoming draft data -->
{#await waitForAll(upcomingDraftData, leagueTeamManagersData, playersData)}
	<div class="loading">
		<p>Retrieving upcoming draft...</p>
		<br />
		<LinearProgress indeterminate />
	</div>
{:then [upcomingDraft, leagueTeamManagers, playersRaw]}
	{#if upcomingDraft && leagueTeamManagers && playersRaw}
		<h4>Upcoming {upcomingDraft.year} Draft</h4>
		<Draft
			draftData={upcomingDraft}
			{leagueTeamManagers}
			year={upcomingDraft.year}
			players={playersRaw.players ?? playersRaw}
		/>
	{:else}
		<p>Upcoming draft data is incomplete.</p>
	{/if}
{:catch error}
	<p>Something went wrong loading upcoming draft: {error.message}</p>
{/await}

<!-- Await previous drafts data -->
{#await waitForAll(previousDraftsData, leagueTeamManagersData, playersData)}
	<div class="loading">
		<p>Retrieving previous drafts...</p>
		<br />
		<LinearProgress indeterminate />
	</div>
{:then [previousDrafts, leagueTeamManagers, playersRaw]}
	{#if previousDrafts && previousDrafts.length > 0}
		<hr />
		<h4>Previous Drafts</h4>
		{#each previousDrafts as previousDraft}
			<h6>{previousDraft.year} Draft</h6>
			<Draft
				draftData={previousDraft}
				previous={true}
				{leagueTeamManagers}
				year={previousDraft.year}
				players={playersRaw.players ?? playersRaw}
			/>
		{/each}
	{:else}
		<p>No previous drafts available.</p>
	{/if}
{:catch error}
	<p>Something went wrong loading previous drafts: {error.message}</p>
{/await}
