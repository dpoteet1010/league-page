import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers';
import { getLeagueStandings } from '$lib/utils/helperFunctions/leagueStandings';
import { getLeagueTransactions } from '$lib/utils/helperFunctions/leagueTransactions';
import { getAwards } from '$lib/utils/helperFunctions/leagueAwards';
import { getBrackets } from '$lib/utils/helperFunctions/leagueBrackets';
import { getRivalryMatchups } from '$lib/utils/helperFunctions/rivalryMatchups';
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise';

/**
 * Build a full league snapshot including live + legacy data.
 * Logs each step and validates returned data.
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

    let rostersData = {};
    let managersData = {};
    let standingsData = {};
    let transactionsData = {};
    let awardsData = [];
    let bracketsData = {};
    let rivalriesData = {};

    try {
        // 1. Fetch all core data in parallel
        console.info('[Snapshot] Fetching core league data...');
        [rostersData, managersData, standingsData, transactionsData, awardsData, bracketsData] = await waitForAll(
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueStandings(),
            getLeagueTransactions(previewTransactions, refreshTransactions),
            getAwards(),
            getBrackets()
        );

        console.info('[Snapshot] Core data fetched successfully');

        // 2. Validate each major data piece
        if (!rostersData || !rostersData.rosters) {
            console.warn('[Snapshot] rostersData is missing or invalid, defaulting to empty object');
            rostersData = { rosters: {}, startersAndReserve: [] };
        }
        if (!managersData || !managersData.users || !managersData.teamManagersMap) {
            console.warn('[Snapshot] managersData is missing or invalid, defaulting to empty object');
            managersData = { users: {}, teamManagersMap: {} };
        }
        if (!standingsData || !standingsData.standingsInfo) {
            console.warn('[Snapshot] standingsData is missing or invalid, defaulting to empty object');
            standingsData = { yearData: null, standingsInfo: {} };
        }
        if (!transactionsData || !transactionsData.transactions || !transactionsData.totals) {
            console.warn('[Snapshot] transactionsData is missing or invalid, defaulting to empty arrays/objects');
            transactionsData = { transactions: [], totals: {} };
        }
        if (!bracketsData) {
            console.warn('[Snapshot] bracketsData is missing or invalid, defaulting to empty object');
            bracketsData = {};
        }

        // 3. Process rivalries if requested
        console.info('[Snapshot] Processing rivalries...');
        rivalriesData = {};
        for (const [userOneID, userTwoID] of rivalries) {
            try {
                const rivalry = await getRivalryMatchups(userOneID, userTwoID);
                if (rivalry) {
                    rivalriesData[`${userOneID}-${userTwoID}`] = rivalry;
                } else {
                    console.warn(`[Snapshot] Rivalry returned no data for ${userOneID}-${userTwoID}`);
                }
            } catch (err) {
                console.error(`[Snapshot] Error fetching rivalry for ${userOneID}-${userTwoID}:`, err);
            }
        }

        // 4. Include matchups from rosters if available
        const matchupsBySeason = {};
        if (rostersData?.rosters && managersData?.teamManagersMap) {
            for (const year of Object.keys(managersData.teamManagersMap)) {
                matchupsBySeason[year] = rostersData?.matchups?.[year] || [];
            }
        }

        // 5. Compose final snapshot
        const snapshot = {
            leagueID,
            season: standingsData?.yearData || null,
            rosters: rostersData?.rosters ?? {},
            startersAndReserve: rostersData?.startersAndReserve ?? [],
            managers: managersData?.users ?? {},
            teamManagersMap: managersData?.teamManagersMap ?? {},
            standings: standingsData?.standingsInfo ?? {},
            transactions: transactionsData?.transactions ?? [],
            transactionTotals: transactionsData?.totals ?? {},
            awards: awardsData ?? [],
            brackets: bracketsData ?? {},
            rivalries: rivalriesData ?? {},
            matchups: matchupsBySeason ?? {}
        };

        console.info('✅ Snapshot built successfully');
        return snapshot;

    } catch (err) {
        console.error('❌ Error building snapshot:', err);
        return null;
    }
};
