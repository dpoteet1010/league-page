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

    $: engineOutput = ($engineMatchupsStore && $teamManagersStore && $enginePlayoffStore?.year) 
        ? getLeagueState($engineMatchupsStore, $teamManagersStore, $enginePlayoffStore.year) 
        : {};

    $: podium = determinePlayoffPodiums($enginePlayoffStore);
    
    // FIXED: Maps raw roster IDs back to clean display metadata matching your schema format
    $: champMeta = (podium.championId && $enginePlayoffStore?.year && $teamManagersStore?.teamManagersMap?.[$enginePlayoffStore.year])
        ? $teamManagersStore.teamManagersMap[$enginePlayoffStore.year][podium.championId]
        : null;

    $: champManager = champMeta ? {
        teamName: champMeta?.team?.name || `Team ${podium.championId}`,
        name: champMeta?.managers?.map(mID => $teamManagersStore.users?.[mID]?.display_name || "Unknown").join(' & ')
    } : null;

    $: loserMeta = (podium.lastPlaceId && $enginePlayoffStore?.year && $teamManagersStore?.teamManagersMap?.[$enginePlayoffStore.year])
        ? $teamManagersStore.teamManagersMap[$enginePlayoffStore.year][podium.lastPlaceId]
        : null;

    $: loserManager = loserMeta ? {
        teamName: loserMeta?.team?.name || `Team ${podium.lastPlaceId}`,
        name: loserMeta?.managers?.map(mID => $teamManagersStore.users?.[mID]?.display_name || "Unknown").join(' & ')
    } : null;

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
