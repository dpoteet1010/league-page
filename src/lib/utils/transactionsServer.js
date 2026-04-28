import { getLeagueData } from './leagueDataServer.js';
import { getNflState } from './nflStateServer.js';
import { getLeagueTeamManagers } from './leagueTeamManagersServer.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { legacyTransactions as legacyTransactionData } from './helperFunctions/legacyTransactions.js';

/**
 * Server-side version of getLeagueTransactions.
 * Compiles all historical trades and waivers.
 */
export const getLeagueTransactions = async (preview = false) => {
    const nflState = await getNflState().catch(() => {});
    let week = 18;
    if (nflState?.season_type === 'regular') week = nflState.week;

    // 1. Gather all transaction data across all linked seasons
    const { transactionsData, currentSeason } = await combThroughTransactions(week, defaultLeagueID);
    
    // 2. Process and aggregate totals
    const { transactions, totals } = await digestTransactions({ transactionsData, currentSeason });

    return {
        transactions: checkPreview(preview, transactions),
        totals,
        stale: false
    };
};

const checkPreview = (preview, passedTransactions) => {
    if (preview) {
        const previewToReturn = 3;
        const trades = passedTransactions.filter(tx => tx.type === "trade").slice(0, previewToReturn);
        const waivers = passedTransactions.filter(tx => tx.type === "waiver").slice(0, previewToReturn);
        return { trades, waivers };
    }
    return passedTransactions;
};

const combThroughTransactions = async (week, currentLeagueID) => {
    let tempWeek = week > 0 ? week : 1;
    const leagueIDs = [];
    let currentSeason = null;
    let loopID = currentLeagueID;

    // Build the chain of league IDs
    while (loopID && loopID !== "0") {
        const leagueData = await getLeagueData(loopID).catch(() => {});
        if (!leagueData) break;
        leagueIDs.push(loopID);
        if (!currentSeason) currentSeason = leagueData.season;
        loopID = leagueData.previous_league_id;
    }

    const transactionPromises = [];
    for (const singleLeagueID of leagueIDs) {
        let w = tempWeek;
        while (w > 0) {
            transactionPromises.push(
                fetch(`https://api.sleeper.app/v1/league/${singleLeagueID}/transactions/${w}`)
                .then(res => res.ok ? res.json() : [])
            );
            w--;
        }
    }

    const transactionsDataJson = await Promise.all(transactionPromises);
    let transactionsData = transactionsDataJson.flat();

    // 3. Add legacy transactions (2023, 2024, etc.)
    for (const year in legacyTransactionData) {
        const yearData = legacyTransactionData[year]?.transactions || [];
        for (const tx of yearData) {
            if (!tx.status_updated) {
                const base = new Date(`${year}-01-01T00:00:00Z`).getTime();
                tx.status_updated = base + (tx.settings?.seq || 0);
            }
            transactionsData.push(tx);
        }
    }

    return { transactionsData, currentSeason };
};

const digestTransactions = async ({ transactionsData, currentSeason }) => {
    const transactions = [];
    const totals = { allTime: {}, seasons: {} };
    const leagueTeamManagers = await getLeagueTeamManagers();

    // Sort by most recent first
    const transactionOrder = transactionsData.sort((a, b) => b.status_updated - a.status_updated);

    for (const transaction of transactionOrder) {
        const { digestedTransaction, season, success } = digestSingleTransaction({ transaction, currentSeason });
        if (!success) continue;

        transactions.push(digestedTransaction);

        let seasonToUse = season;
        // Logic to find the correct team manager map for the season
        if (!leagueTeamManagers.teamManagersMap[seasonToUse]) {
            seasonToUse--;
            if (!leagueTeamManagers.teamManagersMap[seasonToUse]) seasonToUse += 2;
        }

        for (const roster of digestedTransaction.rosters) {
            const type = digestedTransaction.type;
            const seasonMap = leagueTeamManagers.teamManagersMap[seasonToUse];
            if (!seasonMap) continue;

            // Updated to handle standard user_id based mapping
            const managerData = seasonMap[roster] || {};
            const managerID = managerData.user_id;

            if (managerID) {
                if (!totals.allTime[managerID]) totals.allTime[managerID] = { trade: 0, waiver: 0 };
                totals.allTime[managerID][type] = (totals.allTime[managerID][type] || 0) + 1;
            }

            if (!totals.seasons[seasonToUse]) totals.seasons[seasonToUse] = {};
            if (!totals.seasons[seasonToUse][roster]) totals.seasons[seasonToUse][roster] = { trade: 0, waiver: 0, rosterID: roster };
            totals.seasons[seasonToUse][roster][type] = (totals.seasons[seasonToUse][roster][type] || 0) + 1;
        }
    }

    return { transactions, totals };
};

const digestSingleTransaction = ({ transaction, currentSeason }) => {
    if (transaction.status === 'failed' || !transaction.roster_ids?.length) return { success: false };

    const transactionRosters = transaction.roster_ids;
    const bid = transaction.settings?.waiver_bid;
    const timestamp = transaction.status_updated;
    const season = new Date(timestamp).getFullYear();

    let digestedTransaction = {
        id: transaction.transaction_id,
        date: digestDate(timestamp),
        timestamp,
        season,
        type: transaction.type === 'trade' ? 'trade' : 'waiver',
        rosters: transactionRosters,
        moves: []
    };

    if (season !== currentSeason) digestedTransaction.previousOwners = true;

    const adds = transaction.adds || {};
    const drops = transaction.drops || {};
    const draftPicks = transaction.draft_picks || [];
    const handled = [];

    for (const player in adds) {
        if (!player) continue;
        handled.push(player);
        digestedTransaction.moves.push(handleAdds(transactionRosters, adds, drops, player, transaction.type, bid));
    }

    for (const player in drops) {
        if (handled.includes(player) || !player) continue;
        const move = new Array(transactionRosters.length).fill(null);
        if (transactionRosters.includes(drops[player])) {
            move[transactionRosters.indexOf(drops[player])] = { type: "Dropped", player };
            digestedTransaction.moves.push(move);
        }
    }

    for (const pick of draftPicks) {
        const move = new Array(transactionRosters.length).fill(null);
        if (pick.previous_owner_id !== undefined && transactionRosters.includes(pick.previous_owner_id)) {
            move[transactionRosters.indexOf(pick.previous_owner_id)] = "origin";
        }
        if (pick.owner_id !== undefined && transactionRosters.includes(pick.owner_id)) {
            move[transactionRosters.indexOf(pick.owner_id)] = { type: "Received Pick", pick };
        }
        digestedTransaction.moves.push(move);
    }

    return { digestedTransaction, season, success: true };
};

const handleAdds = (rosters, adds, drops, player, transactionType, bid) => {
    const move = new Array(rosters.length).fill(null);
    const addedTo = adds[player];
    const droppedFrom = drops?.[player];

    if (transactionType === 'trade' && droppedFrom !== undefined) {
        move[rosters.indexOf(addedTo)] = { type: "trade", player };
        move[rosters.indexOf(droppedFrom)] = "origin";
    } else {
        if (droppedFrom !== undefined && droppedFrom !== addedTo) {
            move[rosters.indexOf(droppedFrom)] = { type: "Dropped", player };
        }
        move[rosters.indexOf(addedTo)] = { type: "Added", player, bid };
    }
    return move;
};

const digestDate = (tStamp) => {
    const a = new Date(tStamp);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[a.getMonth()]} ${a.getDate()} ${a.getFullYear()}, ${a.getHours() % 12 || 12}:${a.getMinutes() < 10 ? '0'+a.getMinutes() : a.getMinutes()}${a.getHours() >= 12 ? 'PM' : 'AM'}`;
};
