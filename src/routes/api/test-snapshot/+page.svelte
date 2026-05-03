<script>
    import { getLeagueMatchups } from '$lib/utils/helperFunctions/leagueMatchups.js';
    import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/yourFileName.js'; 
    import { getLeagueState } from '$lib/utils/dataEngine/leagueState.js';
    import { matchupsStore, teamManagersStore } from '$lib/stores';
    import { onMount } from 'svelte';

    // Update these to your actual IDs
    const seasons = [
        { year: '2025', id: 'YOUR_2025_ID' },
        { year: '2024', id: 'YOUR_2024_ID' },
        { year: '2023', id: 'YOUR_2023_ID' }
    ];

    let selectedLeagueID = seasons[0].id;
    let loading = false;

    // Reactively run the engine whenever the ID or stores change
    $: engineOutput = ($matchupsStore && $teamManagersStore) 
        ? getLeagueState(selectedLeagueID) 
        : null;

    async function runEngine() {
        loading = true;
        try {
            // Pass the ID to your fetcher
            await Promise.all([
                getLeagueMatchups(selectedLeagueID),
                getLeagueTeamManagers()
            ]);
        } catch (e) {
            console.error("Fetch Error:", e);
        } finally {
            loading = false;
        }
    }

    onMount(runEngine);
</script>

<h1>Engine Validator</h1>

<select bind:value={selectedLeagueID} on:change={runEngine}>
    {#each seasons as season}
        <option value={season.id}>{season.year} ({season.id})</option>
    {/each}
</select>

{#if loading}
    <p>Processing data...</p>
{:else if engineOutput}
    <div class="grid">
        <!-- Section 1: The Raw JSON (The "Brain" check) -->
        <section>
            <h2>Raw Engine Output</h2>
            <pre>{JSON.stringify(engineOutput, null, 2)}</pre>
        </section>

        <!-- Section 2: Visual Spot Check (The "Eyes" check) -->
        <section>
            <h2>Calculated Standings</h2>
            <table>
                <thead>
                    <tr>
                        <th>Roster ID</th>
                        <th>Record</th>
                        <th>PF</th>
                        <th>PA</th>
                    </tr>
                </thead>
                <tbody>
                    {#each Object.entries(engineOutput) as [id, stats]}
                        <tr>
                            <td>{id}</td>
                            <td>{stats.wins || 0}-{stats.losses || 0}</td>
                            <td>{Number(stats.pf || 0).toFixed(2)}</td>
                            <td>{Number(stats.pa || 0).toFixed(2)}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </section>
    </div>
{/if}

<style>
    .grid { display: flex; gap: 2rem; }
    pre { background: #f4f4f4; padding: 1rem; max-height: 500px; overflow: auto; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
</style>
