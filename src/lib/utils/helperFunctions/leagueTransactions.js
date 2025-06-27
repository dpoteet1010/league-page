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
	if (nflState?.season_type == 'regular') {
		week = nflState.week;
	}

	const { transactionsData, currentSeason } = await combThroughTransactions(week, leagueID).catch(() => {});

	const { transactions, totals } = await digestTransactions({ transactionsData, currentSeason });

	const transactionPackage = {
		transactions,
		totals
	};

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

		return { trades, waivers };
	}
	return passedTransactions;
};

const combThroughTransactions = async (week, currentLeagueID) => {
	week = week > 0 ? week : 1;

	const leagueIDs = [];
	let currentSeason = null;

	while (currentLeagueID && currentLeagueID != 0) {
		const leagueData = await getLeagueData(currentLeagueID).catch(() => {});
		leagueIDs.push(currentLeagueID);

		if (!currentSeason) {
			currentSeason = leagueData.season;
		}

		currentLeagueID = leagueData.previous_league_id;
	}

	const transactionPromises = [];
	for (const singleLeagueID of leagueIDs) {
		while (week > 0) {
			transactionPromises.push(fetch(`https://api.sleeper.app/v1/league/${singleLeagueID}/transactions/${week}`, { compress: true }));
			week--;
		}
		week = 18;
	}

	const transactionRess = await waitForAll(...transactionPromises).catch(() => {});
	const transactionDataPromises = [];

	for (const transactionRes of transactionRess) {
		if (!transactionRes || !transactionRes.ok) {
			continue;
		}
		transactionDataPromises.push(transactionRes.json());
	}

	const transactionsDataJson = await waitForAll(...transactionDataPromises).catch(() => {});

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
	transactionsData = transactionsData.concat(legacyTransactionList);

	return { transactionsData, currentSeason };
};

const digestTransactions = async ({ transactionsData, currentSeason }) => {
	const processedTransactions = [];

	for (const transaction of transactionsData) {
		const { digestedTransaction, success } = digestTransaction({ transaction, currentSeason });
		if (success) {
			processedTransactions.push(digestedTransaction);
		}
	}

	processedTransactions.sort((a, b) => b.timestamp - a.timestamp);

	const totals = {
		trades: processedTransactions.filter(t => t.type === "trade").length,
		waivers: processedTransactions.filter(t => t.type === "waiver").length,
	};

	return { transactions: processedTransactions, totals };
};

const digestTransactions = async ({ transactionsData, currentSeason }) => {
  const transactions = [];
  const totals = {
    allTime: {},    // manager -> { trade, waiver }
    seasons: {}     // season -> roster -> { trade, waiver, rosterID }
  };

  const leagueTeamManagers = await getLeagueTeamManagers();

  // Sort by status_updated descending (like original)
  const transactionOrder = transactionsData.sort((a, b) => b.status_updated - a.status_updated);

  for (const transaction of transactionOrder) {
    const { digestedTransaction, season, success } = digestTransaction({ transaction, currentSeason });
    if (!success) continue;

    transactions.push(digestedTransaction);

    // Defensive check for legacy or edge seasons in teamManagersMap
    let seasonToUse = season;
    if (!leagueTeamManagers.teamManagersMap[seasonToUse]) {
      // Try fallback
      seasonToUse--;
      if (!leagueTeamManagers.teamManagersMap[seasonToUse]) {
        seasonToUse += 2;
      }
    }

    for (const roster of digestedTransaction.rosters) {
      const type = digestedTransaction.type;

      if (!leagueTeamManagers.teamManagersMap[seasonToUse]) continue; // no manager data, skip totals

      for (const manager of leagueTeamManagers.teamManagersMap[seasonToUse][roster]?.managers ?? []) {
        // Initialize allTime for manager
        if (!totals.allTime[manager]) {
          totals.allTime[manager] = { trade: 0, waiver: 0 };
        }
        totals.allTime[manager][type] = (totals.allTime[manager][type] || 0) + 1;
      }

      // Initialize seasons[seasonToUse][roster]
      if (!totals.seasons[seasonToUse]) totals.seasons[seasonToUse] = {};
      if (!totals.seasons[seasonToUse][roster]) {
        totals.seasons[seasonToUse][roster] = { trade: 0, waiver: 0, rosterID: roster };
      }
      totals.seasons[seasonToUse][roster][type] = (totals.seasons[seasonToUse][roster][type] || 0) + 1;
    }
  }

  return { transactions, totals };
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

const digestDate = (tStamp) => {
	const a = new Date(tStamp);
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const year = a.getFullYear();
	const month = months[a.getMonth()];
	const date = a.getDate();
	const hour = a.getHours();
	const min = a.getMinutes();
	return month + ' ' + date + ' ' + year + ', ' + (hour % 12 == 0 ? 12 : hour % 12) + ':' + (min < 10 ? '0' + min : min) + (hour / 12 >= 1 ? "PM" : "AM");
};
