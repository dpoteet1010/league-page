<script>
    import { getSpecificYearMatchups } from '$lib/utils/dataEngine/allMatchups.js';
    import { getSpecificYearPlayoffs } from '$lib/utils/dataEngine/allPlayoffs.js';
    import { determinePlayoffPodiums, getLeagueState } from '$lib/utils/dataEngine/leagueState.js'; 
    
    import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js'; 
    import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
    import { onMount } from 'svelte';

    import { engineMatchupsStore, enginePlayoffStore, teamManagersStore, leagueData } from '$lib/stores';

    let selectedLeagueID = "";
    let loading = false;

    $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
        .sort((a, b) => Number(b) - Number(a))
        .map(year => {
            const id = Object.keys($leagueData || {}).find(key => $leagueData[key]?.season == year);
            return { year, id: id || year }; 
        });

    // FIX: Pass stores as reactive parameters so this recomputes dynamically
    $: engineOutput = ($engineMatchupsStore && $teamManagersStore && $enginePlayoffStore?.year) 
        ? getLeagueState($engineMatchupsStore, $teamManagersStore, $enginePlayoffStore.year) 
        : {};

    $: podium = determinePlayoffPodiums($enginePlayoffStore);
    
    $: champManager = (podium.championId && $enginePlayoffStore?.year && $teamManagersStore?.teamManagersMap?.[$enginePlayoffStore.year])
        ? $teamManagersStore.teamManagersMap[$enginePlayoffStore.year][podium.championId]
        : null;

    $: loserManager = (podium.lastPlaceId && $enginePlayoffStore?.year && $teamManagersStore?.teamManagersMap?.[$enginePlayoffStore.year])
        ? $teamManagersStore.teamManagersMap[$enginePlayoffStore.year][podium.lastPlaceId]
        : null;

    async function loadSeasonData() {
        if (!selectedLeagueID) return;
        loading = true;
        try {
            await Promise.all([
                getLeagueData(selectedLeagueID),
                getSpecificYearMatchups(selectedLeagueID),
                getSpecificYearPlayoffs(selectedLeagueID)
            ]);
        } catch (e) {
            console.error("Error loading season data:", e);
        } finally {
            loading = false;
        }
    }

    onMount(async () => {
        loading = true;
        const managers = await getLeagueTeamManagers();
        const years = Object.keys(managers?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
        if (years.length > 0) {
            const firstYear = years[0];
            const idMatch = Object.keys($leagueData || {}).find(key => $leagueData[key].season == firstYear);
            selectedLeagueID = idMatch || firstYear;
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
    {:else if Object.keys(engineOutput).length > 0 || $enginePlayoffStore?.champs}
        
        <div class="podium-banner">
            <div class="card champion-card">
                <h3>🏆 League Champion</h3>
                {#if champManager}
                    <p class="team-name">{champManager.teamName}</p>
                    <p class="manager-name">Owner: {champManager.name}</p>
                {:else}
                    <p class="tbd">Playoffs ongoing or data unresolved</p>
                {/if}
            </div>

            <div class="card loser-card">
                <h3>💩 Toilet Bowl Loser</h3>
                {#if loserManager}
                    <p class="team-name">{loserManager.teamName}</p>
                    <p class="manager-name">Owner: {loserManager.name}</p>
                {:else}
                    <p class="tbd">Playoffs ongoing or data unresolved</p>
                {/if}
            </div>
        </div>

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
                <h2>Raw Playoff Bracket JSON</h2>
                <pre>{JSON.stringify($enginePlayoffStore, null, 2)}</pre>
            </section>
        </div>
    {:else}
        <div class="status">No data found. Select a season to begin.</div>
    {/if}
</div>

<style>
    .container { padding: 2rem; font-family: sans-serif; }
    .controls { margin-bottom: 2rem; }
    .podium-banner { 
        display: grid; 
        grid-template-columns: 1fr 1fr; 
        gap: 1.5rem; 
        margin-bottom: 2.5rem; 
    }
    .card { 
        padding: 1.5rem; 
        border-radius: 8px; 
        border: 1px solid #ddd;
    }
    .champion-card { 
        background: #f0fff4; 
        border-color: #c6f6d5; 
        color: #22543d;
    }
    .loser-card { 
        background: #fff5f5; 
        border-color: #fed7d7; 
        color: #742a2a;
    }
    .card h3 { margin: 0 0 0.5rem 0; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .team-name { font-size: 1.6rem; font-weight: bold; margin: 0 0 0.25rem 0; }
    .manager-name { font-size: 0.95rem; margin: 0; opacity: 0.85; }
    .tbd { font-style: italic; opacity: 0.7; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
    .status { padding: 2rem; background: #eee; text-align: center; border-radius: 8px; }
    pre { background: #1e1e1e; color: #dcdcdc; padding: 1rem; border-radius: 8px; max-height: 600px; overflow: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f8f8f8; }
    small { color: #666; }
</style>
