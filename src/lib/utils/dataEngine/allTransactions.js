// allTransactions.js
//
// Fetches every trade/waiver transaction across the league's full history.
// Does NOT grade them here — grading functions live in transactionGrading.js
// and are called from the UI/data pipeline after playerResults are available.

import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getNflState } from '$lib/utils/helperFunctions/nflState.js';
import { waitForAll } from '$lib/utils/helperFunctions/multiPromise.js';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
import { legacyTransactions as legacyTransactionData } from '$lib/utils/helperFunctions/legacyTransactions.js';

async function combThroughTransactions(week, startingLeagueID) {
	const debug = [];
	week = week > 0 ? week : 1;

	const leagueIDs = [];
	let currentSeason = null;
	let currentLeagueID = startingLeagueID;

	while (currentLeagueID && currentLeagueID !== 0) {
		const leagueDataRes = await getLeagueData(currentLeagueID).catch((err) => {
			debug.push(`getLeagueData failed for ${currentLeagueID}: ${err.message}`);
			return null;
		});
		if (!leagueDataRes) break;
		leagueIDs.push(currentLeagueID);
		if (!currentSeason) currentSeason = leagueDataRes.season;
		currentLeagueID = leagueDataRes.previous_league_id;
	}

	debug.push(`Walked live league chain: ${leagueIDs.length} season(s) — ${leagueIDs.join(', ') || 'none'}`);

	const transactionPromises = [];
	for (const singleLeagueID of leagueIDs) {
		let w = week;
		while (w > 0) {
			transactionPromises.push(
				fetch(`https://api.sleeper.app/v1/league/${singleLeagueID}/transactions/${w}`, { compress: true })
			);
			w--;
		}
	}

	const transactionRess = (await waitForAll(...transactionPromises).catch((err) => {
		debug.push(`Transaction fetch failed: ${err.message}`);
		return [];
	})) || [];

	const transactionDataPromises = transactionRess
		.filter((res) => res && res.ok)
		.map((res) => res.json());

	const transactionsDataJson = (await waitForAll(...transactionDataPromises).catch((err) => {
		debug.push(`Transaction JSON parse failed: ${err.message}`);
		return [];
	})) || [];

	let transactionsData = [];
	for (const chunk of transactionsDataJson) {
		transactionsData = transactionsData.concat(chunk);
	}

	debug.push(`Fetched ${transactionsData.length} live transactions.`);

	let legacyCount = 0;
	for (const year in legacyTransactionData) {
		const yearData = legacyTransactionData[year]?.transactions || [];
		for (const tx of yearData) {
			if (!tx.status_updated) {
				const base = new Date(`${year}-01-01T00:00:00Z`).getTime();
				tx.status_updated = base + (tx.settings?.seq || 0);
			}
			transactionsData.push(tx);
			legacyCount++;
		}
	}
	debug.push(`Merged ${legacyCount} legacy transactions.`);

	return { transactionsData, currentSeason, debug };
}

const digestDate = (tStamp) => {
	const a = new Date(tStamp);
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const year = a.getFullYear();
	const month = months[a.getMonth()];
	const date = a.getDate();
	const hour = a.getHours();
	const min = a.getMinutes();
	return `${month} ${date} ${year}, ${hour % 12 || 12}:${min < 10 ? '0' + min : min}${hour >= 12 ? 'PM' : 'AM'}`;
};

const handleAdds = (rosters, adds, drops, player, transactionType, bid) => {
	const move = new Array(rosters.length).fill(null);
	const addedTo = adds[player];
	const droppedFrom = drops?.[player];

	if (transactionType === 'trade' && droppedFrom !== undefined) {
		move[rosters.indexOf(addedTo)] = { type: 'trade', player };
		move[rosters.indexOf(droppedFrom)] = 'origin';
	} else {
		if (droppedFrom !== undefined && droppedFrom !== addedTo) {
			move[rosters.indexOf(droppedFrom)] = { type: 'Dropped', player };
		}
		move[rosters.indexOf(addedTo)] = { type: 'Added', player, bid };
	}

	return move;
};

const digestTransaction = ({ transaction, currentSeason }) => {
	if (transaction.status === 'failed') return { success: false };
	if (!transaction.roster_ids || transaction.roster_ids.length === 0) return { success: false };

	const transactionRosters = transaction.roster_ids;
	const bid = transaction.settings?.waiver_bid;
	const timestamp = transaction.status_updated;
	const date = digestDate(timestamp);
	const season = new Date(timestamp).getFullYear();

	// FIXED: `leg` is the NFL week this transaction occurred in.
	// It's present on every Sleeper transaction (confirmed in legacy data too).
	// Grading uses this instead of timestamp to find player-weeks from this
	// point forward, since playerResults rows have week+year but no timestamp.
	const leg = transaction.leg || 1;

	let digestedTransaction = {
		id: transaction.transaction_id,
		date,
		timestamp,
		season,
		leg,  // <-- the week number this transaction occurred in
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
		if (handled.includes(player)) continue;
		if (!player) continue;

		const move = new Array(transactionRosters.length).fill(null);
		if (transactionRosters.includes(drops[player])) {
			move[transactionRosters.indexOf(drops[player])] = { type: 'Dropped', player };
			digestedTransaction.moves.push(move);
		}
	}

	for (const pick of draftPicks) {
		const move = new Array(transactionRosters.length).fill(null);
		if (pick.previous_owner_id !== undefined && transactionRosters.includes(pick.previous_owner_id)) {
			move[transactionRosters.indexOf(pick.previous_owner_id)] = 'origin';
		}
		if (pick.owner_id !== undefined && transactionRosters.includes(pick.owner_id)) {
			move[transactionRosters.indexOf(pick.owner_id)] = { type: 'Received Pick', pick };
		}
		digestedTransaction.moves.push(move);
	}

	return { digestedTransaction, season, success: true };
};

function resolveSeasonKey(season, teamManagersMap) {
	let seasonToUse = season;
	if (!teamManagersMap[seasonToUse]) {
		seasonToUse -= 1;
		if (!teamManagersMap[seasonToUse]) seasonToUse += 2;
	}
	return teamManagersMap[seasonToUse] ? seasonToUse : null;
}

async function digestTransactions({ transactionsData, currentSeason }) {
	const debug = [];
	const transactions = [];
	const totals = { allTime: {}, seasons: {} };

	const leagueTeamManagers = await getLeagueTeamManagers();
	const transactionOrder = [...transactionsData].sort((a, b) => b.status_updated - a.status_updated);

	let skippedCount = 0;

	for (const transaction of transactionOrder) {
		const { digestedTransaction, season, success } = digestTransaction({ transaction, currentSeason });
		if (!success) continue;

		const seasonKey = resolveSeasonKey(season, leagueTeamManagers.teamManagersMap || {});
		digestedTransaction.seasonKey = seasonKey != null ? String(seasonKey) : null;

		transactions.push(digestedTransaction);

		if (seasonKey == null) {
			skippedCount++;
			continue;
		}

		const yearMap = leagueTeamManagers.teamManagersMap[seasonKey] || {};
		const managerIds = [];

		for (const roster of digestedTransaction.rosters) {
			const type = digestedTransaction.type;
			const managerId = yearMap[roster]?.managers?.[0];
			if (managerId == null) continue;
			managerIds.push(managerId);

			if (!totals.allTime[managerId]) totals.allTime[managerId] = { trade: 0, waiver: 0 };
			totals.allTime[managerId][type] = (totals.allTime[managerId][type] || 0) + 1;

			if (!totals.seasons[digestedTransaction.seasonKey]) totals.seasons[digestedTransaction.seasonKey] = {};
			if (!totals.seasons[digestedTransaction.seasonKey][managerId]) {
				totals.seasons[digestedTransaction.seasonKey][managerId] = { trade: 0, waiver: 0, managerId };
			}
			totals.seasons[digestedTransaction.seasonKey][managerId][type] =
				(totals.seasons[digestedTransaction.seasonKey][managerId][type] || 0) + 1;
		}

		digestedTransaction.managerIds = managerIds;
	}

	debug.push(`Digested ${transactions.length} transactions (${skippedCount} had no resolvable season).`);

	return { transactions, totals, debug };
}

export async function getTransactionHistory(startingLeagueID = mainLeagueID) {
	const debug = [];

	const nflState = await getNflState().catch((err) => {
		debug.push(`getNflState failed: ${err.message}`);
		return null;
	});
	let week = 18;
	if (nflState?.season_type === 'regular') week = nflState.week;

	const { transactionsData, currentSeason, debug: combDebug } = await combThroughTransactions(week, startingLeagueID);
	debug.push(...combDebug);

	const { transactions, totals, debug: digestDebug } = await digestTransactions({ transactionsData, currentSeason });
	debug.push(...digestDebug);

	return { transactions, totals, debug };
}

export function getAllTimeTransactionTotals(totals, managersSnapshot) {
	return Object.entries(totals.allTime || {})
		.map(([managerId, counts]) => ({
			managerId,
			displayName: managersSnapshot?.users?.[managerId]?.display_name || 'Unknown',
			trades: counts.trade || 0,
			waivers: counts.waiver || 0,
			total: (counts.trade || 0) + (counts.waiver || 0)
		}))
		.sort((a, b) => b.total - a.total);
}

export function getSeasonTransactionTotals(totals, seasonKey, managersSnapshot) {
	const seasonData = totals.seasons?.[String(seasonKey)] || {};
	return Object.values(seasonData)
		.map((entry) => ({
			managerId: entry.managerId,
			displayName: managersSnapshot?.users?.[entry.managerId]?.display_name || 'Unknown',
			trades: entry.trade || 0,
			waivers: entry.waiver || 0,
			total: (entry.trade || 0) + (entry.waiver || 0)
		}))
		.sort((a, b) => b.total - a.total);
}

export function getTradeHistory(transactions, managerIdA, managerIdB) {
	return transactions
		.filter((tx) =>
			tx.type === 'trade' &&
			tx.managerIds?.includes(managerIdA) &&
			tx.managerIds?.includes(managerIdB)
		)
		.sort((a, b) => b.timestamp - a.timestamp);
}
