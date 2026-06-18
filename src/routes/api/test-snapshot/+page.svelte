<script>
  import { onMount } from 'svelte';
  import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo.js';
  import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets.js';
  import { getSpecificYearMatchups } from '$lib/utils/helperFunctions/leagueMatchups.js'; // adjust path if needed
  import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
  import { getLeagueState } from '$lib/utils/helperFunctions/getLeagueState.js'; // adjust path if needed
  import { teamManagersStore } from '$lib/stores';

  let selectedLeagueId = mainLeagueID;
  let loading = false;
  let debugLogs = [];

  let standings = [];
  let weeklyResults = [];
  let podiums = { championId: null, lastPlaceId: null };
  let rawBracketData = null;

  let showRawBracket = false;
  let showRawStandings = false;
  let weekFilter = 'all'; // 'all' | 'regular' | 'playoffs'

  const standardSeasons = [
    { id: mainLeagueID, label: 'Current Season' },
    { id: '2024', label: '2024 Legacy' },
    { id: '2023', label: '2023 Legacy' }
  ];

  // Flattens the nested teamManagersMap (per-year) into the flat
  // { rosterId: { name, avatar, managerNames } } shape getLeagueState expects.
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
