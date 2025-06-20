<script>
    import Button, { Group, Label } from '@smui/button';
    import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
    import AllTimeRecords from './AllTimeRecords.svelte';
    import PerSeasonRecords from './PerSeasonRecords.svelte';

    let { leagueData, totals, stale, leagueTeamManagers } = $props();

    const refreshTransactions = async () => {
        const newTransactions = await getLeagueTransactions(false, true);
        totals = newTransactions.totals;
    };

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

    let key = "regularSeasonData";
    let display = "allTime";

    const refreshRecords = async () => {
        const newRecords = await getLeagueRecords(true);
        leagueData = newRecords;
    };

    // ✅ Native Svelte reactivity (Option 1)
    $: if (leagueData && leagueData[key]) {
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
    }

    // Refresh if stale
    if (stale) {
        refreshTransactions();
    }

    if (leagueData?.stale) {
        refreshRecords();
    }
</script>
