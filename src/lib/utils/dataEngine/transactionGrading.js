// transactionGrading.js
//
// Grades trades and waivers using per-player weekly performance data.
// Separated from allTransactions.js to avoid circular imports.

/**
 * Grades a trade by comparing points received on each side.
 * @param {Object} trade - digestedTransaction with type 'trade'
 * @param {Array} playerResults - per-player weekly data from getAllSeasonsHistory
 * @returns {Object} { side0, side1, winner } with totalPts and startedPts for each
 */
export function gradeTradeWinner(trade, playerResults) {
	if (trade.type !== 'trade' || !trade.moves || !trade.rosters) return null;

	const rosters = trade.rosters;
	if (rosters.length !== 2) return null;

	const tradeDate = trade.timestamp;
	const playersByRoster = {};
	rosters.forEach((r) => (playersByRoster[r] = { sent: [], received: [] }));

	// Extract players from the moves array
	trade.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		move.forEach((side, idx) => {
			if (side == null || typeof side !== 'object') return;
			const roster = rosters[idx];
			if (!roster) return;

			if (side.type === 'trade') {
				playersByRoster[roster].received.push(side.player);
			} else if (side === 'origin') {
				const playerData = trade.moves[trade.moves.length - 1]; // last move might have player id
				if (playerData && playerData[idx] && playerData[idx].player) {
					playersByRoster[roster].sent.push(playerData[idx].player);
				}
			}
		});
	});

	const gradeByRoster = {};
	rosters.forEach((roster) => {
		const acquired = playersByRoster[roster].received || [];
		const totalPts = acquired.reduce((sum, playerId) => {
			return sum + (playerResults || [])
				.filter((pr) => 
					pr.playerId === playerId && 
					pr.rosterId === roster && 
					pr.pointsTotal != null && 
					pr.timestamp != null && 
					new Date(pr.timestamp).getTime() >= tradeDate
				)
				.reduce((s, pr) => s + pr.pointsTotal, 0);
		}, 0);

		const startedPts = acquired.reduce((sum, playerId) => {
			return sum + (playerResults || [])
				.filter((pr) => 
					pr.playerId === playerId && 
					pr.rosterId === roster && 
					pr.pointsStarted != null && 
					pr.timestamp != null && 
					new Date(pr.timestamp).getTime() >= tradeDate
				)
				.reduce((s, pr) => s + pr.pointsStarted, 0);
		}, 0);

		gradeByRoster[roster] = { totalPts, startedPts };
	});

	const side0 = gradeByRoster[rosters[0]] || { totalPts: 0, startedPts: 0 };
	const side1 = gradeByRoster[rosters[1]] || { totalPts: 0, startedPts: 0 };

	let winner = null;
	if (side0.totalPts > side1.totalPts) winner = 0;
	else if (side1.totalPts > side0.totalPts) winner = 1;

	return { side0, side1, winner };
}

/**
 * Grades a waiver pickup by the player's performance from pickup date onward.
 * @param {Object} waiver - digestedTransaction with type 'waiver'
 * @param {Array} playerResults - per-player weekly data
 * @returns {Object} { playerId, totalPts, startedPts, games }
 */
export function gradeWaiverPickup(waiver, playerResults) {
	if (waiver.type !== 'waiver' || !waiver.moves || !waiver.rosters[0]) return null;

	const roster = waiver.rosters[0];
	const pickupDate = waiver.timestamp;
	let playerId = null;

	waiver.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		const sideData = move[0];
		if (sideData && typeof sideData === 'object' && sideData.type === 'Added') {
			playerId = sideData.player;
		}
	});

	if (!playerId) return null;

	const playerGamesSince = (playerResults || [])
		.filter((pr) => 
			pr.playerId === playerId && 
			pr.rosterId === roster && 
			pr.timestamp != null && 
			new Date(pr.timestamp).getTime() >= pickupDate
		);

	const totalPts = playerGamesSince.reduce((sum, pr) => sum + (pr.pointsTotal || 0), 0);
	const startedPts = playerGamesSince.reduce((sum, pr) => sum + (pr.pointsStarted || 0), 0);

	return { playerId, totalPts, startedPts, games: playerGamesSince.length };
}
