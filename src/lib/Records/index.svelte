<script>
    import Button, { Group, Label } from '@smui/button';
    import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
    import AllTimeRecords from './AllTimeRecords.svelte';
    import PerSeasonRecords from './PerSeasonRecords.svelte';

    let { leagueData, totals, stale, leagueTeamManagers } = $props();

    const refreshTransactions = async () => {
        const newTransactions = await getLeagueTransactions(false, true);
        totals = newTransactions.totals;
        console.log("[REFRESH] Transactions refreshed:", totals);
    };

    let leagueManagerRecords = $state();
    let leagueRosterRecords = $state();
    let leagueWeekHighs = $state();
    let leagueWeekLows = $state();
    let allTimeClosestMatchups = $state();
    let allTimeBiggestBlowouts = $state();
    let mostSeasonLongPoints = $state();
    let leastSeasonLongPoints = $state();
    let seasonWeekRecords = $state();
    let currentYear = $state();
    let lastYear = $state();

    const refreshRecords = async () => {
        const newRecords = await getLeagueRecords(true);
        leagueData = newRecords;
        console.log("[REFRESH] Records refreshed:", newRecords);
        console.log("[REFRESH] leagueWeekHighs (refreshed):", newRecords?.regularSeasonData?.leagueWeekHighs);
    };

    let key = $state("regularSeasonData");

    $effect(() => {
        if (!leagueData || !leagueData[key]) return;

        const selectedLeagueData = leagueData[key];

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

        // 🔍 Debug log
        console.log("[UI EFFECT] Data loaded for key:", key);
        console.log("[UI EFFECT] leagueWeekHighs length:", leagueWeekHighs?.length);
        console.log("[UI EFFECT] leagueWeekHighs sample:", leagueWeekHighs?.slice(0, 2));
    });

    if (stale) {
        refreshTransactions();
    }

    if (leagueData?.stale) {
        refreshRecords();
    }

    let display = $state("allTime");
</script>
