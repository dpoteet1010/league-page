<script>
    import { getLeagueMatchups } from '$lib/utils/helperFunctions/leagueMatchups.js';
    import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/teamManagers.js'; 
    import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
    import { getLeagueState } from '$lib/utils/dataEngine/leagueState.js';
    import { matchupsStore, teamManagersStore, leagueData } from '$lib/stores';
    import { onMount } from 'svelte';

    let selectedLeagueID = ""; // Start empty
    let loading = false;

    // 1. Automatically build the seasons list from the store
    // This creates an array of {year, id} by looking at the processed data
    $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
        .sort((a, b) => b - a) // Most recent first
        .map(year => {
            // We find the ID by looking at your leagueData cache for that year
            const id = Object.keys($leagueData).find(key => $leagueData[key].season == year);
            return { year, id: id || year }; 
        });

    // 2. Set the default selection once the store loads
    $: if (seasons.length > 0 && !selectedLeagueID) {
        selectedLeagueID = seasons[0].id;
    }

    // 3. Reactive calculation
    $: engineOutput = ($matchupsStore && $teamManagersStore && selectedLeagueID) 
        ? getLeagueState(selectedLeagueID) 
        : null;

    async function runEngine() {
        loading = true;
        try {
            // We load the manager map first to populate our dropdown options
            await getLeagueTeamManagers();
            // Then fetch the specific matchup data for the current selection
            if (selectedLeagueID) {
                await Promise.all([
                    getLeagueData(selectedLeagueID),
                    getLeagueMatchups(selectedLeagueID)
                ]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            loading = false;
        }
    }

    onMount(runEngine);
</script>

<h1>Engine Validator</h1>

{#if seasons.length > 0}
    <select bind:value={selectedLeagueID} on:change={runEngine}>
        {#each seasons as season}
            <option value={season.id}>{season.year}</option>
        {/each}
    </select>
{/if}

<style>
    .grid { display: flex; gap: 2rem; }
    pre { background: #f4f4f4; padding: 1rem; max-height: 500px; overflow: auto; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
</style>
