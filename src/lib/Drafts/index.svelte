<script>
	import LinearProgress from '@smui/linear-progress';
	import Draft from './Draft.svelte';

	export let upcomingDraftData, previousDraftsData, leagueTeamManagersData, playersData;

	// Wrap in Promise.resolve to ensure they are promises
	const upcomingDraftPromise = Promise.resolve(upcomingDraftData);
	const previousDraftsPromise = Promise.resolve(previousDraftsData);
	const leagueTeamManagersPromise = Promise.resolve(leagueTeamManagersData);
	const playersPromise = Promise.resolve(playersData);

	// Debug logs to verify data types
	console.log('upcomingDraftData (raw):', upcomingDraftData);
	console.log('previousDraftsData (raw):', previousDraftsData);
	console.log('leagueTeamManagersData (raw):', leagueTeamManagersData);
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
{#await Promise.all([upcomingDraftPromise, leagueTeamManagersPromise, playersPromise])}
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
{#await Promise.all([previousDraftsPromise, leagueTeamManagersPromise, playersPromise])}
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
