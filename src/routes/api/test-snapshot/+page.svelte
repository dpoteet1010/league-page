<script>
  import { getSpecificYearMatchups } from '$lib/utils/dataEngine/allMatchups.js';
  import { getSpecificYearPlayoffs } from '$lib/utils/dataEngine/allPlayoffs.js';
  import { determinePlayoffPodiums, getLeagueState } from '$lib/utils/dataEngine/leagueState.js'; 
  
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js'; 
  import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
  import { onMount, tick } from 'svelte';

  import { engineMatchupsStore, enginePlayoffStore, teamManagersStore, leagueData } from '$lib/stores';

  let selectedLeagueID = "";
  let loading = false;

  // Local state cache to protect the UI from global store mutation drift
  let verifiedStandings = {};
  let champManager = null;
  let loserManager = null;

  // Map seasons dynamically from the league data cache
  $: seasons = Object.values($leagueData || {})
    .filter(league => league && league.season)
    .sort((a, b) => Number(b.season) - Number(a.season))
    .map(league => ({
      year: league.season,
      id: league.league_id || league.id
    }));

  async function loadSeasonData(leagueId) {
    if (!leagueId) return;
    loading = true;
    
    try {
      // 1. Await all required datasets concurrently
      await Promise.all([
        getLeagueData(leagueId),
        getSpecificYearMatchups(leagueId),
        getSpecificYearPlayoffs(leagueId)
      ]);

      // 2. Wait one tick to guarantee Svelte stores have written their updates
      await tick();

      // 3. Capture snapshots of the stores right now
      const matchupsSnapshot = $engineMatchupsStore;
      const managersSnapshot = $teamManagersStore;
      const playoffSnapshot = $enginePlayoffStore;

      // 4. Resolve the targeted season year from our current league target
      const activeSeasonYear = $leagueData[leagueId]?.season || playoffSnapshot?.year || "2025";

      // 5. Calculate standings using isolated snapshot data
      verifiedStandings = getLeagueState(matchupsSnapshot, managersSnapshot, activeSeasonYear);

      // 6. Calculate playoffs podiums using isolated snapshot data
      const podium = determinePlayoffPodiums(playoffSnapshot);
      const activeYearManagers = managersSnapshot?.teamManagersMap?.[activeSeasonYear] || {};

      const champMeta = podium.championId ? activeYearManagers[podium.championId] : null;
      champManager = champMeta ? {
        teamName: champMeta?.team?.name || `Team ${podium.championId}`,
        name: champMeta?.managers?.map(mID => managersSnapshot.users?.[mID]?.display_name || "Unknown").join(' & ')
      } : null;

      const loserMeta = podium.lastPlaceId ? activeYearManagers[podium.lastPlaceId] : null;
      loserManager = loserMeta ? {
        teamName: loserMeta?.team?.name || `Team ${podium.lastPlaceId}`,
        name: loserMeta?.managers?.map(mID => managersSnapshot.users?.[mID]?.display_name || "Unknown").join(' & ')
      } : null;

    } catch (e) {
      console.error("Error synchronizing season snapshot parameters:", e);
    } finally {
      loading = false;
    }
  }

  function handleSeasonChange(event) {
    selectedLeagueID = event.target.value;
    loadSeasonData(selectedLeagueID);
  }

  onMount(async () => {
    loading = true;
    
    // Warm up core metadata contexts
    await Promise.all([
      getLeagueTeamManagers(),
      getLeagueData()
    ]);

    const availableYears = Object.keys($teamManagersStore?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
    
    if (availableYears.length > 0) {
      const newestYear = availableYears[0];
      const idMatch = Object.keys($leagueData || {}).find(key => $leagueData[key]?.season == newestYear);
      
      selectedLeagueID = idMatch || newestYear;
      await loadSeasonData(selectedLeagueID);
    }
    loading = false;
  });
</script>

<div class="container">
  <h1>Engine Validator</h1>

  {#if seasons.length > 0}
    <div class="controls">
      <label for="season-select">Select Season:</label>
      <select id="season-select" value={selectedLeagueID} on:change={handleSeasonChange}>
        {#each seasons as season}
          <option value={season.id}>{season.year}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if loading}
    <div class="status">Loading data cleanly, avoiding store drift...</div>
  {:else}
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
            {#each Object.entries(verifiedStandings) as [id, stats]}
              <tr>
                <td>
                  <strong>{stats.team}</strong><br/>
                  <small>{stats.manager}</small>
                </td>
                <td>{stats.wins}-{stats.losses}{#if stats.ties > 0}-{stats.ties}{/if}</td>
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
