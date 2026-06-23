// parGrading.js
//
// Points Above Replacement (PAR) grading for trades and waivers.
//
// Gap 1 fix: personal replacement baseline uses ONLY pre-trade week data,
// projected forward at a per-week pace, so early-season trades aren't
// graded with hindsight about how backup players performed later.
//
// Gap 3 fix: trades containing draft picks are flagged and the grade
// narrative notes that pick value is excluded.
//
// Composite trades: graded using net movements only (pass-through players
// already cancelled out in allTransactions.js).

const DEFAULT_ROSTER_POSITIONS = [
	'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
	'BN', 'BN', 'BN', 'BN', 'BN', 'BN'
];

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
const TOTAL_POSSIBLE_WEEKS = 18;

export function parseStarterSlots(rosterPositions) {
	const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DEF: 0 };
	(rosterPositions || DEFAULT_ROSTER_POSITIONS).forEach((pos) => {
		const p = pos.toUpperCase();
		if (p === 'SUPER_FLEX' || p === 'SUPERFLEX') slots.FLEX += 1;
		else if (slots[p] !== undefined) slots[p] += 1;
	});
	return slots;
}

function normalizePosition(position, playerId) {
	if (!position) {
		if (playerId && String(playerId).length <= 3 && /^[A-Z]+$/.test(String(playerId))) return 'DEF';
		return null;
	}
	const p = position.toUpperCase();
	if (p === 'QB') return 'QB';
	if (p === 'RB') return 'RB';
	if (p === 'WR') return 'WR';
	if (p === 'TE') return 'TE';
	if (p === 'K') return 'K';
	if (p === 'DEF' || p === 'DST') return 'DEF';
	return null;
}

export function buildSeasonPARTables(seasonPlayerResults, allPlayersData, rosterPositions, numTeams) {
	const debug = [];
	const slots = parseStarterSlots(rosterPositions || DEFAULT_ROSTER_POSITIONS);
	debug.push(`Starter slots: ${JSON.stringify(slots)}, numTeams: ${numTeams}`);

	// Aggregate season totals per player
	const playerSeasonTotals = {};
	seasonPlayerResults.forEach((pr) => {
		const id = String(pr.playerId);
		if (!playerSeasonTotals[id]) playerSeasonTotals[id] = 0;
		playerSeasonTotals[id] += pr.pointsTotal || 0;
	});

	// Group by position
	const playersByPosition = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
	Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
		const playerInfo = allPlayersData[playerId];
		const position = normalizePosition(playerInfo?.position, playerId);
		if (!position || !playersByPosition[position]) return;
		playersByPosition[position].push({ playerId, totalPts, position });
	});

	Object.values(playersByPosition).forEach((group) => group.sort((a, b) => b.totalPts - a.totalPts));

	// League-wide replacement levels
	const replacementLevels = {};
	['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach((pos) => {
		const starterCount = (slots[pos] || 0) * numTeams;
		const repPlayer = playersByPosition[pos][starterCount];
		replacementLevels[pos] = repPlayer ? repPlayer.totalPts : 0;
		debug.push(`${pos}: ${starterCount} starter slots, ${playersByPosition[pos].length} rostered, replacement = ${(replacementLevels[pos] || 0).toFixed(1)} pts`);
	});

	// FLEX replacement
	if ((slots.FLEX || 0) > 0) {
		const flexPool = [];
		FLEX_ELIGIBLE.forEach((pos) => {
			const dedicatedSlots = (slots[pos] || 0) * numTeams;
			playersByPosition[pos].slice(dedicatedSlots).forEach((p) => flexPool.push(p));
		});
		flexPool.sort((a, b) => b.totalPts - a.totalPts);
		const flexRepIdx = (slots.FLEX || 0) * numTeams;
		const flexRepPlayer = flexPool[flexRepIdx];
		replacementLevels.FLEX = flexRepPlayer ? flexRepPlayer.totalPts : 0;
		debug.push(`FLEX replacement = ${(replacementLevels.FLEX || 0).toFixed(1)} pts`);

		FLEX_ELIGIBLE.forEach((pos) => {
			if (replacementLevels.FLEX < replacementLevels[pos]) {
				replacementLevels[pos] = replacementLevels.FLEX;
				debug.push(`${pos} replacement lowered to FLEX level ${replacementLevels.FLEX.toFixed(1)}`);
			}
		});
	}

	// Per-player PAR
	const playerPAR = {};
	Object.entries(playerSeasonTotals).forEach(([playerId, totalPts]) => {
		const playerInfo = allPlayersData[playerId];
		const position = normalizePosition(playerInfo?.position, playerId);
		if (!position) return;
		const repLevel = replacementLevels[position] ?? 0;
		playerPAR[playerId] = {
			position,
			totalPts,
			replacementLevel: repLevel,
			par: totalPts - repLevel,
			name: playerInfo?.full_name ||
				(playerInfo ? `${playerInfo.first_name || ''} ${playerInfo.last_name || ''}`.trim() : null) ||
				`Player ${playerId}`
		};
	});

	debug.push(`Built PAR entries for ${Object.keys(playerPAR).length} players.`);
	return { replacementLevels, playerPAR, slots, numTeams, debug };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function proratedReplacementPts(replacementLevel, txWeek) {
	const weeksRemaining = Math.max(TOTAL_POSSIBLE_WEEKS - Number(txWeek) + 1, 1);
	return replacementLevel * (weeksRemaining / TOTAL_POSSIBLE_WEEKS);
}

function isOnOrAfterTransaction(pr, txYear, txWeek) {
	if (Number(pr.year) !== Number(txYear)) return false;
	return Number(pr.week) >= Number(txWeek);
}

/**
 * GAP 1 FIX: computes the correct baseline for an acquired player.
 *
 * Two possible sources:
 *   1. Personal replacement — the best player already on the receiving
 *      roster at this position, measured ONLY from pre-trade weeks (weeks
 *      before the transaction), projected forward at that player's pace.
 *      Using pre-trade data means we don't grade managers with hindsight
 *      about how their backups performed after the trade.
 *   2. League replacement — prorated from the season-wide replacement
 *      level if the roster had no depth at this position, or if their
 *      personal backup was below league replacement.
 *
 * The higher of the two is used as the baseline.
 *
 * @returns {{ baselineValue: number, baselineSource: 'personal'|'league' }}
 */
function getBaselineValue(playerResults, receivingRoster, position, txYear, txWeek, parTables, allPlayersData) {
	const leagueRepLevel = parTables?.replacementLevels?.[position] ?? 0;
	const proratedLeagueRep = proratedReplacementPts(leagueRepLevel, txWeek);

	// Week 1 trades have no pre-trade data — always use league replacement
	if (Number(txWeek) <= 1) {
		return { baselineValue: proratedLeagueRep, baselineSource: 'league' };
	}

	// Aggregate pre-trade production per player at this position on this roster
	const preTradeTotals = {};
	playerResults
		.filter((pr) =>
			Number(pr.rosterId) === Number(receivingRoster) &&
			Number(pr.year) === Number(txYear) &&
			Number(pr.week) < Number(txWeek)
		)
		.forEach((pr) => {
			const pos = normalizePosition(allPlayersData[String(pr.playerId)]?.position, pr.playerId);
			if (pos !== position) return;
			const id = String(pr.playerId);
			if (!preTradeTotals[id]) preTradeTotals[id] = 0;
			preTradeTotals[id] += pr.pointsTotal || 0;
		});

	const bestPreTrade = Object.values(preTradeTotals).sort((a, b) => b - a)[0] ?? null;

	if (bestPreTrade == null) {
		// Genuine hole at this position — use league replacement
		return { baselineValue: proratedLeagueRep, baselineSource: 'league' };
	}

	// Project personal replacement forward at pre-trade pace
	const weeksBeforeTrade = Number(txWeek) - 1;
	const perWeekRate = bestPreTrade / weeksBeforeTrade;
	const weeksRemaining = Math.max(TOTAL_POSSIBLE_WEEKS - Number(txWeek) + 1, 1);
	const projectedPersonalRep = perWeekRate * weeksRemaining;

	if (projectedPersonalRep > proratedLeagueRep) {
		return { baselineValue: projectedPersonalRep, baselineSource: 'personal' };
	}
	return { baselineValue: proratedLeagueRep, baselineSource: 'league' };
}

function buildTradeNarrative({ side0, side1, parDifference, winner, managerNames, hasDraftPicks }) {
	const flags = [];
	[...(side0.players || []), ...(side1.players || [])].forEach((p) => {
		if (p.weeks <= 2 && p.totalPts < 10) flags.push({ type: 'injury-suspected', name: p.name, side: p.side });
		else if (p.weeks > 2 && p.startedPct < 0.5) flags.push({ type: 'underutilized', name: p.name, side: p.side });
	});

	let grade;
	if (winner === null) grade = 'even';
	else if (parDifference > 40) grade = 'lopsided';
	else if (parDifference > 20) grade = 'clear';
	else grade = 'close';

	const winnerName = winner === 0 ? managerNames[0] : winner === 1 ? managerNames[1] : null;
	const loserName  = winner === 0 ? managerNames[1] : winner === 1 ? managerNames[0] : null;
	const winnerPAR  = winner === 0 ? side0.parTotal  : side1.parTotal;
	const loserPAR   = winner === 0 ? side1.parTotal  : side0.parTotal;

	let summary;
	switch (grade) {
		case 'even':     summary = `This trade was essentially a wash — both sides extracted similar value above replacement.`; break;
		case 'lopsided': summary = `${winnerName} dominated this trade, generating ${winnerPAR.toFixed(1)} PAR vs ${loserName}'s ${loserPAR.toFixed(1)}.`; break;
		case 'clear':    summary = `${winnerName} came out clearly ahead — ${winnerPAR.toFixed(1)} PAR vs ${loserName}'s ${loserPAR.toFixed(1)}.`; break;
		case 'close':    summary = `Close trade — ${winnerName} edged ${loserName} ${winnerPAR.toFixed(1)} to ${loserPAR.toFixed(1)} PAR.`; break;
	}

	// Context flags
	const injuryFlag = flags.find((f) => f.type === 'injury-suspected');
	const utilFlag   = flags.find((f) => f.type === 'underutilized');
	if (injuryFlag) summary += ` Note: ${injuryFlag.name} may have been injured, which could affect this grade.`;
	else if (utilFlag) summary += ` Note: ${utilFlag.name} was underutilized despite being rostered.`;

	// GAP 3: draft pick note
	if (hasDraftPicks) summary += ' This trade included draft picks — grade reflects player value only.';

	// Baseline source note (helps newsletter writer understand the context)
	const personalBaselines = [...(side0.players || []), ...(side1.players || [])]
		.filter((p) => p.baselineSource === 'personal');
	if (personalBaselines.length > 0) {
		summary += ` Baseline adjusted for roster depth on ${personalBaselines.length} player(s).`;
	}

	return { grade, flags, summary };
}

// ── Public grading functions ─────────────────────────────────────────────────

/**
 * Grades a standard 2-team trade using PAR with Gap 1 (pre-trade baseline)
 * and Gap 3 (draft pick flagging) fixes applied.
 */
export function gradeTradeByPAR(trade, parTables, playerResults, allPlayersData, managerNames = []) {
	if (!trade.moves || !trade.rosters || trade.rosters.length !== 2) return null;
	if (!parTables) return null;

	const rosters = trade.rosters;
	const txYear  = Number(trade.seasonKey || trade.season);
	const txWeek  = Number(trade.leg || 1);

	// GAP 3: detect draft picks
	const hasDraftPicks = (trade.moves || []).some((move) =>
		Array.isArray(move) && move.some((side) =>
			side && typeof side === 'object' && side.type === 'Received Pick'
		)
	);

	// Extract which players each roster received
	const received = {};
	rosters.forEach((r) => (received[r] = []));
	trade.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		move.forEach((side, idx) => {
			const roster = rosters[idx];
			if (!roster || !side || typeof side !== 'object') return;
			if (side.type === 'trade' && side.player) received[roster].push(side.player);
		});
	});

	const gradeByRoster = {};

	rosters.forEach((roster) => {
		const acquiredPlayers = received[roster] || [];
		let parTotal = 0, rawTotal = 0, rawStarted = 0;
		const players = [];

		acquiredPlayers.forEach((playerId) => {
			const playerInfo = allPlayersData[String(playerId)];
			const position = normalizePosition(playerInfo?.position, playerId);

			// GAP 1 FIX: use pre-trade baseline, not full-season
			const { baselineValue, baselineSource } = getBaselineValue(
				playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
			);

			// Actual post-trade production on this roster
			const rows = (playerResults || []).filter((pr) =>
				String(pr.playerId) === String(playerId) &&
				Number(pr.rosterId) === Number(roster) &&
				isOnOrAfterTransaction(pr, txYear, txWeek)
			);

			const playerRawTotal   = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
			const playerStartedPts = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
			const weeksStarted     = rows.filter((pr) => pr.pointsStarted > 0).length;
			const playerPAR        = playerRawTotal - baselineValue;

			parTotal   += playerPAR;
			rawTotal   += playerRawTotal;
			rawStarted += playerStartedPts;

			players.push({
				playerId,
				name:          parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
				position:      position || '?',
				par:           playerPAR,
				baselineValue,
				baselineSource,
				totalPts:      playerRawTotal,
				startedPts:    playerStartedPts,
				weeks:         rows.length,
				weeksStarted,
				startedPct:    rows.length > 0 ? weeksStarted / rows.length : 0
			});
		});

		gradeByRoster[roster] = { parTotal, rawTotal, rawStarted, players };
	});

	const side0 = { ...gradeByRoster[rosters[0]], roster: rosters[0] };
	const side1 = { ...gradeByRoster[rosters[1]], roster: rosters[1] };
	(side0.players || []).forEach((p) => { p.side = 0; });
	(side1.players || []).forEach((p) => { p.side = 1; });

	let winner = null;
	const parDifference = Math.abs(side0.parTotal - side1.parTotal);
	if (side0.parTotal > side1.parTotal)      winner = 0;
	else if (side1.parTotal > side0.parTotal) winner = 1;

	const narrative = buildTradeNarrative({ side0, side1, parDifference, winner, managerNames, hasDraftPicks });

	return { side0, side1, winner, parDifference, narrative, hasDraftPicks, txYear, txWeek };
}

/**
 * Grades a waiver pickup using PAR with Gap 1 (pre-trade baseline) fix.
 */
export function gradeWaiverByPAR(waiver, parTables, playerResults, allPlayersData) {
	if (!waiver.moves || !waiver.rosters?.[0]) return null;
	if (!parTables) return null;

	const roster = waiver.rosters[0];
	const txYear = Number(waiver.seasonKey || waiver.season);
	const txWeek = Number(waiver.leg || 1);

	let playerId = null;
	let droppedId = null;
	waiver.moves.forEach((move) => {
		if (!Array.isArray(move)) return;
		move.forEach((side) => {
			if (!side || typeof side !== 'object') return;
			if (side.type === 'Added'   && side.player) playerId  = side.player;
			if (side.type === 'Dropped' && side.player) droppedId = side.player;
		});
	});

	if (!playerId) return null;

	const playerInfo = allPlayersData[String(playerId)];
	const position   = normalizePosition(playerInfo?.position, playerId);

	// GAP 1 FIX: use pre-trade baseline
	const { baselineValue, baselineSource } = getBaselineValue(
		playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
	);

	const rows = (playerResults || []).filter((pr) =>
		String(pr.playerId)  === String(playerId) &&
		Number(pr.rosterId)  === Number(roster) &&
		isOnOrAfterTransaction(pr, txYear, txWeek)
	);

	const totalPts    = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
	const startedPts  = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
	const weeks       = rows.length;
	const weeksStarted = rows.filter((pr) => pr.pointsStarted > 0).length;
	const par = totalPts - baselineValue;

	let gradeLabel, gradeSummary;
	if (par > 40)       { gradeLabel = 'elite';   gradeSummary = `Elite pickup — massive production above replacement at ${position || '?'}.`; }
	else if (par > 20)  { gradeLabel = 'strong';  gradeSummary = `Strong pickup — solid value above replacement at ${position || '?'}.`; }
	else if (par > 5)   { gradeLabel = 'solid';   gradeSummary = `Solid pickup — modest but meaningful value above replacement at ${position || '?'}.`; }
	else if (par > -5)  { gradeLabel = 'neutral'; gradeSummary = `Break-even pickup — roughly replacement-level production at ${position || '?'}.`; }
	else                { gradeLabel = 'poor';    gradeSummary = `Below replacement level at ${position || '?'} — this pickup didn't pay off.`; }

	const injurySuspected = weeks <= 2 && totalPts < 10 && txWeek < 14;
	if (injurySuspected) gradeSummary += ' Possible injury may have limited contribution.';

	if (baselineSource === 'personal') {
		gradeSummary += ` Baseline adjusted for existing roster depth at ${position || '?'}.`;
	}

	const droppedInfo = droppedId ? allPlayersData[String(droppedId)] : null;

	return {
		playerId,
		name:          parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
		position:      position || '?',
		par,
		baselineValue,
		baselineSource,
		totalPts,
		startedPts,
		weeks,
		weeksStarted,
		startedPct:    weeks > 0 ? weeksStarted / weeks : 0,
		gradeLabel,
		gradeSummary,
		droppedId,
		droppedName:   droppedInfo?.full_name || (droppedId ? `Player ${droppedId}` : null),
		txYear,
		txWeek
	};
}

/**
 * Grades a composite (multi-team) trade using net movements for each team.
 * Pass-through players have already been cancelled out in allTransactions.js.
 */
export function gradeCompositeTrade(compositeTrade, parTables, playerResults, allPlayersData) {
	if (!compositeTrade.isComposite || !parTables || !compositeTrade.teams) return null;

	const txYear = Number(compositeTrade.seasonKey || compositeTrade.season);
	const txWeek = Number(compositeTrade.leg || 1);

	const teamGrades = compositeTrade.teams.map((team) => {
		const { roster, managerId, netReceived } = team;
		let parTotal = 0, rawTotal = 0, rawStarted = 0;
		const players = [];

		(netReceived || []).forEach((playerId) => {
			const playerInfo = allPlayersData[String(playerId)];
			const position   = normalizePosition(playerInfo?.position, playerId);

			// GAP 1 FIX applied to composite trades too
			const { baselineValue, baselineSource } = getBaselineValue(
				playerResults, roster, position, txYear, txWeek, parTables, allPlayersData
			);

			const rows = (playerResults || []).filter((pr) =>
				String(pr.playerId)  === String(playerId) &&
				Number(pr.rosterId)  === Number(roster) &&
				isOnOrAfterTransaction(pr, txYear, txWeek)
			);

			const playerTotal  = rows.reduce((s, pr) => s + (pr.pointsTotal   || 0), 0);
			const playerStarted = rows.reduce((s, pr) => s + (pr.pointsStarted || 0), 0);
			const weeksStarted  = rows.filter((pr) => pr.pointsStarted > 0).length;
			const playerPAR     = playerTotal - baselineValue;

			parTotal   += playerPAR;
			rawTotal   += playerTotal;
			rawStarted += playerStarted;

			players.push({
				playerId,
				name:          parTables.playerPAR[String(playerId)]?.name || playerInfo?.full_name || `Player ${playerId}`,
				position:      position || '?',
				par:           playerPAR,
				baselineValue,
				baselineSource,
				totalPts:      playerTotal,
				startedPts:    playerStarted,
				weeks:         rows.length,
				weeksStarted,
				startedPct:    rows.length > 0 ? weeksStarted / rows.length : 0
			});
		});

		return { roster, managerId, parTotal, rawTotal, rawStarted, players };
	});

	// Rank all teams by PAR
	const ranked = [...teamGrades].sort((a, b) => b.parTotal - a.parTotal);
	const winnerRoster = ranked[0]?.parTotal !== ranked[1]?.parTotal ? ranked[0]?.roster : null;

	return {
		teamGrades,
		ranked,
		winnerRoster,
		isComposite: true,
		hasDraftPicks: compositeTrade.hasDraftPicks,
		txYear,
		txWeek
	};
}
