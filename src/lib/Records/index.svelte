<script>
	import Button, { Group, Label } from '@smui/button';
	import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
	import AllTimeRecords from './AllTimeRecords.svelte';
	import PerSeasonRecords from './PerSeasonRecords.svelte';

	let { leagueData, totals, stale, leagueTeamManagers } = $props();

	// reactive state
	let key = 'regularSeasonData';
	let display = 'allTime';

	let leagueManagerRecords;
	let leagueRosterRecords;
	let leagueWeekHighs;
	let leagueWeekLows;
	let allTimeClosestMatchups;
	let allTimeBiggestBlowouts;
	let mostSeasonLongPoints;
	let leastSeasonLongPoints;
	let seasonWeekRecords;
	let currentYear;
	let lastYear;

	const refreshTransactions = async () => {
		const newTransactions = await getLeagueTransactions(false, true);
		totals = newTransactions.totals;
	};

	const refreshRecords = async () => {
		const newRecords = await getLeagueRecords(true);
		leagueData = newRecords;
	};

	$: selectedLeagueData = leagueData?.[key];

	$: if (selectedLeagueData) {
		leagueManagerRecords = selectedLeagueData.leagueManagerRecords;
		leagueRosterRecords = selectedLeagueData.leagueRosterRecords;
		leagueWeekHighs = selectedLeagueData.leagueWeekHighs;
		leagueWeekLows = selectedLeagueData.leagueWeekLows;
		allTimeClosestMatchups = selectedLeagueData.allTimeClosestMatchups;
		allTimeBiggestBlowouts = selectedLeagueData.allTimeBiggestBlowouts;
		mostSeasonLongPoints = selectedLeagueData.mostSeasonLongPoints;
		leastSeasonLongPoints = selectedLeagueData.leastSeasonLongPoints;
		seasonWeekRecords = selectedLeagueData.seasonWeekRecords;
		currentYear = selectedLeagueData.currentYear;
		lastYear = selectedLeagueData.lastYear;
	}

	if (stale) {
		refreshTransactions();
	}

	if (leagueData?.stale) {
		refreshRecords();
	}
</script>

<style>
	.rankingsWrapper {
		margin: 0 auto;
		width: 100%;
		max-width: 1200px;
	}
	.empty {
		margin: 10em 0 4em;
		text-align: center;
	}
	.buttonHolder {
		text-align: center;
		margin: 2em 0 0;
	}
	@media (max-width: 540px) {
		:global(.buttonHolder .selectionButtons) {
			font-size: 0.6em;
		}
	}
	@media (max-width: 415px) {
		:global(.buttonHolder .selectionButtons) {
			font-size: 0.5em;
			padding: 0 6px;
		}
	}
	@media (max-width: 315px) {
		:global(.buttonHolder .selectionButtons) {
			font-size: 0.45em;
			padding: 0 3px;
		}
	}
</style>

<div class="rankingsWrapper">
	<!-- Debug output -->
	<pre>
DEBUG:
key = {key}
display = {display}
leagueData keys = {Object.keys(leagueData || {})}
leagueRosterRecords keys = {Object.keys(leagueRosterRecords || {})}
	</pre>

	<div class="buttonHolder">
		<Group variant="outlined">
			<Button
				class="selectionButtons"
				on:click={() => (key = 'regularSeasonData')}
				variant={key == 'regularSeasonData' ? 'raised' : 'outlined'}
			>
				<Label>Regular Season</Label>
			</Button>
			<Button
				class="selectionButtons"
				on:click={() => (key = 'playoffData')}
				variant={key == 'playoffData' ? 'raised' : 'outlined'}
			>
				<Label>Playoffs</Label>
			</Button>
		</Group>
		<br />
		<Group variant="outlined">
			<Button
				class="selectionButtons"
				on:click={() => (display = 'allTime')}
				variant={display == 'allTime' ? 'raised' : 'outlined'}
			>
				<Label>All-Time Records</Label>
			</Button>
			<Button
				class="selectionButtons"
				on:click={() => (display = 'season')}
				variant={display == 'season' ? 'raised' : 'outlined'}
			>
				<Label>Season Records</Label>
			</Button>
		</Group>
	</div>

	{#if display == 'allTime'}
		{#if leagueWeekHighs?.length}
			<AllTimeRecords
				transactionTotals={totals}
				{allTimeClosestMatchups}
				{allTimeBiggestBlowouts}
				{leagueManagerRecords}
				{leagueWeekHighs}
				{leagueWeekLows}
				{leagueTeamManagers}
				{mostSeasonLongPoints}
				{leastSeasonLongPoints}
				{key}
			/>
		{:else}
			<p class="empty">No records <i>yet</i>...</p>
		{/if}
	{:else}
		{#if leagueRosterRecords}
			<PerSeasonRecords
				transactionTotals={totals}
				{leagueRosterRecords}
				{seasonWeekRecords}
				{leagueTeamManagers}
				{currentYear}
				{lastYear}
				{key}
			/>
		{:else}
			<p class="empty">No season records available yet.</p>
		{/if}
	{/if}
</div>
