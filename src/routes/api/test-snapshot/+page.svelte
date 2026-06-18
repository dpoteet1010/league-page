<script>
  import { onMount } from 'svelte';
  import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo.js';
  import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets.js';
  // NOTE: adjust these two import paths to wherever you saved
  // getSpecificYearMatchups / getLeagueState / getLeagueData
  import { getSpecificYearMatchups } from '$lib/utils/helperFunctions/leagueMatchups.js';
  import { getLeagueState } from '$lib/utils/helperFunctions/leagueState.js';
  import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
  import { teamManagersStore } from '$lib/stores';

  let selectedLeagueId = mainLeagueID;
  let loading = false;
  let debugLogs = [];

  let standings = [];
  let weeklyResults = [];
  let podiums = { championId: null, lastPlaceId: null };
  let champManager = null;
  let loserManager = null;

  let showRawJson = false;
  let weekFilter = 'all'; // 'all' | 'regular' | 'playoffs'

  const standardSeasons = [
    { id: mainLeagueID, label: 'Current Season' },
    { id: '2024', label: '2024 Legacy' },
    { id: '2023', label: '2023 Legacy' }
  ];

  // Flattens the nested teamManagersMap into the { rosterId: { name, avatar, managerNames } }
  // shape getLeagueState expects.
  function buildManagersForYear(managersSnapshot, yearString) {
    const activeYearManagers = managersSnapshot?.teamManagersMap?.[yearString] || {};
    const out = {};
    Object.entries(activeYearManagers).forEach(([rosterId, meta]) => {
      const managerNames = (meta?.managers || [])
        .map((mID) => managersSnapshot?.users?.[mID]?.display_name || `User ${mID}`)
        .join(' & ');
      out[rosterId] = {
        name: meta?.team?.name || `Team ${rosterId}`,
        avatar: meta?.team?.avatar || '',
        managerNames
      };
    });
    return out;
  }

  function nameForRoster(rosterId) {
    const found = standings.find((s) => s.rosterId === Number(rosterId));
    return found ? found.name : `Team ${rosterId}`;
  }

  async function loadLeagueState(leagueId) {
    if (!leagueId) return;
    loading = true;
    debugLogs = [];
    standings = [];
    weeklyResults = [];
    champManager = null;
    loserManager = null;

    try {
      const isLegacy = !isNaN(leagueId) && leagueId.toString().length === 4;
      const yearString = isLegacy ? leagueId.toString() : '2025';

      // 1. Pull the three raw inputs in parallel
      const [matchupsData, leagueData, bracketData] = await Promise.all([
        getSpecificYearMatchups(leagueId).catch((err) => {
          debugLogs.push(`getSpecificYearMatchups failed: ${err.message}`);
          return null;
        }),
        getLeagueData(leagueId).catch((err) => {
          debugLogs.push(`getLeagueData failed: ${err.message}`);
          return null;
        }),
        getBrackets(leagueId).catch((err) => {
          debugLogs.push(`getBrackets failed: ${err.message}`);
          return null;
        })
      ]);

      debugLogs.push(`matchupWeeks count: ${matchupsData?.matchupWeeks?.length ?? 'N/A'}`);
      debugLogs.push(`regularSeasonLength: ${matchupsData?.regularSeasonLength ?? 'N/A'}`);

      // 2. Flatten the managers store for this year
      const managersSnapshot = $teamManagersStore || {};
      const managersForYear = buildManagersForYear(managersSnapshot, yearString);
      debugLogs.push(`Managers resolved for ${yearString}: ${Object.keys(managersForYear).length}`);

      if (!matchupsData || !leagueData) {
        debugLogs.push('Missing matchupsData or leagueData — cannot run getLeagueState.');
        return;
      }

      // 3. Run the actual engine
      const result = getLeagueState(matchupsData, managersForYear, leagueData, bracketData);
      standings = result.standings;
      weeklyResults = result.weeklyResults;
      podiums = result.podiums;

      debugLogs.push(`Standings rows: ${standings.length}`);
      debugLogs.push(`Weekly result rows: ${weeklyResults.length}`);
      debugLogs.push(`Podiums -> championId: ${podiums.championId}, lastPlaceId: ${podiums.lastPlaceId}`);

      if (podiums.championId) {
        champManager = { teamName: nameForRoster(podiums.championId), name: managersForYear[podiums.championId]?.managerNames || '—' };
      } else {
        debugLogs.push('No championId resolved — check getBrackets() output shape against determinePlayoffPodiums().');
      }

      if (podiums.lastPlaceId) {
        loserManager = { teamName: nameForRoster(podiums.lastPlaceId), name: managersForYear[podiums.lastPlaceId]?.managerNames || '—' };
      } else {
        debugLogs.push('No lastPlaceId resolved — check getBrackets() output shape against determinePlayoffPodiums().');
      }
    } catch (e) {
      console.error('Critical error building league state:', e);
      debugLogs.push(`Catch block crash: ${e.message}`);
    } finally {
      loading = false;
    }
  }

  $: filteredWeeklyResults = weeklyResults.filter((r) => {
    if (weekFilter === 'regular') return !r.isPlayoffs;
    if (weekFilter === 'playoffs') return r.isPlayoffs;
    return true;
  });

  onMount(() => {
    loadLeagueState(selectedLeagueId);
  });
</script>

<main class="container">
  <h2>League State Validation Panel</h2>

  <div class="control-row">
    <label for="season-select"><strong>Select target season:</strong></label>
    <select id="season-select" bind:value={selectedLeagueId} on:change={() => loadLeagueState(selectedLeagueId)} disabled={loading}>
      {#each standardSeasons as season}
        <option value={season.id}>{season.label}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <div class="status-msg">Crunching matchups...</div>
  {:else}
    <div class="podium-grid">
      <div class="podium-card gold">
        <h3>🏆 League Champion</h3>
        {#if champManager}
          <div class="meta-title">{champManager.teamName}</div>
          <div class="meta-sub">Manager: {champManager.name}</div>
        {:else}
          <div class="meta-empty">Unresolved Champion ID</div>
        {/if}
      </div>

      <div class="podium-card poop">
        <h3>💩 Toilet Bowl Loser</h3>
        {#if loserManager}
          <div class="meta-title">{loserManager.teamName}</div>
          <div class="meta-sub">Manager: {loserManager.name}</div>
        {:else}
          <div class="meta-empty">Unresolved Loser ID</div>
        {/if}
      </div>
    </div>

    <!-- Standings table — cross-check totals against Sleeper's standings tab -->
    <h3>Standings</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Team</th>
          <th colspan="5">Regular Season</th>
          <th colspan="4">Playoffs</th>
        </tr>
        <tr class="subhead">
          <th></th>
          <th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th>
          <th>W</th><th>L</th><th>T</th><th>Streak</th>
        </tr>
      </thead>
      <tbody>
        {#each standings as team}
          <tr>
            <td>{team.name}</td>
            <td>{team.regularSeason.wins}</td>
            <td>{team.regularSeason.losses}</td>
            <td>{team.regularSeason.ties}</td>
            <td>{team.regularSeason.fptsFor.toFixed(2)}</td>
            <td>{team.regularSeason.fptsAgainst.toFixed(2)}</td>
            <td>{team.playoffs.wins}</td>
            <td>{team.playoffs.losses}</td>
            <td>{team.playoffs.ties}</td>
            <td>{team.regularSeason.streak.type ? `${team.regularSeason.streak.type}${team.regularSeason.streak.count}` : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <!-- Weekly engine output — cross-check individual rows against the Sleeper matchup page for that week -->
    <h3>Weekly Results (the engine's raw output)</h3>
    <div class="control-row">
      <label for="week-filter">Filter:</label>
      <select id="week-filter" bind:value={weekFilter}>
        <option value="all">All Weeks</option>
        <option value="regular">Regular Season Only</option>
        <option value="playoffs">Playoffs Only</option>
      </select>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Week</th><th>Team</th><th>Opponent</th><th>PF</th><th>PA</th><th>Result</th><th>Playoffs?</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredWeeklyResults as row}
          <tr>
            <td>{row.week}</td>
            <td>{nameForRoster(row.rosterId)}</td>
            <td>{nameForRoster(row.opponentRosterId)}</td>
            <td>{row.pointsFor.toFixed(2)}</td>
            <td>{row.pointsAgainst.toFixed(2)}</td>
            <td>{row.result}</td>
            <td>{row.isPlayoffs ? 'Yes' : 'No'}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="control-row">
      <button on:click={() => (showRawJson = !showRawJson)}>{showRawJson ? 'Hide' : 'Show'} Raw JSON</button>
    </div>
    {#if showRawJson}
      <pre class="raw-json">{JSON.stringify({ standings, podiums }, null, 2)}</pre>
    {/if}

    {#if debugLogs.length > 0}
      <div class="debug-terminal">
        <h4>System Trace Logs</h4>
        <ul>
          {#each debugLogs as log}
            <li><code>{log}</code></li>
          {/each}
        </ul>
      </div>
    {/if}
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
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  select, button {
    padding: 0.5rem 1rem;
    font-size: 1rem;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  button {
    cursor: pointer;
    background: #f5f5f5;
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
  .podium-card.gold { border-left-color: #ffd700; background: #fffdf3; }
  .podium-card.poop { border-left-color: #8b5a2b; background: #fbf7f3; }
  .podium-card h3 { margin: 0 0 0.5rem 0; font-size: 1.1rem; }
  .meta-title { font-size: 1.4rem; font-weight: 700; color: #222; }
  .meta-sub { font-size: 0.95rem; color: #666; margin-top: 0.25rem; }
  .meta-empty { color: #999; font-style: italic; }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 2rem;
    font-size: 0.9rem;
  }
  .data-table th, .data-table td {
    border: 1px solid #ddd;
    padding: 0.4rem 0.6rem;
    text-align: center;
  }
  .data-table th { background: #f5f5f5; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .subhead th { background: #ececec; font-weight: 600; }

  .raw-json {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.8rem;
    margin-bottom: 2rem;
  }

  .debug-terminal {
    background: #1e1e1e;
    color: #00ff00;
    padding: 1rem;
    border-radius: 6px;
    font-family: monospace;
    margin-top: 1rem;
  }
  .debug-terminal h4 { margin: 0 0 0.5rem 0; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.25rem; }
</style>
