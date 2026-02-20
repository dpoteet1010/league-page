import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers';
import { getLeagueTransactions } from '$lib/utils/helperFunctions/leagueTransactions';
import { getAwards } from '$lib/utils/helperFunctions/leagueAwards';
import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets';
import { getRivalryMatchups } from '$lib/utils/helperFunctions/rivalryMatchups';
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise';

/**
 * Builds a full league snapshot including live + legacy data.
 * Excludes standings for completed seasons.
 * @param {Object} options
 * @param {boolean} options.previewTransactions - Whether to preview only last few transactions
 * @param {boolean} options.refreshTransactions - Force refresh transactions from API
 * @param {Array<[string, string]>} options.rivalries - Array of manager ID pairs to calculate rivalry stats
 */
export const buildLeagueSnapshot = async ({
    previewTransactions = false,
    refreshTransactions = false,
    rivalries = []
} = {}) => {
    console.info('🟢 Starting buildLeagueSnapshot');

    try {
        console.info('[Snapshot] Fetching core league data...');

        // 1. Fetch core data in parallel
        const [
            rostersData,
            managersData,
            transactionsData,
            awardsData,
            bracketsData
        ] = await waitForAll(
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueTransactions(previewTransactions, refreshTransactions),
            getAwards(),
            getBrackets()
        );

        console.info('[Snapshot] Core data fetched successfully');

        // Validate outputs
        const rosters = rostersData?.rosters || {};
        const startersAndReserve = rostersData?.startersAndReserve || [];
        const managers = managersData?.users || {};
        const teamManagersMap = managersData?.teamManagersMap || {};
        const transactions = transactionsData?.transactions || [];
        const transactionTotals = transactionsData?.totals || {};
        const awards = Array.isArray(awardsData) ? awardsData : [];
        const brackets = bracketsData || {};

        // 2. Process rivalries
        const rivalryResults: Record<string, any> = {};
        if (rivalries.length) {
            console.info('[Snapshot] Processing rivalries...');
            for (const [userOneID, userTwoID] of rivalries) {
                try {
                    const rivalry = await getRivalryMatchups(userOneID, userTwoID);
                    rivalryResults[`${userOneID}-${userTwoID}`] = rivalry || {};
                } catch (err) {
                    console.error(`[Snapshot] Error processing rivalry ${userOneID}-${userTwoID}:`, err);
                    rivalryResults[`${userOneID}-${userTwoID}`] = {};
                }
            }
            console.info('[Snapshot] Rivalries processed');
        }

        // 3. Compose final snapshot
        const snapshot = {
            leagueID,
            season: brackets?.champs?.[0]?.year || null, // fallback to latest bracket year
            rosters,
            startersAndReserve,
            managers,
            teamManagersMap,
            transactions,
            transactionTotals,
            awards,
            brackets,
            rivalries: rivalryResults
        };

        console.info('✅ Snapshot built successfully');
        return snapshot;
    } catch (err) {
        console.error('❌ Error building snapshot:', err);
        return null;
    }
};
