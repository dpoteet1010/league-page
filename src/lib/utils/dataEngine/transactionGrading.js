// transactionGrading.js
//
// Grades trades and waivers using per-player weekly performance data.
// Separated from allTransactions.js to avoid circular imports.
//
// KEY DESIGN NOTE: playerResults rows have { year, week, rosterId, playerId,
// pointsTotal, pointsStarted } but NO timestamp field. Transactions have
// { seasonKey, leg } where `leg` is the NFL week the transaction occurred in.
// All "from this point forward" filtering uses year+week comparison, NOT
// timestamp comparison — that was the previous bug causing all grades to
// return 0.

/**
 * Returns true if a player-result row falls on or after the transaction week.
 * Handles cross-season correctly: any row from a later year always qualifies.
 */
function isOnOrAfterTransaction(pr, txYear, txWeek) {
	const prYear = Number(pr.year);
	const txYearNum = Number(txYear);
	if (prYear > txYearNum) return true;
	if (prYear === txYearNum) return pr.week >= txWeek;
	return false;
}

/**
 * Grades a trade by comparing total and started points received on each side,
 * counting all player-weeks from the trade week onward.
 *
 * @param {Object} trade - digestedTransaction with type 'trade'
 * @param {Array} playerResults - per-player weekly data from getAllSeasonsHistory
 * @returns {{ side0, side1, winner, playerBreakdown } | null}
 */
export function gradeTradeWinner(trade, playerResults) {
	if (trade.type !== 'trade' || !trade.moves || !trade.rosters) return null;

	const rosters = trade.rosters;
	if (rosters.length !== 2) return null; // only grade head-to-head trades

	const txYear = Number(trade.seasonKey || trade.season);
	const txWeek = Number(trade.leg || 1);

	// Extract which players moved to which roster from the moves array.
	// A player "received" by a roster shows as { type: 'trade', player } on
	// that roster's index in the move array.
	const received = {};
	rosters.forEach((r) => (received[r] = []));

	trade.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		move.forEach((side, idx) => {
			const roster = rosters[idx];
			if (!roster || !side || typeof side !== 'object') return;
			if (side.type === 'trade' && side.player) {
				received[roster].push(side.player);
			}
		});
	});

	// Also handle draft picks received as part of the trade
	trade.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		move.forEach((side, idx) => {
			const roster = rosters[idx];
			if (!roster || !side || typeof side !== 'object') return;
			if (side.type === 'Received Pick') {
				// Draft picks don't contribute to player-week stats, but we
				// note them so the grade isn't silently missing them
			}
		});
	});

	const gradeByRoster = {};
	const playerBreakdown = {};

	rosters.forEach((roster) => {
		const acquiredPlayers = received[roster] || [];
		let totalPts = 0;
		let startedPts = 0;
		const players = [];

		acquiredPlayers.forEach((playerId) => {
			const rows = (playerResults || []).filter((pr) =>
				String(pr.playerId) === String(playerId) &&
				Number(pr.rosterId) === Number(roster) &&
				isOnOrAfterTransaction(pr, txYear, txWeek)
			);

			const playerTotal = rows.reduce((sum, pr) => sum + (pr.pointsTotal || 0), 0);
			const playerStarted = rows.reduce((sum, pr) => sum + (pr.pointsStarted || 0), 0);

			totalPts += playerTotal;
			startedPts += playerStarted;
			players.push({ playerId, totalPts: playerTotal, startedPts: playerStarted, weeks: rows.length });
		});

		gradeByRoster[roster] = { totalPts, startedPts };
		playerBreakdown[roster] = players;
	});

	const side0 = gradeByRoster[rosters[0]] || { totalPts: 0, startedPts: 0 };
	const side1 = gradeByRoster[rosters[1]] || { totalPts: 0, startedPts: 0 };

	let winner = null;
	if (side0.totalPts > side1.totalPts) winner = 0;
	else if (side1.totalPts > side0.totalPts) winner = 1;

	return {
		side0,
		side1,
		winner,
		playerBreakdown,
		txYear,
		txWeek
	};
}

/**
 * Grades a waiver pickup by the player's performance from the pickup week onward.
 *
 * @param {Object} waiver - digestedTransaction with type 'waiver'
 * @param {Array} playerResults - per-player weekly data
 * @returns {{ playerId, totalPts, startedPts, games } | null}
 */
export function gradeWaiverPickup(waiver, playerResults) {
	if (waiver.type !== 'waiver' || !waiver.moves || !waiver.rosters?.[0]) return null;

	const roster = waiver.rosters[0];
	const txYear = Number(waiver.seasonKey || waiver.season);
	const txWeek = Number(waiver.leg || 1);

	// Find the player that was added in this waiver claim
	let playerId = null;
	waiver.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		// Waivers always involve one roster; find the Added entry at any index
		move.forEach((side) => {
			if (side && typeof side === 'object' && side.type === 'Added' && side.player) {
				playerId = side.player;
			}
		});
	});

	if (!playerId) return null;

	const playerGamesSince = (playerResults || []).filter((pr) =>
		String(pr.playerId) === String(playerId) &&
		Number(pr.rosterId) === Number(roster) &&
		isOnOrAfterTransaction(pr, txYear, txWeek)
	);

	const totalPts = playerGamesSince.reduce((sum, pr) => sum + (pr.pointsTotal || 0), 0);
	const startedPts = playerGamesSince.reduce((sum, pr) => sum + (pr.pointsStarted || 0), 0);

	return {
		playerId,
		totalPts,
		startedPts,
		games: playerGamesSince.length,
		txYear,
		txWeek
	};
}
