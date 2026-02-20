import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers';
import { getLeagueStandings } from '$lib/utils/helperFunctions/leagueStandings';
import { getLeagueTransactions } from '$lib/utils/helperFunctions/leagueTransactions';
import { getAwards } from '$lib/utils/helperFunctions/leagueAwards';
import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets';
import { getRivalryMatchups } from '$lib/utils/helperFunctions/rivalryMatchups';
import { getNflState } from '$lib/utils/helperFunctions/nflState';
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise';

/**
 * Fetches a full league snapshot including live + legacy data, now with matchups
 */
export const buildLeagueSnapshot = async ({
    previewTransactions = false,
    refreshTransactions = false,
    rivalries = []
} = {}) => {
    try {
        // 1. Fetch all core data in parallel
        const [rostersData, managersData, standingsData, transactionsData, awardsData, bracketsData, nflState] = await waitForAll(
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueStandings(),
            getLeagueTransactions(previewTransactions, refreshTransactions),
            getAwards(),
            getBrackets(),
            getNflState()
        );

        // 2. Fetch weekly matchups for the current season
        const currentWeek = nflState?.season_type === 'regular' ? nflState.display_week : 18;
        const matchupsPromises = [];
        for (let week = 1; week <= currentWeek; week++) {
            matchupsPromises.push(
                fetch(`https://api.sleeper.app/v1/league/${leagueID}/matchups/${week}`, { compress: true })
            );
        }
        const matchupsRes = await waitForAll(...matchupsPromises);
        const matchupsJsonPromises = matchupsRes.map(res => res.json());
        const matchupsData = await waitForAll(...matchupsJsonPromises);

        // Map matchups by week for easy lookup
        const matchupsByWeek: Record<number, any[]> = {};
        matchupsData.forEach((weekData, index) => {
            matchupsByWeek[index + 1] = weekData;
        });

        // 3. Process rivalries if requested
        const rivalryResults: Record<string, any> = {};
        for (const [userOneID, userTwoID] of rivalries) {
            const rivalry = await getRivalryMatchups(userOneID, userTwoID);
            rivalryResults[`${userOneID}-${userTwoID}`] = rivalry;
        }

        // 4. Compose final snapshot
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
            matchups: matchupsByWeek, // <-- NEW: full weekly matchups
            rivalries: rivalryResults
        };

        return snapshot;
    } catch (err) {
        console.error('[getFullLeagueSnapshot] Error fetching full league snapshot:', err);
        return null;
    }
};
