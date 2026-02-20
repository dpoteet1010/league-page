import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from './leagueRosters';
import { getLeagueTeamManagers } from './leagueTeamManagers';
import { getLeagueStandings } from './leagueStandings';
import { getLeagueTransactions } from './leagueTransactions';
import { getAwards } from './awards';
import { getBrackets } from './brackets';
import { getRivalryMatchups } from './rivalries';
import { waitForAll } from './multiPromise';

/**
 * Fetches a full league snapshot including live + legacy data
 * @param {Object} options
 * @param {boolean} options.previewTransactions - Whether to preview only last few transactions
 * @param {boolean} options.refreshTransactions - Force refresh transactions from API
 * @param {Array<[string, string]>} options.rivalries - Array of manager ID pairs to calculate rivalry stats
 */
export const getFullLeagueSnapshot = async ({
    previewTransactions = false,
    refreshTransactions = false,
    rivalries = []
} = {}) => {
    try {
        // 1. Fetch all core data in parallel
        const [rostersData, managersData, standingsData, transactionsData, awardsData, bracketsData] = await waitForAll(
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueStandings(),
            getLeagueTransactions(previewTransactions, refreshTransactions),
            getAwards(),
            getBrackets()
        );

        // 2. Process rivalries if requested
        const rivalryResults = {};
        for (const [userOneID, userTwoID] of rivalries) {
            const rivalry = await getRivalryMatchups(userOneID, userTwoID);
            rivalryResults[`${userOneID}-${userTwoID}`] = rivalry;
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
            rivalries: rivalryResults
        };

        return snapshot;
    } catch (err) {
        console.error('[getFullLeagueSnapshot] Error fetching full league snapshot:', err);
        return null;
    }
};
