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

    let key = $state("regularSeasonData");
    let display = $state("allTime");

    let ready = false;  // flag to control UI rendering

    async function refreshRecords() {
        ready = false;  // block UI

        const newRecords = await getLeagueRecords(true);
        leagueData = newRecords;

        // Wait for records store update if needed (assuming getLeagueRecords updates it)
        // Then mark ready true
        ready = true;
    }

    $effect(() => {
        // If leagueData already present on load, mark ready true
        if (leagueData && !ready) {
            ready = true;
        }
    });

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
    });

    if (stale) {
        refreshTransactions();
    }

    $effect(() => {
        if (leagueData?.stale && !ready) {
            refreshRecords();
        }
    });
</script>

<style>
    /* your styles unchanged */
</style>

{#if ready}
<div class="rankingsWrapper">
    <div class="buttonHolder">
        <Group variant="outlined">
            <Button class="selectionButtons" onclick={() => key = "regularSeasonData"} variant="{key == 'regularSeasonData' ? 'raised' : 'outlined'}">
                <Label>Regular Season</Label>
            </Button>
            <Button class="selectionButtons" onclick={() => key = "playoffData"} variant="{key == 'playoffData' ? 'raised' : 'outlined'}">
                <Label>Playoffs</Label>
            </Button>
        </Group>
        <br />
        <Group variant="outlined">
            <Button class="selectionButtons" onclick={() => display = "allTime"} variant="{display == 'allTime' ? 'raised' : 'outlined'}">
                <Label>All-Time Records</Label>
            </Button>
            <Button class="selectionButtons" onclick={() => display = "season"} variant="{display == 'season' ? 'raised' : 'outlined'}">
                <Label>Season Records</Label>
            </Button>
        </Group>
    </div>

    {#if leagueWeekHighs}
        <details style="margin: 2em 0; padding: 1em; background: #111; color: #0f0; border: 1px solid #0f0; border-radius: 8px;">
            <summary><strong>DEBUG: leagueWeekHighs</strong></summary>
            <pre>{JSON.stringify(leagueWeekHighs.slice(0, 3), null, 2)}</pre>
            <p>Length: {leagueWeekHighs.length}</p>
        </details>
    {/if}

    {#if display == "allTime"}
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
        <PerSeasonRecords
            transactionTotals={totals}
            {leagueRosterRecords}
            {seasonWeekRecords}
            {leagueTeamManagers}
            {currentYear}
            {lastYear}
            {key}
        />
    {/if}
</div>
{:else}
<p>Loading records, please wait...</p>
{/if}
