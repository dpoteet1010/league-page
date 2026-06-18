<script>
  import { onMount, tick } from 'svelte';
  import { leagueID } from '$lib/utils/leagueInfo.js';
  import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
  import { getSpecificYearMatchups } from '$lib/utils/dataEngine/allMatchups.js';
  import { getSpecificYearPlayoffs } from '$lib/utils/dataEngine/allPlayoffs.js';
  import { getLeagueState } from '$lib/utils/dataEngine/leagueState.js';
  import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets.js'; 
  import { leagueData, teamManagersStore, engineMatchupsStore } from '$lib/stores';

  let selectedLeagueId = leagueID;
  let verifiedStandings = [];
  let champManager = null;
  let loserManager = null;
  let loading = false;

  const standardSeasons = [
    { id: '1125925345759711232', label: '2025 Season' },
    { id: '2024', label: '2024 Legacy' },
    { id: '2023', label: '2023 Legacy' }
  ];

  async function loadSeasonData(leagueId) {
    if (!leagueId) return;
    loading = true;
    verifiedStandings = [];
    champManager = null;
    loserManager = null;
    
    try {
      // 1. Concurrently execute data pipeline hydrations
      await Promise.all([
        getLeagueData(leagueId),
        getSpecificYearMatchups(leagueId),
        getSpecificYearPlayoffs(leagueId),
        getBrackets(leagueId)
      ]);

      await tick();

      // 2. Safely capture absolute data snapshots directly out of core application stores
      const managersSnapshot = $teamManagersStore;
      const globalDataSnapshot = $leagueData;
      const activeLeagueMetadata = globalDataSnapshot[leagueId] || globalDataSnapshot;
      
      // Target the structured array output from your engineMatchupsStore layout
      const matchupsSnapshot = $engineMatchupsStore?.matchupWeeks || [];
      
      // Pull processed data directly from your UI's evaluated layout parser
      const finalBracketsSnapshot = await getBrackets(leagueId);

      // 3. Process complete layout datasets 
      const engineOutput = getLeagueState(
        matchupsSnapshot, 
        managersSnapshot, 
        activeLeagueMetadata, 
        finalBracketsSnapshot
      );

      // 4. Bind compiled standings array cleanly
      verifiedStandings = engineOutput.standings || [];
      
      const podium = engineOutput.podiums || { championId: null, lastPlaceId: null };
      const activeSeasonYear = activeLeagueMetadata?.season || (leagueId === '2023' || leagueId === '2024' ? leagueId : "2025");
      const activeYearManagers = managersSnapshot?.teamManagersMap?.[activeSeasonYear] || {};

      // 5. Parse Champion metadata identities
      if (podium.championId) {
        const champMeta = activeYearManagers[podium.championId];
        champManager = {
          teamName: champMeta?.team?.name || `Team ${podium.championId}`,
          name: champMeta?.managers?.map(mID => managersSnapshot.users?.[mID]?.display_name || "Unknown").join(' & ') || "Unknown Manager"
        };
      }

      // 6. Parse Bottom Toilet Bowl/Consolation Loser identities
      if (podium.lastPlaceId) {
        const loserMeta = activeYearManagers[podium.lastPlaceId];
        loserManager = {
          teamName: loserMeta?.team?.name || `Team ${podium.lastPlaceId}`,
          name: loserMeta?.managers?.map(mID => managersSnapshot.users?.[mID]?.display_name || "Unknown").join(' & ') || "Unknown Manager"
        };
      }

    } catch (e) {
      console.error("Error evaluating season diagnostic snapshot metrics:", e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadSeasonData(selectedLeagueId);
  });
</script>

<main class="container">
  <h2>League State Diagnostics Panel</h2>

  <div class="control-row">
    <label for="season-select"><strong>Select target season layout:</strong></label>
    <select id="season-select" bind:value={selectedLeagueId} on:change={() => loadSeasonData(selectedLeagueId)} disabled={loading}>
      {#each standardSeasons as season}
        <option value={season.id}>{season.label}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <div class="status-msg">Processing historical layout timelines...</div>
  {:else}
    <div class="podium-grid">
      <div class="podium-card gold">
        <h3>🏆 League Champion</h3>
        {#if champManager}
          <div class="meta-title">{champManager.teamName}</div>
          <div class="meta-sub">Manager: {champManager.name}</div>
        {:else}
          <div class="meta-empty">Playoffs ongoing or data unresolved</div>
        {/if}
      </div>

      <div class="podium-card poop">
        <h3>💩 Toilet Bowl Loser</h3>
        {#if loserManager}
          <div class="meta-title">{loserManager.teamName}</div>
          <div class="meta-sub">Manager: {loserManager.name}</div>
        {:else}
          <div class="meta-empty">Playoffs ongoing or data unresolved</div>
        {/if}
      </div>
    </div>

    <div class="table-wrapper">
      <h3>Regular Season Standings</h3>
      <table>
        <thead>
          <tr>
            <th>Team Name / Manager</th>
            <th>Record</th>
            <th>Points For (PF)</th>
            <th>Points Against (PA)</th>
          </tr>
        </thead>
        <tbody>
          {#each verifiedStandings as stats}
            <tr>
              <td>
                <div class="td-team">{stats.name}</div>
              </td>
              <td class="td-record">{stats.wins} - {stats.losses}{#if stats.ties > 0} - {stats.ties}{/if}</td>
              <td>{Number(stats.fptsFor || 0).toFixed(2)}</td>
              <td>{Number(stats.fptsAgainst || 0).toFixed(2)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="4" class="no-data">No data found for this season context.</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</main>

<style>
  .container {
    max-width: 1000px;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .control-row {
    margin-bottom: 2rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  select {
    padding: 0.5rem 1rem;
    font-size: 1rem;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  .status-msg {
    padding: 2rem;
    background: #f0f0f0;
    border-radius: 8px;
    text-align: center;
    font-style: italic;
  }
  .podium-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }
  .podium-card {
    padding: 1.5rem;
    border-radius: 8px;
    border-left: 6px solid #ccc;
    background: #fcfcfc;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  }
  .podium-card.gold {
    border-left-color: #ffd700;
    background: #fffdf3;
  }
  .podium-card.poop {
    border-left-color: #8b5a2b;
    background: #fbf7f3;
  }
  .podium-card h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
  }
  .meta-title {
    font-size: 1.4rem;
    font-weight: 700;
    color: #222;
  }
  .meta-sub {
    font-size: 0.95rem;
    color: #666;
    margin-top: 0.25rem;
  }
  .meta-empty {
    color: #999;
    font-style: italic;
  }
  .table-wrapper {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.02);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
    text-align: left;
  }
  th, td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #eee;
  }
  th {
    background: #f8f9fa;
    font-weight: 600;
    color: #444;
  }
  .td-team {
    font-weight: 600;
    color: #111;
  }
  .td-record {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .no-data {
    text-align: center;
    color: #999;
    padding: 3rem 0;
  }
</style>
