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

  const transactionDataPromises = transactionRess.filter((res) => res && res.ok).map((res) => res.json());
  const transactionsDataJson = (await waitForAll(...transactionDataPromises).catch((err) => {
    debug.push(`Transaction JSON parse failed: ${err.message}`);
    return [];
  })) || [];

  let transactionsData = [];
  for (const chunk of transactionsDataJson) transactionsData = transactionsData.concat(chunk);
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
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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

  // Filter blank waivers — failed claims that slipped through with no actual adds
  const isWaiver = transaction.type !== 'trade';
  const hasAdds = transaction.adds && Object.keys(transaction.adds).length > 0;
  if (isWaiver && !hasAdds) return { success: false };

  const transactionRosters = transaction.roster_ids;
  const bid = transaction.settings?.waiver_bid;
  const timestamp = transaction.status_updated;
  const date = digestDate(timestamp);
  const season = new Date(timestamp).getFullYear();
  const leg = transaction.leg || 1;
  // seq: sequence number within the leg — used to order waivers processed
  // in the same week. Lower seq = processed first = picked player earlier.
  const seq = transaction.settings?.seq ?? null;

  const digestedTransaction = {
    id: transaction.transaction_id,
    date, timestamp, season, leg,
    type: transaction.type === 'trade' ? 'trade' : 'waiver',
    rosters: transactionRosters,
    moves: [],
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

// ── Composite trade detection ────────────────────────────────────────────────

function extractMovements(tx) {
  const received = {};
  const sent = {};
  (tx.moves || []).forEach((move) => {
    if (!Array.isArray(move)) return;
    let tradedPlayerId = null, receivingIdx = -1, sendingIdx = -1;
    move.forEach((side, idx) => {
      if (side && typeof side === 'object' && side.type === 'trade' && side.player) {
        tradedPlayerId = String(side.player);
        receivingIdx = idx;
      } else if (side === 'origin') {
        sendingIdx = idx;
      }
    });
    if (tradedPlayerId && receivingIdx >= 0 && tx.rosters[receivingIdx] != null) {
      received[tradedPlayerId] = tx.rosters[receivingIdx];
    }
    if (tradedPlayerId && sendingIdx >= 0 && tx.rosters[sendingIdx] != null) {
      sent[tradedPlayerId] = tx.rosters[sendingIdx];
    }
  });
  return { received, sent };
}

/**
 * FIX #1: verify pass-through by checking if the player actually played
 * for the intermediate team in the trade week. If they played → the two
 * trades are genuinely separate (player fully transferred before 2nd trade).
 * If they didn't play → true pass-through → composite trade.
 */
function isValidPassThrough(playerId, throughRoster, tradeTx, playerResults) {
  if (!playerResults || playerResults.length === 0) return true; // no data → assume pass-through

  const txYear = Number(tradeTx.seasonKey || tradeTx.season);
  const txWeek = Number(tradeTx.leg || 1);

  const playedForTeam = playerResults.some((pr) =>
    String(pr.playerId) === String(playerId) &&
    Number(pr.rosterId) === Number(throughRoster) &&
    Number(pr.year) === txYear &&
    Number(pr.week) === txWeek
  );

  // If they played for the team → NOT a pass-through → separate trades
  return !playedForTeam;
}

function findPassThrough(tx1, movements1, tx2, movements2, playerResults) {
  const passThrough = [];

  Object.entries(movements1.received).forEach(([playerId, roster]) => {
    if (movements2.sent[playerId] === roster &&
        isValidPassThrough(playerId, roster, tx2, playerResults)) {
      passThrough.push({ playerId, throughRoster: roster });
    }
  });
  Object.entries(movements2.received).forEach(([playerId, roster]) => {
    if (movements1.sent[playerId] === roster &&
        isValidPassThrough(playerId, roster, tx1, playerResults)) {
      passThrough.push({ playerId, throughRoster: roster });
    }
  });

  return passThrough;
}

function buildCompositeTrade(group) {
  const allReceived = {};
  const allSent = {};
  const managerIdsByRoster = {};
  const allRosterIds = new Set();

  group.forEach((tx) => {
    const movements = extractMovements(tx);
    (tx.rosters || []).forEach((r, idx) => {
      allRosterIds.add(r);
      if (tx.managerIds?.[idx]) managerIdsByRoster[r] = tx.managerIds[idx];
    });
    Object.entries(movements.received).forEach(([playerId, roster]) => {
      if (!allReceived[roster]) allReceived[roster] = [];
      if (!allReceived[roster].includes(playerId)) allReceived[roster].push(playerId);
    });
    Object.entries(movements.sent).forEach(([playerId, roster]) => {
      if (!allSent[roster]) allSent[roster] = [];
      if (!allSent[roster].includes(playerId)) allSent[roster].push(playerId);
    });
  });

  const teams = [];
  allRosterIds.forEach((roster) => {
    const received = allReceived[roster] || [];
    const sent = allSent[roster] || [];
    teams.push({
      roster,
      managerId: managerIdsByRoster[roster] || null,
      received,
      sent,
      netReceived: received.filter((p) => !sent.includes(p)),
      netSent: sent.filter((p) => !received.includes(p))
    });
  });

  const hasDraftPicks = group.some((tx) =>
    (tx.moves || []).some((move) =>
      Array.isArray(move) && move.some((s) => s && typeof s === 'object' && s.type === 'Received Pick')
    )
  );

  const firstTx = group[0];
  return {
    id: 'composite_' + group.map((tx) => tx.id).join('_'),
    type: 'trade',
    isComposite: true,
    constituentTradeIds: group.map((tx) => tx.id),
    seasonKey: firstTx.seasonKey,
    season: firstTx.season,
    leg: firstTx.leg,
    date: firstTx.date,
    timestamp: firstTx.timestamp,
    managerIds: [...allRosterIds].map((r) => managerIdsByRoster[r]).filter(Boolean),
    teams,
    hasDraftPicks,
    moves: []
  };
}

function detectAndMergeCompositeTrades(transactions, playerResults = []) {
  const composites = [];
  const compositeTradeIds = new Set();

  const tradesByKey = {};
  transactions.forEach((tx) => {
    if (tx.type !== 'trade') return;
    const key = `${tx.seasonKey || tx.season}-${tx.leg}`;
    if (!tradesByKey[key]) tradesByKey[key] = [];
    tradesByKey[key].push(tx);
  });

  Object.values(tradesByKey).forEach((weekTrades) => {
    if (weekTrades.length < 2) return;
    const n = weekTrades.length;
    const movementsArr = weekTrades.map((tx) => extractMovements(tx));

    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; };
    const union = (x, y) => { parent[find(x)] = find(y); };

    let hasAnyPassThrough = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (findPassThrough(weekTrades[i], movementsArr[i], weekTrades[j], movementsArr[j], playerResults).length > 0) {
          union(i, j);
          hasAnyPassThrough = true;
        }
      }
    }
    if (!hasAnyPassThrough) return;

    const components = {};
    weekTrades.forEach((tx, idx) => {
      const root = find(idx);
      if (!components[root]) components[root] = [];
      components[root].push(tx);
    });

    Object.values(components).forEach((group) => {
      if (group.length < 2) return;
      const composite = buildCompositeTrade(group);
      composites.push(composite);
      group.forEach((tx) => compositeTradeIds.add(tx.id));
    });
  });

  return { composites, compositeTradeIds };
}

  Object.values(groups).forEach((group) => {
    // Sort by seq ascending — seq is the official Sleeper processing order.
    // Fall back to timestamp if seq is unavailable.
    group.sort((a, b) => {
      const seqA = a.seq ?? Infinity;
      const seqB = b.seq ?? Infinity;
      if (seqA !== seqB) return seqA - seqB;
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    const claimedSoFar = new Set();
    group.forEach((tx) => {
      tx.claimedEarlierThisWeek = [...claimedSoFar];
      (tx.moves || []).forEach((move) => {
        if (!Array.isArray(move)) return;
        move.forEach((side) => {
          if (side && typeof side === 'object' && side.type === 'Added' && side.player) {
            claimedSoFar.add(String(side.player));
          }
        });
      });
    });
  });
}

// ── Main digest ──────────────────────────────────────────────────────────────

async function digestTransactions({ transactionsData, currentSeason, playerResults = [] }) {
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

    if (seasonKey == null) { skippedCount++; continue; }

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

  addClaimedEarlierContext(transactions);
  const { composites, compositeTradeIds } = detectAndMergeCompositeTrades(transactions, playerResults);

  transactions.forEach((tx) => {
    if (compositeTradeIds.has(tx.id)) {
      tx.isPartOfComposite = true;
      const parent = composites.find((c) => c.constituentTradeIds.includes(tx.id));
      if (parent) tx.compositeId = parent.id;
    }
  });
  composites.forEach((c) => transactions.push(c));
  debug.push(`Detected ${composites.length} composite multi-team trade(s) across ${compositeTradeIds.size} constituent trades.`);

  return { transactions, totals, debug };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getTransactionHistory(startingLeagueID = mainLeagueID, playerResults = []) {
  const debug = [];
  const nflState = await getNflState().catch((err) => {
    debug.push(`getNflState failed: ${err.message}`);
    return null;
  });
  let week = 18;
  if (nflState?.season_type === 'regular') week = nflState.week;

  const { transactionsData, currentSeason, debug: combDebug } = await combThroughTransactions(week, startingLeagueID);
  debug.push(...combDebug);

  const { transactions, totals, debug: digestDebug } = await digestTransactions({
    transactionsData, currentSeason, playerResults
  });
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
      !tx.isPartOfComposite &&
      tx.managerIds?.includes(managerIdA) &&
      tx.managerIds?.includes(managerIdB)
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}
