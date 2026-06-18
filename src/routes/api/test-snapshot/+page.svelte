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

  // Build out the list of available seasons from the managers store
  $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
    .sort((a, b) => Number(b) - Number(a))
    .map(year => {
      const id = Object.keys($leagueData || {}).find(key => $leagueData[key]?.season == year);
      return { year, id: id || year }; 
    });

  // Identify the active target year based on the current user selection
  $: targetYear = Object.values($leagueData || {}).find(l => l.status === "active" || l.league_id === selectedLeagueID)?.season 
    || $enginePlayoffStore?.year 
    || "2025";

  // Explicitly tie league calculation outputs to selectedLeagueID state updates
  $: engineOutput = (selectedLeagueID && $engineMatchupsStore && $teamManagersStore) 
    ? getLeagueState($engineMatchupsStore, $teamManagersStore, targetYear) 
    : {};

  $: podium = determinePlayoffPodiums($enginePlayoffStore);
  
  // Map podium rosters back to clean team metadata structures
  $: champMeta = (podium.championId && targetYear && $teamManagersStore?.teamManagersMap?.[targetYear])
    ? $teamManagersStore.teamManagersMap[targetYear][podium.championId]
    : null;

  $: champManager = champMeta ? {
    teamName: champMeta?.team?.name || `Team ${podium.championId}`,
    name: champMeta?.managers?.map(mID => $teamManagersStore.users?.[mID]?.display_name || "Unknown").join(' & ')
  } : null;

  $: loserMeta = (podium.lastPlaceId && targetYear && $teamManagersStore?.teamManagersMap?.[targetYear])
    ? $teamManagersStore.teamManagersMap[targetYear][podium.lastPlaceId]
    : null;

  $: loserManager = loserMeta ? {
    teamName: loserMeta?.team?.name || `Team ${podium.lastPlaceId}`,
    name: loserMeta?.managers?.map(mID => $teamManagersStore.users?.[mID]?.display_name || "Unknown").join(' & ')
  } : null;

  // Data pipeline loader engine
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

  // Reactively run loader engine whenever user updates the dropdown select selection
  $: if (selectedLeagueID) {
    loadSeasonData();
  }

  onMount(async () => {
    loading = true;
    // Fetch baseline team manager contexts first
    const managers = await getLeagueTeamManagers();
    const years = Object.keys(managers?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
    
    if (years.length > 0) {
      const newestYear = years[0];
      
      // Hydrate the league config database mapping to resolve real IDs before choosing default
      const fallbackData = await getLeagueData(); 
      const currentLeagueMap = fallbackData || $leagueData || {};
      
      const idMatch = Object.keys(currentLeagueMap).find(key => currentLeagueMap[key]?.season == newestYear);
      selectedLeagueID = idMatch || newestYear;
    }
    loading = false;
  });
</script>

{#if loading}
  <p>Loading season snapshot parameters...</p>
{:else}
  <div>
    <label for="season-select">Select Season:</label>
    <select id="season-select" bind:value={selectedLeagueID}>
      {#each seasons as season}
        <option value={season.id}>{season.year}</option>
      {/each}
    </select>

    {#if champManager}
      <p><strong>Champion:</strong> {champManager.teamName} ({champManager.name})</p>
    {/if}
    {#if loserManager}
      <p><strong>Last Place:</strong> {loserManager.teamName} ({loserManager.name})</p>
    {/if}
  </div>
{/if}
