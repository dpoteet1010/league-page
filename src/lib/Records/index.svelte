<script>
    import Button, { Group, Label } from '@smui/button';
    import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
    import AllTimeRecords from './AllTimeRecords.svelte';
    import PerSeasonRecords from './PerSeasonRecords.svelte';

    let {leagueData, totals, stale, leagueTeamManagers} = $props();

    const refreshTransactions = async () => {
        const newTransactions = await getLeagueTransactions(false, true);
        totals = newTransactions.totals;
        console.log("🔄 Refreshed transactions:", totals);
    }

    // Data state
    let leagueManagerRecords = $state(null);
    let leagueRosterRecords = $state(null);
    let leagueWeekHighs = $state(null);
    let leagueWeekLows = $state(null);
    let allTimeClosestMatchups = $state(null);
    let allTimeBiggestBlowouts = $state(null);
    let mostSeasonLongPoints = $state(null);
    let leastSeasonLongPoints = $state(null);
    let seasonWeekRecords = $state(null);
    let currentYear = $state(null);
    let lastYear = $state(null);

    const refreshRecords = async () => {
        const newRecords = await getLeagueRecords(true);
        console.log("🔄 Refreshed records:", newRecords);
        leagueData = newRecords;
    }

    let key = $state("regularSeasonData");
    let display = $state("allTime");

    $effect(() => {
        console.log("🔁 leagueData or key changed:", leagueData, key);

        if (!leagueData || !leagueData[key]) {
            console.warn("⚠️ leagueData or keyed data not ready:", { leagueData, key });
            return;
        }

        const selectedLeagueData = leagueData[key];

        leagueManagerRecords = selectedLeagueData?.leagueManagerRecords ?? null;
        leagueRosterRecords = selectedLeagueData?.leagueRosterRecords ?? null;
        leagueWeekHighs = selectedLeagueData?.leagueWeekHighs ?? null;
        leagueWeekLows = selectedLeagueData?.leagueWeekLows ?? null;
        allTimeClosestMatchups = selectedLeagueData?.allTimeClosestMatchups ?? null;
        allTimeBiggestBlowouts = selectedLeagueData?.allTimeBiggestBlowouts ?? null;
        mostSeasonLongPoints = selectedLeagueData?.mostSeasonLongPoints ?? null;
        leastSeasonLongPoints = selectedLeagueData?.leastSeasonLongPoints ?? null;
        seasonWeekRecords = selectedLeagueData?.seasonWeekRecords ?? null;
        currentYear = selectedLeagueData?.currentYear ?? null;
        lastYear = selectedLeagueData?.lastYear ?? null;

        console.log("✅ UI state updated from selectedLeagueData");
    });

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
    <div class="buttonHolder">
        <Group variant="outlined">
            <Button class="selectionButtons" on:click={() => key = "regularSeasonData"} variant={key === "regularSeasonData" ? "raised" : "outlined"}>
                <Label>Regular Season</Label>
            </Button>
            <Button class="selectionButtons" on:click={() => key = "playoffData"} variant={key === "playoffData" ? "raised" : "outlined"}>
                <Label>Playoffs</Label>
            </Button>
        </Group>
        <br />
        <Group variant="outlined">
            <Button class="selectionButtons" on:click={() => display = "allTime"} variant={display === "allTime" ? "raised" : "outlined"}>
                <Label>All-Time Records</Label>
            </Button>
            <Button class="selectionButtons" on:click={() => display = "season"} variant={display === "season" ? "raised" : "outlined"}>
                <Label>Season Records</Label>
            </Button>
        </Group>
    </div>

    {#if display === "allTime"}
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
            <p class="empty">Season records not available yet. Please try refreshing.</p>
        {/if}
    {/if}

    <!-- 🔍 Debug output to help confirm state -->
    <pre style="font-size: 0.75em; margin-top: 2em; overflow-x: auto; background: #f0f0f0; padding: 1em;">
        DEBUG:
        key = {key}
        display = {display}
        leagueData keys = {leagueData ? Object.keys(leagueData).join(", ") : "null"}
        leagueRosterRecords: {JSON.stringify(leagueRosterRecords, null, 2)}
    </pre>
</div>
