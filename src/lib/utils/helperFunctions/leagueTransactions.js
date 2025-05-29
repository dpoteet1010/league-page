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
		console.log("Using store transactions.");
		return {
			transactions: checkPreview(preview, transactionsStoreVal.transactions),
			totals: transactionsStoreVal.totals,
			stale: false
		};
	}

	if (!refresh && browser) {
		let localTransactions = await JSON.parse(localStorage.getItem("transactions"));
		if (localTransactions) {
			console.log("Using localStorage transactions (stale).");
			localTransactions.transactions = checkPreview(preview, localTransactions.transactions);
			localTransactions.stale = true;
			return localTransactions;
		}
	}

	console.log("Fetching new transactions from Sleeper API...");
	const nflState = await getNflState().catch((err) => { console.error("NFL state error:", err); });

	let week = 18;
	if (nflState?.season_type == 'regular') {
		week = nflState.week;
	}

	const { transactionsData, currentSeason } = await combThroughTransactions(week, leagueID).catch((err) => { console.error("Combining transactions failed:", err); });

	const { transactions, totals } = await digestTransactions({ transactionsData, currentSeason });

	const transactionPackage = {
		transactions,
		totals
	};

	if (browser) {
		localStorage.setItem("transactions", JSON.stringify(transactionPackage));
		transactionsStore.update(() => transactionPackage);
	}

	console.log("Returning processed transactions.");
	return {
		transactions: checkPreview(preview, transactions),
		totals,
		stale: false
	};
};

const checkPreview = (preview, passedTransactions) => {
	if (preview) {
		const previewToReturn = 3;
		const trades = [];
		const waivers = [];

		let i = 0;
		while ((trades.length < previewToReturn || waivers.length < previewToReturn) && i < passedTransactions.length) {
			if (passedTransactions[i].type == "waiver" && waivers.length < previewToReturn) {
				waivers.push(passedTransactions[i]);
			} else if (passedTransactions[i].type == "trade" && trades.length < previewToReturn) {
				trades.push(passedTransactions[i]);
			}
			i++;
		}

		console.log("Preview mode active. Trades:", trades.length, "Waivers:", waivers.length);
		return { trades, waivers };
	}
	return passedTransactions;
};

const combThroughTransactions = async (week, currentLeagueID) => {
	week = week > 0 ? week : 1;

	const leagueIDs = [];
	let currentSeason = null;

	while (currentLeagueID && currentLeagueID != 0) {
		const leagueData = await getLeagueData(currentLeagueID).catch((err) => { console.error("getLeagueData error:", err); });
		leagueIDs.push(currentLeagueID);

		if (!currentSeason) {
			currentSeason = leagueData.season;
		}

		currentLeagueID = leagueData.previous_league_id;
	}

	console.log("Collected league IDs:", leagueIDs);

	const transactionPromises = [];
	for (const singleLeagueID of leagueIDs) {
		while (week > 0) {
			transactionPromises.push(fetch(`https://api.sleeper.app/v1/league/${singleLeagueID}/transactions/${week}`, { compress: true }));
			week--;
		}
		week = 18;
	}

	const transactionRess = await waitForAll(...transactionPromises).catch((err) => { console.error("Transaction requests failed:", err); });
	const transactionDataPromises = [];

	for (const transactionRes of transactionRess) {
		if (!transactionRes || !transactionRes.ok) {
			console.error("Bad transaction response:", transactionRes);
			continue;
		}
		transactionDataPromises.push(transactionRes.json());
	}

	const transactionsDataJson = await waitForAll(...transactionDataPromises).catch((err) => { console.error("Transaction JSON parsing failed:", err); });

	let transactionsData = [];
	for (const transactionDataJson of transactionsDataJson) {
		transactionsData = transactionsData.concat(transactionDataJson);
	}

	// Add legacy
	let legacyTransactionList = [];
	for (const year in legacyTransactionData) {
		const yearData = legacyTransactionData[year]?.transactions ?? [];
		for (const tx of yearData) {
			if (!tx.status_updated) {
				const base = new Date(`${year}-01-01T00:00:00Z`).getTime();
				tx.status_updated = base + (tx.settings?.seq || 0);
			}
			legacyTransactionList.push(tx);
		}
	}
	console.log("Fetched", transactionsData.length, "API transactions. Adding", legacyTransactionList.length, "legacy transactions.");
	transactionsData = transactionsData.concat(legacyTransactionList);

	return { transactionsData, currentSeason };
};

const digestTransaction = ({ transaction, currentSeason }) => {
	if (transaction.status === 'failed') return { success: false };

	if (!transaction.roster_ids || transaction.roster_ids.length === 0) {
		console.warn("Transaction missing roster_ids:", transaction.transaction_id);
		return { success: false };
	}

	const handled = [];
	const transactionRosters = transaction.roster_ids;
	const bid = transaction.settings?.waiver_bid;
	const date = digestDate(transaction.status_updated);
	const season = parseInt(date.split(',')[0].split(' ')[2]);

	let digestedTransaction = {
		id: transaction.transaction_id,
		date,
		season,
		type: transaction.type,
		rosters: transactionRosters,
		moves: []
	};

	if (season !== currentSeason) {
		digestedTransaction.previousOwners = true;
	}

	const adds = transaction.adds || {};
	const drops = transaction.drops || {};
	const draftPicks = transaction.draft_picks || [];

	if (transaction.type === "trade") {
		// Handle player trades
		for (let player in adds) {
			const toRoster = adds[player];
			const fromRoster = drops[player];

			if (toRoster !== undefined && fromRoster !== undefined) {
				let move = new Array(transactionRosters.length).fill(null);
				move[transactionRosters.indexOf(fromRoster)] = {
					type: "Traded Away",
					player
				};
				move[transactionRosters.indexOf(toRoster)] = {
					type: "Received",
					player
				};
				digestedTransaction.moves.push(move);
			}
		}

		// Handle draft pick trades
		for (let pick of draftPicks) {
			let move = new Array(transactionRosters.length).fill(null);
			if (pick.previous_owner_id !== undefined && pick.owner_id !== undefined) {
				move[transactionRosters.indexOf(pick.previous_owner_id)] = {
					type: "Traded Away Pick",
					pick
				};
				move[transactionRosters.indexOf(pick.owner_id)] = {
					type: "Received Pick",
					pick
				};
				digestedTransaction.moves.push(move);
			}
		}
	} else {
		// Handle waivers
		for (let player in adds) {
			if (!player) continue;
			handled.push(player);
			digestedTransaction.moves.push(handleAdds(transactionRosters, adds, drops, player, bid));
		}

		for (let player in drops) {
			if (handled.includes(player)) continue;
			if (!player) continue;

			let move = new Array(transactionRosters.length).fill(null);
			move[transactionRosters.indexOf(drops[player])] = {
				type: "Dropped",
				player
			};
			digestedTransaction.moves.push(move);
		}
	}

	return { digestedTransaction, season, success: true };
};

const digestDate = (tStamp) => {
	const a = new Date(tStamp);
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const year = a.getFullYear();
	const month = months[a.getMonth()];
	const date = a.getDate();
	const hour = a.getHours();
	const min = a.getMinutes();
	return month + ' ' + date + ' ' + year + ', ' + (hour % 12 == 0 ? 12 : hour % 12) + ':' + min + (hour / 12 >= 1 ? "PM" : "AM");
};

const digestTransaction = ({ transaction, currentSeason }) => {
	if (transaction.status === 'failed') return { success: false };

	if (!transaction.roster_ids || transaction.roster_ids.length === 0) {
		console.warn("Transaction missing roster_ids:", transaction.transaction_id);
		return { success: false };
	}

	const handled = [];
	const transactionRosters = transaction.roster_ids;
	const bid = transaction.settings?.waiver_bid;
	const date = digestDate(transaction.status_updated);
	const season = parseInt(date.split(',')[0].split(' ')[2]);

	let digestedTransaction = {
		id: transaction.transaction_id,
		date,
		season,
		type: "waiver",
		rosters: transactionRosters,
		moves: []
	};

	if (transaction.type === "trade") {
		digestedTransaction.type = "trade";
		console.log("Digesting trade:", digestedTransaction);
	}

	if (season !== currentSeason) {
		digestedTransaction.previousOwners = true;
	}

	const adds = transaction.adds || {};
	const drops = transaction.drops || {};
	const draftPicks = transaction.draft_picks || [];

	for (let player in adds) {
		if (!player) continue;
		handled.push(player);
		digestedTransaction.moves.push(handleAdds(transactionRosters, adds, drops, player, bid));
	}

	for (let player in drops) {
		if (handled.includes(player)) continue;
		if (!player) continue;

		let move = new Array(transactionRosters.length).fill(null);
		move[transactionRosters.indexOf(drops[player])] = {
			type: "Dropped",
			player
		};
		digestedTransaction.moves.push(move);
	}

	for (let pick of draftPicks) {
		let move = new Array(transactionRosters.length).fill(null);
		move[transactionRosters.indexOf(pick.owner_id)] = {
			type: "Draft Pick",
			pick
		};
		digestedTransaction.moves.push(move);
	}

	return { digestedTransaction, season, success: true };
};

const handleAdds = (rosterIDs, adds, drops, player, bid) => {
	let move = new Array(rosterIDs.length).fill(null);

	const addedTo = adds[player];
	const droppedFrom = drops?.[player];

	if (droppedFrom !== undefined && droppedFrom !== addedTo) {
		move[rosterIDs.indexOf(droppedFrom)] = {
			type: "Dropped",
			player
		};
	}

	move[rosterIDs.indexOf(addedTo)] = {
		type: "Added",
		player,
		bid
	};

	return move;
};
