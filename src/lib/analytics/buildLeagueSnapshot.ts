import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers';
import { getLeagueTransactions } from '$lib/utils/helperFunctions/leagueTransactions';
import { getAwards } from '$lib/utils/helperFunctions/leagueAwards';
import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets';
import { getRivalryMatchups } from '$lib/utils/helperFunctions/rivalryMatchups';
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise';
import { getLeagueMatchups } from '$lib/utils/helperFunctions/leagueMatchups'; // new helper to fetch all weekly matchups

/**
 * Build a full league snapshot including rosters, managers, transactions, awards, brackets, matchups, and rivalries.
 */
export const buildLeagueSnapshot = async ({
    previewTransactions = false,
    refreshTransactions = false,
    rivalries = []
} = {}) => {
    console.info('🟢 Starting buildLeagueSnapshot');

    try {
        console.info('[Snapshot] Fetching core league data...');

        const [
            rostersData,
            managersData,
            transactionsData,
            awardsData,
            bracketsData,
            matchupsData
        ] = await waitForAll(
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueTransactions(previewTransactions, refreshTransactions),
            getAwards(),
            getBrackets(),
            getLeagueMatchups() // new function to fetch all weekly matchups
        );

        console.info('[Snapshot] Core data fetched successfully');

        // Validate data
        if (!rostersData?.rosters) console.warn('[Snapshot] rostersData missing or invalid, defaulting to empty object');
        if (!managersData?.users) console.warn('[Snapshot] managersData missing or invalid, defaulting to empty object');
        if (!transactionsData?.transactions) console.warn('[Snapshot] transactionsData missing or invalid, defaulting to empty array');
        if (!awardsData) console.warn('[Snapshot] awardsData missing, defaulting to empty array');
        if (!bracketsData) console.warn('[Snapshot] bracketsData missing, defaulting to empty object');
        if (!matchupsData) console.warn('[Snapshot] matchupsData missing, defaulting to empty array');

        // Process rivalries
        console.info('[Snapshot] Processing rivalries...');
        const rivalryResults: Record<string, any> = {};
        for (const [userOneID, userTwoID] of rivalries) {
            try {
                const rivalry = await getRivalryMatchups(userOneID, userTwoID);
                rivalryResults[`${userOneID}-${userTwoID}`] = rivalry;
            } catch (err) {
                console.error(`[Snapshot] Error processing rivalry ${userOneID}-${userTwoID}:`, err);
            }
        }

        // Build final snapshot
        const snapshot = {
            leagueID,
            rosters: rostersData?.rosters || {},
            startersAndReserve: rostersData?.startersAndReserve || [],
            managers: managersData?.users || {},
            teamManagersMap: managersData?.teamManagersMap || {},
            transactions: transactionsData?.transactions || [],
            transactionTotals: transactionsData?.totals || {},
            awards: awardsData || [],
            brackets: bracketsData || {},
            matchups: matchupsData || [], // all weekly scoring
            rivalries: rivalryResults
        };

        console.info('✅ Snapshot built successfully');
        return snapshot;
    } catch (err) {
        console.error('❌ Error building snapshot:', err);
        return null;
    }
};
