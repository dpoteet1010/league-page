<!-- src/routes/test-engine/+page.svelte -->
<script>
    import { getLeagueMatchups } from '$lib/utils/helperFunctions/leagueMatchups.js'; // Your existing fetcher
    import { getLeagueState } from '$lib/utils/dataEngine/leagueState';
    import { onMount } from 'svelte';

    let selectedYear = "2025";
    let engineOutput = null;
    let loading = false;

    async function runEngine() {
        loading = true;
        // 1. Get the raw matchup data (handles Sleeper or Legacy automatically)
        const data = await getLeagueMatchups(selectedYear); 
        // 2. Run your new Analysis Engine
        engineOutput = getLeagueState(data.matchupWeeks);
        loading = false;
    }

    onMount(runEngine);
</script>

<h1>Engine Validator</h1>

<select bind:value={selectedYear} on:change={runEngine}>
    <option value="2023">2023 (Legacy)</option>
    <option value="2024">2024 (Legacy)</option>
    <option value="2025">2025 (Sleeper)</option>
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
                            <td>{stats.wins}-{stats.losses}</td>
                            <td>{stats.pf.toFixed(2)}</td>
                            <td>{stats.pa.toFixed(2)}</td>
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
