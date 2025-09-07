import { getLeagueData } from './leagueData';
import { leagueID } from '$lib/utils/leagueInfo';
import { getNflState } from './nflState';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { transactionsStore } from '$lib/stores';
import { browser } from '$app/environment';
import { getLeagueTeamManagers } from './leagueTeamManagers';
import { legacyTransactions as legacyTransactionData } from './legacyTransactions';

export const getLeagueTransactions = async (preview, refresh = false) => {
    const transactionsStoreVal = get(transactionsStore);

    if (transactionsStoreVal.totals) {
        return {
            transactions: checkPreview(preview, transactionsStoreVal.transactions),
            totals: transactionsStoreVal.totals,
            stale: false
        };
    }

    if (!refresh && browser) {
        let localTransactions = await JSON.parse(localStorage.getItem("transactions"));
        if (localTransactions) {
            localTransactions.transactions = checkPreview(preview, localTransactions.transactions);
            localTransactions.stale = true;
            return localTransactions;
        }
    }

    const nflState = await getNflState().catch(() => {});
    let week = 18;
    if (nflState?.season_type === 'regular') week = nflState.week;

    const { transactionsData, currentSeason } = await combThroughTransactions(week, leagueID).catch(() => {});
    const { transactions, totals } = await digestTransactions({ transactionsData, currentSeason });

    const transactionPackage = { transactions, totals };

    if (browser) {
        localStorage.setItem("transactions", JSON.stringify(transactionPackage));
        transactionsStore.update(() => transactionPackage);
    }

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
    week = week > 0 ? week : 1;

    const leagueIDs = [];
    let currentSeason = null;

    while (currentLeagueID && currentLeagueID !== 0) {
        const leagueData = await getLeagueData(currentLeagueID).catch(() => {});
        leagueIDs.push(currentLeagueID);
        if (!currentSeason) currentSeason = leagueData.season;
        currentLeagueID = leagueData.previous_league_id;
    }

    const transactionPromises = [];
    for (const singleLeagueID of leagueIDs) {
        let w = week;
        while (w > 0) {
            transactionPromises.push(fetch(`https://api.sleeper.app/v1/league/${singleLeagueID}/transactions/${w}`, { compress: true }));
            w--;
        }
    }

    const transactionRess = await waitForAll(...transactionPromises).catch(() => {});
    const transactionDataPromises = [];

    for (const transactionRes of transactionRess) {
        if (!transactionRes || !transactionRes.ok) continue;
        transactionDataPromises.push(transactionRes.json());
    }

    const transactionsDataJson = await waitForAll(...transactionDataPromises).catch(() => {});

    let transactionsData = [];
    for (const transactionDataJson of transactionsDataJson) {
        transactionsData = transactionsData.concat(transactionDataJson);
    }

    // Add legacy transactions
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

    const transactionOrder = transactionsData.sort((a, b) => b.status_updated - a.status_updated);

    for (const transaction of transactionOrder) {
        const { digestedTransaction, season, success } = digestTransaction({ transaction, currentSeason });
        if (!success) continue;

        transactions.push(digestedTransaction);

        let seasonToUse = season;
        if (!leagueTeamManagers.teamManagersMap[seasonToUse]) {
            seasonToUse--;
            if (!leagueTeamManagers.teamManagersMap[seasonToUse]) seasonToUse += 2;
        }

        for (const roster of digestedTransaction.rosters) {
            const type = digestedTransaction.type;
            if (!leagueTeamManagers.teamManagersMap[seasonToUse]) continue;

            for (const manager of leagueTeamManagers.teamManagersMap[seasonToUse][roster]?.managers || []) {
                if (!totals.allTime[manager]) totals.allTime[manager] = { trade: 0, waiver: 0 };
                totals.allTime[manager][type] = (totals.allTime[manager][type] || 0) + 1;
            }

            if (!totals.seasons[seasonToUse]) totals.seasons[seasonToUse] = {};
            if (!totals.seasons[seasonToUse][roster]) totals.seasons[seasonToUse][roster] = { trade: 0, waiver: 0, rosterID: roster };
            totals.seasons[seasonToUse][roster][type] = (totals.seasons[seasonToUse][roster][type] || 0) + 1;
        }
    }

    return { transactions, totals };
};

const digestTransaction = ({ transaction, currentSeason }) => {
    if (transaction.status === 'failed') return { success: false };
    if (!transaction.roster_ids || transaction.roster_ids.length === 0) return { success: false };

    const transactionRosters = transaction.roster_ids;
    const bid = transaction.settings?.waiver_bid;
    const timestamp = transaction.status_updated;
    const date = digestDate(timestamp);
    const season = new Date(timestamp).getFullYear();

    let digestedTransaction = {
        id: transaction.transaction_id,
        date,
        timestamp,
        season,
        type: transaction.type === 'trade' ? 'trade' : 'waiver', // waivers + free agents
        rosters: transactionRosters,
        moves: []
    };

    if (season !== currentSeason) digestedTransaction.previousOwners = true;

    const adds = transaction.adds || {};
    const drops = transaction.drops || {};
    const draftPicks = transaction.draft_picks || [];

    const handled = [];

    // Handle adds (waivers, free agents, trades)
    for (const player in adds) {
        if (!player) continue;
        handled.push(player);
        digestedTransaction.moves.push(handleAdds(transactionRosters, adds, drops, player, transaction.type, bid));
    }

    // Handle remaining drops
    for (const player in drops) {
        if (handled.includes(player)) continue;
        if (!player) continue;

        const move = new Array(transactionRosters.length).fill(null);
        if (transactionRosters.includes(drops[player])) {
            move[transactionRosters.indexOf(drops[player])] = { type: "Dropped", player };
            digestedTransaction.moves.push(move);
        }
    }

    // Draft picks
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

// Correctly handle adds for waivers, free agents, and trades
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
    const year = a.getFullYear();
    const month = months[a.getMonth()];
    const date = a.getDate();
    const hour = a.getHours();
    const min = a.getMinutes();
    return `${month} ${date} ${year}, ${hour % 12 || 12}:${min < 10 ? '0'+min : min}${hour >= 12 ? 'PM' : 'AM'}`;
};
