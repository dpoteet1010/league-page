<script>
    import Button, { Group, Label } from '@smui/button';
    import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
    import AllTimeRecords from './AllTimeRecords.svelte';
    import PerSeasonRecords from './PerSeasonRecords.svelte';

    let {leagueData, totals, stale, leagueTeamManagers} = $props();;

    // 👇 Add log state
    let logMessages = $state([]);

    function log(message, data = null) {
        const output = data ? `${message}: ${JSON.stringify(data, null, 2)}` : message;
        logMessages = [...logMessages, output];
        console.log(output);
    }

    const refreshTransactions = async () => {
        log("Refreshing transactions...");
        const newTransactions = await getLeagueTransactions(false, true);
        totals = newTransactions.totals;
        log("Transactions refreshed", totals);
    }

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
        log("Refreshing records...");
        const newRecords = await getLeagueRecords(true);
        log("New records received", newRecords);

        leagueData = newRecords;
    }

    let key = $state("regularSeasonData");

    $effect(() => {
        if (!leagueData || !leagueData[key]) {
            log("leagueData or leagueData[key] not ready", { leagueData, key });
            return;
        }

        log(`Loading data for key: ${key}`);
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

        log("Selected league data loaded", selectedLeagueData);
    });

    if (stale) {
        log("Stale flag is true - refreshing transactions");
        refreshTransactions();
    }

    if (leagueData?.stale) {
        log("leagueData marked stale - refreshing records");
        refreshRecords();
    }

    let display = $state("allTime");
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

    /* Button Styling */
    .buttonHolder {
        text-align: center;
        margin: 2em 0 0;
    }

    /* Start button resizing */

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

    /* End button resizing */
</style>

<div class="rankingsWrapper">
{#if logMessages.length}
    <div class="log-output">
        <h4>Debug Logs</h4>
        <pre>{logMessages.join('\n')}</pre>
    </div>
{/if}
    <div class="buttonHolder">
        <Group variant="outlined">
            <Button class="selectionButtons" onclick={() => key = "regularSeasonData"} variant="{key == "regularSeasonData" ? "raised" : "outlined"}">
                <Label>Regular Season</Label>
            </Button>
            <Button class="selectionButtons" onclick={() => key = "playoffData"} variant="{key == "playoffData" ? "raised" : "outlined"}">
                <Label>Playoffs</Label>
            </Button>
        </Group>
        <br />
        <Group variant="outlined">
            <Button class="selectionButtons" onclick={() => display = "allTime"} variant="{display == "allTime" ? "raised" : "outlined"}">
                <Label>All-Time Records</Label>
            </Button>
            <Button class="selectionButtons" onclick={() => display = "season"} variant="{display == "season" ? "raised" : "outlined"}">
                <Label>Season Records</Label>
            </Button>
        </Group>
    </div>

    {#if display == "allTime"}
        {#if leagueWeekHighs?.length}
            <AllTimeRecords transactionTotals={totals} {allTimeClosestMatchups} {allTimeBiggestBlowouts} {leagueManagerRecords} {leagueWeekHighs} {leagueWeekLows} {leagueTeamManagers} {mostSeasonLongPoints} {leastSeasonLongPoints} {key} />
        {:else}
            <p class="empty">No records <i>yet</i>...</p>
        {/if}
    {:else}
        <PerSeasonRecords transactionTotals={totals} {leagueRosterRecords} {seasonWeekRecords} {leagueTeamManagers} {currentYear} {lastYear} {key} />
    {/if}
</div>
