<script>
  import { onMount } from 'svelte';
  import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo.js'; 
  import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets.js'; 
  import { teamManagersStore } from '$lib/stores';

  let selectedLeagueId = mainLeagueID;
  let champManager = null;
  let loserManager = null;
  let loading = false;
  let debugLogs = [];

  const standardSeasons = [
    { id: mainLeagueID, label: 'Current Season' },
    { id: '2024', label: '2024 Legacy' },
    { id: '2023', label: '2023 Legacy' }
  ];

  // Helper to safely extract names out of your global managers store database
  function resolveTeamAndManagerName(rosterId, targetYear, managersSnapshot) {
    if (!rosterId) return null;
    
    const yearString = targetYear.toString();
    const activeYearManagers = managersSnapshot?.teamManagersMap?.[yearString] || {};
    const rosterMeta = activeYearManagers[rosterId.toString()];

    // Resolve team name
    const teamName = rosterMeta?.team?.name || `Team ${rosterId}`;
    
    // Resolve owner/manager display names
    let managerDisplayNames = "Legacy Manager";
    if (rosterMeta?.managers && managersSnapshot?.users) {
      managerDisplayNames = rosterMeta.managers
        .map(mID => managersSnapshot.users[mID]?.display_name || `User ${mID}`)
        .join(' & ');
    }

    return { teamName, managerDisplayNames };
  }

  async function loadPlayoffOutcomes(leagueId) {
    if (!leagueId) return;
    loading = true;
    champManager = null;
    loserManager = null;
    debugLogs = [];
    
    try {
      // 1. Fetch your bracket structural configuration payload
      const bracketData = await getBrackets(leagueId).catch((err) => {
        debugLogs.push(`Bracket load failed: ${err.message}`);
        return null;
      });

      // 2. Capture the exact state of your static roster mappings
      const managersSnapshot = $teamManagersStore || {};
      
      // Figure out what historical year metadata we are tracking against
      const isLegacy = !isNaN(leagueId) && leagueId.toString().length === 4;
      const targetYear = isLegacy ? leagueId.toString() : "2025"; 

      if (!bracketData) {
        debugLogs.push(`No bracket data returned from getBrackets for ID: ${leagueId}`);
        return;
      }

      debugLogs.push(`Champ Bracket Data Keys: ${Object.keys(bracketData.champBracket || {})}`);
      debugLogs.push(`Loser Bracket Data Keys: ${Object.keys(bracketData.loserBracket || {})}`);

      // 3. Directly target the final championship round out of your bracket structures
      const championId = bracketData.champBracket?.champion || bracketData.champion;
      const lastPlaceId = bracketData.loserBracket?.lastPlace || bracketData.loser || bracketData.toiletBowlLoser;

      // 4. Resolve the roster identity profiles if the IDs were located
      if (championId) {
        const resolvedChamp = resolveTeamAndManagerName(championId, targetYear, managersSnapshot);
        if (resolvedChamp) {
          champManager = {
            teamName: resolvedChamp.teamName,
            name: resolvedChamp.managerDisplayNames
          };
        }
      } else {
        debugLogs.push("Could not find a valid champion roster ID inside the returned bracket object.");
      }

      if (lastPlaceId) {
        const resolvedLoser = resolveTeamAndManagerName(lastPlaceId, targetYear, managersSnapshot);
        if (resolvedLoser) {
          loserManager = {
            teamName: resolvedLoser.teamName,
            name: resolvedLoser.managerDisplayNames
          };
        }
      } else {
        debugLogs.push("Could not find a valid lastPlace/loser roster ID inside the returned bracket object.");
      }

    } catch (e) {
      console.error("Critical error extracting playoff layout records:", e);
      debugLogs.push(`Catch block crash: ${e.message}`);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadPlayoffOutcomes(selectedLeagueId);
  });
</script>

<main class="container">
  <h2>Playoff Bracket Diagnostics Panel</h2>

  <div class="control-row">
    <label for="season-select"><strong>Select target season layout:</strong></label>
    <select id="season-select" bind:value={selectedLeagueId} on:change={() => loadPlayoffOutcomes(selectedLeagueId)} disabled={loading}>
      {#each standardSeasons as season}
        <option value={season.id}>{season.label}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <div class="status-msg">Analyzing playoff bracket structural nodes...</div>
  {:else}
    <div class="podium-grid">
      <!-- Champion Display Panel -->
      <div class="podium-card gold">
        <h3>🏆 League Champion</h3>
        {#if champManager}
          <div class="meta-title">{champManager.teamName}</div>
          <div class="meta-sub">Manager: {champManager.name}</div>
        {:else}
          <div class="meta-empty">Unresolved Champion ID or details missing</div>
        {/if}
      </div>

      <!-- Toilet Bowl Loser Panel -->
      <div class="podium-card poop">
        <h3>💩 Toilet Bowl Loser</h3>
        {#if loserManager}
          <div class="meta-title">{loserManager.teamName}</div>
          <div class="meta-sub">Manager: {loserManager.name}</div>
        {:else}
          <div class="meta-empty">Unresolved Loser ID or details missing</div>
        {/if}
      </div>
    </div>

    <!-- Diagnostic Log Dump Terminal to see exactly what properties getBrackets outputs -->
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
    max-width: 800px;
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
  .debug-terminal {
    background: #1e1e1e;
    color: #00ff00;
    padding: 1rem;
    border-radius: 6px;
    font-family: monospace;
    margin-top: 2rem;
  }
  .debug-terminal h4 {
    margin: 0 0 0.5rem 0;
    color: #fff;
  }
  .debug-terminal ul {
    margin: 0;
    padding-left: 1.2rem;
  }
  .debug-terminal li {
    margin-bottom: 0.25rem;
  }
</style>
