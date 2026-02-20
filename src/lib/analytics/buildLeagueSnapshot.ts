import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers';
import { getLeagueStandings } from '$lib/utils/helperFunctions/leagueStandings';
import { getLeagueTransactions } from '$lib/utils/helperFunctions/leagueTransactions';
import { getAwards } from '$lib/utils/helperFunctions/leagueAwards';
import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets';
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise';

/**
 * Fetches a full league snapshot including live + legacy data and all matchups
 */
export const buildLeagueSnapshot = async ({
    previewTransactions = false,
    refreshTransactions = false
} = {}) => {
    try {
        // 1. Fetch core data in parallel
        const [rostersData, managersData, standingsData, transactionsData, awardsData, bracketsData] = await waitForAll(
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueStandings(),
            getLeagueTransactions(previewTransactions, refreshTransactions),
            getAwards(),
            getBrackets()
        );

        const matchupsBySeason = {};

        // 2. Loop through seasons to fetch matchups
        for (const season of Object.keys(managersData.teamManagersMap).sort()) {
            const teamMap = managersData.teamManagersMap[season];
            matchupsBySeason[season] = [];

            // For each roster, fetch weekly matchups
            const weeks = 17; // adjust if playoffs included separately
            for (let week = 1; week <= weeks; week++) {
                const res = await fetch(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${week}?season=${season}`, { compress: true });
                if (!res.ok) continue;
                const weekData = await res.json();

                // Filter matchups for rosters in this league
                const seasonMatchups = weekData.filter(m => m.roster_id in teamMap);
                matchupsBySeason[season].push({ week, matchups: seasonMatchups });
            }
        }

        // 3. Compose final snapshot
        const snapshot = {
            leagueID,
            season: standingsData?.yearData || null,
            rosters: rostersData?.rosters || {},
            startersAndReserve: rostersData?.startersAndReserve || [],
            managers: managersData?.users || {},
            teamManagersMap: managersData?.teamManagersMap || {},
            standings: standingsData?.standingsInfo || {},
            transactions: transactionsData?.transactions || [],
            transactionTotals: transactionsData?.totals || {},
            awards: awardsData || [],
            brackets: bracketsData || {},
            matchups: matchupsBySeason
        };

        return snapshot;
    } catch (err) {
        console.error('[getFullLeagueSnapshot] Error fetching full league snapshot:', err);
        return null;
    }
};
