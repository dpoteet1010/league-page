<script>
    // 1. FIXED: Import your isolated fetcher instead of the live site's fetcher
    import { getSpecificYearMatchups } from '$lib/utils/helperFunctions/allMatchups.js';
    import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js'; 
    import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
    import { getLeagueState } from '$lib/utils/dataEngine/leagueState.js';
    
    // 2. FIXED: Swap matchupsStore out for engineMatchupsStore
    import { engineMatchupsStore, teamManagersStore, leagueData } from '$lib/stores';
    import { onMount } from 'svelte';

    let selectedLeagueID = "";
    let loading = false;

    // Build the dropdown list dynamically from the teamManagersStore
    $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
        .sort((a, b) => Number(b) - Number(a))
        .map(year => {
            // Find the long League ID in the leagueData cache that matches this year
            const id = Object.keys($leagueData || {}).find(key => $leagueData[key]?.season == year);
            return { year, id: id || year }; 
        });

    // Reactive: Trigger the engine when the ID or stores change
    // 3. FIXED: Listen to $engineMatchupsStore here instead of the live store
    $: engineOutput = (selectedLeagueID && $engineMatchupsStore && $teamManagersStore) 
        ? getLeagueState(selectedLeagueID) 
        : null;

    async function loadSeasonData() {
        if (!selectedLeagueID) return;
        loading = true;
        try {
            await Promise.all([
                getLeagueData(selectedLeagueID),
                getSpecificYearMatchups(selectedLeagueID) // 4. FIXED: Use the sandbox fetcher
            ]);
        } catch (e) {
            console.error("Error loading season:", e);
        } finally {
            loading = false;
        }
    }

    onMount(async () => {
        loading = true;
        // 1. Load the manager map first so we know what seasons exist
        const managers = await getLeagueTeamManagers();
        
        // 2. Determine the initial ID to show
        const years = Object.keys(managers?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
        if (years.length > 0) {
            const firstYear = years[0];
            // Check if we already have a real ID cached for this year
            const idMatch = Object.keys($leagueData || {}).find(key => $leagueData[key].season == firstYear);
            selectedLeagueID = idMatch || firstYear;
            
            // 3. Fetch the actual matchups for this season
            await loadSeasonData();
        }
        loading = false;
    });
</script>

<div class="container">
    <h1>Engine Validator</h1>

    {#if seasons.length > 0}
        <div class="controls">
            <label for="season-select">Select Season:</label>
            <select id="season-select" bind:value={selectedLeagueID} on:change={loadSeasonData}>
                {#each seasons as season}
                    <option value={season.id}>{season.year}</option>
                {/each}
            </select>
        </div>
    {/if}

    {#if loading}
        <div class="status">Loading season data...</div>
    {:else if engineOutput}
        <div class="grid">
            <section>
                <h2>Standings Output</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Manager / Team</th>
                            <th>Record</th>
                            <th>PF</th>
                            <th>PA</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each Object.entries(engineOutput) as [id, stats]}
                            <tr>
                                <td>
                                    <strong>{stats.team}</strong><br/>
                                    <small>{stats.manager}</small>
                                </td>
                                <td>{stats.wins}-{stats.losses}</td>
                                <td>{Number(stats.pf || 0).toFixed(2)}</td>
                                <td>{Number(stats.pa || 0).toFixed(2)}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </section>

            <section>
                <h2>Raw JSON</h2>
                <pre>{JSON.stringify(engineOutput, null, 2)}</pre>
            </section>
        </div>
    {:else}
        <div class="status">No data found. Select a season to begin.</div>
    {/if}
</div>

<style>
    .container { padding: 2rem; font-family: sans-serif; }
    .controls { margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
    .status { padding: 2rem; background: #eee; text-align: center; border-radius: 8px; }
    pre { background: #1e1e1e; color: #dcdcdc; padding: 1rem; border-radius: 8px; max-height: 600px; overflow: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f8f8f8; }
    small { color: #666; }
</style>
