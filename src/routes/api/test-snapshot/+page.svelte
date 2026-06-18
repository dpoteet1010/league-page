<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo.js';
  import { getSpecificYearMatchups } from '$lib/utils/dataEngine/allMatchups.js';
  import { getLeagueState } from '$lib/utils/dataEngine/getLeagueState.js';
  import { teamManagersStore, leagueData } from '$lib/stores';

  let selectedLeagueId = mainLeagueID;
  let loading = false;
  let debugLogs = [];

  let standings = [];
  let weeklyResults = [];

  let showRawStandings = false;
  let weekFilter = 'all'; // 'all' | 'regular' | 'playoffs'

  const standardSeasons = [
    { id: mainLeagueID, label: 'Current Season' },
    { id: '2024', label: '2024 Legacy' },
    { id: '2023', label: '2023 Legacy' }
  ];

  // Matches the resolution logic from your working getLeagueState:
  // pull the real season from the leagueData store, falling back to the
  // leagueID itself only when it's a legacy 4-digit year.
  function resolveYear(currentLeagueID, allMetadata) {
    let year = allMetadata?.[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) {
      year = currentLeagueID.toString();
    }
    return year;
  }

  function buildManagersForYear(managersSnapshot, year) {
    const yearMap = managersSnapshot?.teamManagersMap?.[year] || {};
    const out = {};
    Object.entries(yearMap).forEach(([rosterId, teamInfo]) => {
      const managerNames = teamInfo?.managers
        ?.map((mID) => managersSnapshot.users?.[mID]?.display_name || 'Unknown')
        .join(' & ') || 'Unknown Manager';
      out[rosterId] = {
        name: teamInfo?.team?.name || `Team ${rosterId}`,
        avatar: teamInfo?.team?.avatar || '',
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

    try {
      const matchupsData = await getSpecificYearMatchups(leagueId).catch((err) => {
        debugLogs.push(`getSpecificYearMatchups failed: ${err.message}`);
        return null;
      });

      debugLogs.push(`matchupWeeks count: ${matchupsData?.matchupWeeks?.length ?? 'N/A'}`);
      debugLogs.push(`regularSeasonLength: ${matchupsData?.regularSeasonLength ?? 'N/A'}`);

      const managersSnapshot = get(teamManagersStore) || {};
      const allMetadata = get(leagueData) || {};
      const year = resolveYear(leagueId, allMetadata);
      debugLogs.push(`Resolved year for manager lookup: ${year}`);

      const managersForYear = buildManagersForYear(managersSnapshot, year);
      debugLogs.push(`Managers resolved for ${year}: ${Object.keys(managersForYear).length}`);

      if (!matchupsData) {
        debugLogs.push('No matchupsData returned — cannot run getLeagueState.');
        return;
      }

      const result = getLeagueState(matchupsData, managersForYear, null);
      standings = result.standings;
      weeklyResults = result.weeklyResults;
      debugLogs.push(...result.debug);
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
    <h3>Standings</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Team</th>
          <th colspan="5">Regular Season</th>
          <th colspan="3">Playoffs</th>
          <th>Streak</th>
        </tr>
        <tr class="subhead">
          <th></th>
          <th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th>
          <th>W</th><th>L</th><th>T</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each standings as team}
          <tr>
            <td>{team.name} <span class="manager-tag">({team.managerNames})</span></td>
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

    <h3>Weekly Results (raw engine output)</h3>
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
      <button on:click={() => (showRawStandings = !showRawStandings)}>{showRawStandings ? 'Hide' : 'Show'} Raw Standings JSON</button>
    </div>
    {#if showRawStandings}
      <pre class="raw-json">{JSON.stringify(standings, null, 2)}</pre>
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
  .container { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  .control-row { margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  select, button { padding: 0.5rem 1rem; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .manager-tag { font-size: 0.8em; color: #888; font-weight: normal; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.9rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: center; }
  .data-table th { background: #f5f5f5; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .subhead th { background: #ececec; font-weight: 600; }
  .raw-json { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; margin-bottom: 1rem; max-height: 400px; }
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; margin-top: 1rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem 0; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.25rem; }
</style>
