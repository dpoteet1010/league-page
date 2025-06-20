<script>
	import Button, { Group, Label } from '@smui/button';
	import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
	import AllTimeRecords from './AllTimeRecords.svelte';
	import PerSeasonRecords from './PerSeasonRecords.svelte';

	let { leagueData: initialLeagueData, totals: initialTotals, stale, leagueTeamManagers } = $props();

	// 🧠 Local state
	let leagueData = $state(initialLeagueData);
	let totals = $state(initialTotals);

	let leagueManagerRecords = $state([]);
	let leagueRosterRecords = $state([]);
	let leagueWeekHighs = $state();
	let leagueWeekLows = $state();
	let allTimeClosestMatchups = $state([]);
	let allTimeBiggestBlowouts = $state([]);
	let mostSeasonLongPoints = $state([]);
	let leastSeasonLongPoints = $state([]);
	let seasonWeekRecords = $state([]);
	let currentYear = $state();
	let lastYear = $state();

	let key = $state("regularSeasonData");
	let display = $state("allTime");

	const refreshTransactions = async () => {
		const newTransactions = await getLeagueTransactions(false, true);
		totals = newTransactions.totals;
	};

	const refreshRecords = async () => {
		const newRecords = await getLeagueRecords(true);
		leagueData = newRecords;
	};

	// 🧠 Reactive effect to update record fields after leagueData changes
	$effect(() => {
		if (!leagueData || !leagueData[key]) {
			return;
		}

		const selected = leagueData[key];

		leagueManagerRecords = selected.leagueManagerRecords || [];
		leagueRosterRecords = selected.leagueRosterRecords || [];
		leagueWeekHighs = selected.leagueWeekHighs || [];
		leagueWeekLows = selected.leagueWeekLows || [];
		allTimeClosestMatchups = selected.allTimeClosestMatchups || [];
		allTimeBiggestBlowouts = selected.allTimeBiggestBlowouts || [];
		mostSeasonLongPoints = selected.mostSeasonLongPoints || [];
		leastSeasonLongPoints = selected.leastSeasonLongPoints || [];
		seasonWeekRecords = selected.seasonWeekRecords || [];
		currentYear = selected.currentYear;
		lastYear = selected.lastYear;
	});

	// 🧠 Trigger fetch if marked as stale
	if (stale) {
		refresh
