<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getSpecificYearMatchups } from '$lib/utils/dataEngine/allMatchups.js';
  import { getLeaguePlayoffs } from '$lib/utils/dataEngine/allPlayoffs.js';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
  import { getLeagueState } from '$lib/utils/dataEngine/leagueState.js';
  import { teamManagersStore, leagueData } from '$lib/stores';

  let selectedLeagueID = '';
  let loading = false;
  let debugLogs = [];

  let standings = [];
  let weeklyResults = [];
  let podiums = { championId: null, lastPlaceId: null };
  let rawWinnersBracket = [];
  let rawLosersBracket = [];

  let showRawStandings = false;
  let showRawBrackets = false;
  let weekFilter = 'all'; // 'all' | 'regular' | 'playoffs' | 'winners' | 'losers'

  $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => {
      const matchedLeagueID = Object.keys($leagueData || {}).find((key) => $leagueData[key]?.season == year);
      return { year, id: matchedLeagueID || year };
    });

  $: champTeam = podiums.championId != null ? standings.find((s) => s.rosterId === Number(podiums.championId)) : null;
  $: loserTeam = podiums.lastPlaceId != null ? standings.find((s) => s.rosterId === Number(podiums.lastPlaceId)) : null;
  $: placementsTable = standings.filter((s) => s.finalPlacement != null).sort((a, b) => a.finalPlacement - b.finalPlacement);

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

  async function loadSeasonData(leagueId) {
    if (!leagueId) return;
    loading = true;
    debugLogs = [];
    standings = [];
    weeklyResults = [];
    podiums = { championId: null, lastPlaceId: null };
    rawWinnersBracket = [];
    rawLosersBracket = [];

    try {
      const [matchupsData] = await Promise.all([
        getSpecificYearMatchups(leagueId).catch((err) => {
          debugLogs.push(`getSpecificYearMatchups failed: ${err.message}`);
          return null;
        }),
        getLeagueData(leagueId).catch((err) => {
          debugLogs.push(`getLeagueData note: ${err.message}`);
          return null;
        })
      ]);

      debugLogs.push(`matchupWeeks count: ${matchupsData?.matchupWeeks?.length ?? 'N/A'}`);
      debugLogs.push(`matchupWeeks count: ${matchupsData?.matchupWeeks?.length ?? 'N/A'}`);
      debugLogs.push(...(matchupsData?.debug || []));

      const managersSnapshot = get(teamManagersStore) || {};
      const allMetadata = get(leagueData) || {};
      const year = resolveYear(leagueId, allMetadata);
      debugLogs.push(`Resolved year for manager lookup: ${year}`);

      const managersForYear = buildManagersForYear(managersSnapshot, year);
      const numRosters = Object.keys(managersForYear).length;
      debugLogs.push(`Managers resolved for ${year}: ${numRosters}`);

      if (!matchupsData) {
        debugLogs.push('No matchupsData returned — cannot run getLeagueState.');
        return;
      }

      const playoffData = await getLeaguePlayoffs(leagueId);
      rawWinnersBracket = playoffData.winnersBracket;
      rawLosersBracket = playoffData.losersBracket;
      debugLogs.push(...playoffData.debug);

      const result = getLeagueState(matchupsData, managersForYear, allMetadata?.[leagueId] || null, {
        winnersBracket: playoffData.winnersBracket,
        losersBracket: playoffData.losersBracket,
        numRosters
      });

      standings = result.standings;
      weeklyResults = result.weeklyResults;
      podiums = result.podiums;
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
    if (weekFilter === 'winners') return r.bracket === 'winners';
    if (weekFilter === 'losers') return r.bracket === 'losers';
    return true;
  });

  onMount(async () => {
    loading = true;
    const managers = await getLeagueTeamManagers().catch((err) => {
      debugLogs = [...debugLogs, `getLeagueTeamManagers failed: ${err.message}`];
      return null;
    });

    const years = Object.keys(managers?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
    if (years.length > 0) {
      const firstYear = years[0];
      const allMetadata = get(leagueData) || {};
      const idMatch = Object.keys(allMetadata).find((key) => allMetadata[key]?.season == firstYear);
      selectedLeagueID = idMatch || firstYear;
      await loadSeasonData(selectedLeagueID);
    } else {
      debugLogs = [...debugLogs, 'getLeagueTeamManagers returned no years — teamManagersMap is empty.'];
      loading = false;
    }
  });
</script>

<main class="container">
  <h2>League State Validation Panel</h2>

  {#if seasons.length > 0}
    <div class="control-row">
      <label for="season-select"><strong>Select target season:</strong></label>
      <select id="season-select" bind:value={selectedLeagueID} on:change={() => loadSeasonData(selectedLeagueID)} disabled={loading}>
        {#each seasons as season}
          <option value={season.id}>{season.year}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if loading}
    <div class="status-msg">Crunching matchups...</div>
  {:else}
    <div class="podium-grid">
      <div class="podium-card gold">
        <h3>🏆 League Champion</h3>
        {#if champTeam}
          <div class="meta-title">{champTeam.name}</div>
          <div class="meta-sub">Manager: {champTeam.managerNames || '—'}</div>
        {:else}
          <div class="meta-empty">Unresolved — check logs / raw bracket JSON below</div>
        {/if}
      </div>
      <div class="podium-card poop">
        <h3>💩 Toilet Bowl Loser</h3>
        {#if loserTeam}
          <div class="meta-title">{loserTeam.name}</div>
          <div class="meta-sub">Manager: {loserTeam.managerNames || '—'}</div>
        {:else}
          <div class="meta-empty">Unresolved — check logs / raw bracket JSON below</div>
        {/if}
      </div>
    </div>

    {#if placementsTable.length > 0}
      <h3>Final Playoff Standings (Winners + Losers Bracket)</h3>
      <table class="data-table">
        <thead>
          <tr><th>Place</th><th>Team</th></tr>
        </thead>
        <tbody>
          {#each placementsTable as team}
            <tr>
              <td>{team.finalPlacement}</td>
              <td>{team.name} <span class="manager-tag">({team.managerNames})</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <h3>Standings</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Team</th>
          <th colspan="5">Regular Season</th>
          <th colspan="3">Playoffs (Winners Bracket Only)</th>
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
        <option value="playoffs">All Playoffs</option>
        <option value="winners">Playoffs — Winners Bracket</option>
        <option value="losers">Playoffs — Losers Bracket</option>
      </select>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>Week</th><th>Team</th><th>Opponent</th><th>PF</th><th>PA</th><th>Result</th><th>Bracket</th></tr>
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
            <td>{row.bracket || (row.isPlayoffs ? 'unknown' : '—')}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="control-row">
      <button on:click={() => (showRawStandings = !showRawStandings)}>{showRawStandings ? 'Hide' : 'Show'} Raw Standings JSON</button>
      <button on:click={() => (showRawBrackets = !showRawBrackets)}>{showRawBrackets ? 'Hide' : 'Show'} Raw Bracket JSON</button>
    </div>
    {#if showRawStandings}
      <pre class="raw-json">{JSON.stringify(standings, null, 2)}</pre>
    {/if}
    {#if showRawBrackets}
      <pre class="raw-json">{JSON.stringify({ winnersBracket: rawWinnersBracket, losersBracket: rawLosersBracket }, null, 2)}</pre>
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
  .podium-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
  .podium-card { padding: 1.5rem; border-radius: 8px; border-left: 6px solid #ccc; background: #fcfcfc; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  .podium-card.gold { border-left-color: #ffd700; background: #fffdf3; }
  .podium-card.poop { border-left-color: #8b5a2b; background: #fbf7f3; }
  .podium-card h3 { margin: 0 0 0.5rem 0; font-size: 1.1rem; }
  .meta-title { font-size: 1.4rem; font-weight: 700; color: #222; }
  .meta-sub { font-size: 0.95rem; color: #666; margin-top: 0.25rem; }
  .meta-empty { color: #999; font-style: italic; }
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
