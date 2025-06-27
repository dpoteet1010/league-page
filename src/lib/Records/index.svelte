<script>
	import Button, { Group, Label } from '@smui/button';
	import { getLeagueRecords, getLeagueTransactions } from '$lib/utils/helper';
	import AllTimeRecords from './AllTimeRecords.svelte';
	import PerSeasonRecords from './PerSeasonRecords.svelte';

	let {leagueData, totals, stale, leagueTeamManagers} = $props();

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

	const refreshRecords = async () => {
		const newRecords = await getLeagueRecords(true);
		leagueData = newRecords;
	};

	let key = $state("regularSeasonData");
	let display = $state("allTime");

	let debugLog = "";

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

	if (leagueData?.stale) {
		refreshRecords();
	}

	$effect(() => {
		if (leagueWeekHighs === undefined) {
			debugLog = "leagueWeekHighs is undefined.";
		} else if (leagueWeekHighs === null) {
			debugLog = "leagueWeekHighs is null.";
		} else if (Array.isArray(leagueWeekHighs) && leagueWeekHighs.length === 0) {
			debugLog = "leagueWeekHighs is an empty array.";
		} else if (Array.isArray(leagueWeekHighs)) {
			debugLog = `leagueWeekHighs length: ${leagueWeekHighs.length}\n\n${JSON.stringify(leagueWeekHighs.slice(0, 3), null, 2)}`;
		} else {
			debugLog = `leagueWeekHighs is not an array. Type: ${typeof leagueWeekHighs}, Value: ${JSON.stringify(leagueWeekHighs)}`;
		}
	});
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
        <div style="white-space: pre-wrap; background: #111; color: #ccc; padding: 1em; margin: 1em 0; font-size: 0.85em; border: 1px solid #333;">
            <strong>Debug Log:</strong>
            <br>{debugLog}
        </div>
        <p class="empty">No records <i>yet</i>...</p>
    {/if}
{:else}
    <PerSeasonRecords transactionTotals={totals} {leagueRosterRecords} {seasonWeekRecords} {leagueTeamManagers} {currentYear} {lastYear} {key} />
{/if}
</div>
