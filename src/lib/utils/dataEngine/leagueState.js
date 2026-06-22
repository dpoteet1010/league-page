import { resolvePlayoffPlacements, getRosterIdsInBracket } from './allPlayoffs.js';

export function getLeagueState(seasonMatchupsData, managersForYear, leagueData, playoffBrackets) {
	const debug = [];

	if (!seasonMatchupsData?.matchupWeeks?.length) {
		debug.push('getLeagueState: no matchupWeeks supplied — returning empty result.');
		return { standings: [], weeklyResults: [], playerResults: [], podiums: { championId: null, lastPlaceId: null }, placementsByRosterId: {}, debug };
	}

	const regularSeasonLength = Number(
		seasonMatchupsData.regularSeasonLength ?? (leagueData?.settings?.playoff_week_start - 1) ?? 14
	);
	debug.push(`Using regularSeasonLength = ${regularSeasonLength}`);

	// ---- 1. Discover every roster that actually appears in the matchup data ----
	const rosterIds = new Set(Object.keys(managersForYear || {}).map(Number));
	seasonMatchupsData.matchupWeeks.forEach(({ matchups }) => {
		Object.values(matchups || {}).forEach((pair) => {
			(pair || []).forEach((team) => {
				if (team?.roster_id != null) rosterIds.add(Number(team.roster_id));
			});
		});
	});

	// ---- 1b. Winners vs losers bracket classification ----
	const winnersRosterIds = playoffBrackets ? getRosterIdsInBracket(playoffBrackets.winnersBracket) : new Set();
	const losersRosterIds = playoffBrackets ? getRosterIdsInBracket(playoffBrackets.losersBracket) : new Set();
	if (playoffBrackets) {
		debug.push(`Winners bracket rosters: ${[...winnersRosterIds].join(', ') || 'none'}`);
		debug.push(`Losers bracket rosters: ${[...losersRosterIds].join(', ') || 'none'}`);
	}

	// ---- 2. Initialize standings shell ----
	const standings = {};
	rosterIds.forEach((rosterId) => {
		const meta = managersForYear?.[rosterId] || {};
		standings[rosterId] = {
			rosterId,
			name: meta.name || `Team ${rosterId}`,
			avatar: meta.avatar || '',
			managerNames: meta.managerNames || '',
			regularSeason: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0, streak: { type: null, count: 0 } },
			playoffs: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0 },
			finalPlacement: null,
		};
	});

	if (!managersForYear || Object.keys(managersForYear).length === 0) {
		debug.push('Warning: managersForYear was empty — team names will fall back to "Team {rosterId}".');
	}

	const applyToBucket = (bucketA, bucketB, pointsA, pointsB, resultA) => {
		bucketA.fptsFor += pointsA;
		bucketA.fptsAgainst += pointsB;
		bucketB.fptsFor += pointsB;
		bucketB.fptsAgainst += pointsA;
		if (resultA === 'W') { bucketA.wins += 1; bucketB.losses += 1; }
		else if (resultA === 'L') { bucketA.losses += 1; bucketB.wins += 1; }
		else { bucketA.ties += 1; bucketB.ties += 1; }
	};

	// ---- 3. Build the weekly engine ----
	const weeklyResults = [];

	seasonMatchupsData.matchupWeeks.forEach(({ week, matchups }) => {
		const weekNum = Number(week);
		if (!matchups || Number.isNaN(weekNum)) return;
		const isPlayoffWeek = weekNum > regularSeasonLength;

		Object.values(matchups).forEach((pair) => {
			if (!Array.isArray(pair) || pair.length !== 2) return;

			const [teamA, teamB] = pair;
			const rA = Number(teamA.roster_id);
			const rB = Number(teamB.roster_id);
			if (!standings[rA] || !standings[rB]) return;

			const pointsA = Number(teamA.points || 0);
			const pointsB = Number(teamB.points || 0);

			let resultA, resultB;
			if (pointsA > pointsB) { resultA = 'W'; resultB = 'L'; }
			else if (pointsB > pointsA) { resultA = 'L'; resultB = 'W'; }
			else { resultA = 'T'; resultB = 'T'; }

			let bracket = null;
			let countsTowardPlayoffStats = false;

			if (isPlayoffWeek) {
				if (!playoffBrackets) {
					countsTowardPlayoffStats = true;
				} else if (winnersRosterIds.has(rA) && winnersRosterIds.has(rB)) {
					bracket = 'winners';
					countsTowardPlayoffStats = true;
				} else if (losersRosterIds.has(rA) && losersRosterIds.has(rB)) {
					bracket = 'losers';
					countsTowardPlayoffStats = false;
				} else {
					bracket = 'unknown';
					countsTowardPlayoffStats = false;
					debug.push(`Week ${weekNum}: couldn't classify pairing roster ${rA} vs roster ${rB} into either bracket.`);
				}
			}

			weeklyResults.push({ week: weekNum, rosterId: rA, opponentRosterId: rB, pointsFor: pointsA, pointsAgainst: pointsB, result: resultA, isPlayoffs: isPlayoffWeek, bracket });
			weeklyResults.push({ week: weekNum, rosterId: rB, opponentRosterId: rA, pointsFor: pointsB, pointsAgainst: pointsA, result: resultB, isPlayoffs: isPlayoffWeek, bracket });

			if (!isPlayoffWeek) {
				applyToBucket(standings[rA].regularSeason, standings[rB].regularSeason, pointsA, pointsB, resultA);
			} else if (countsTowardPlayoffStats) {
				applyToBucket(standings[rA].playoffs, standings[rB].playoffs, pointsA, pointsB, resultA);
			}
		});
	});

	debug.push(`Built ${weeklyResults.length} weekly result rows across ${seasonMatchupsData.matchupWeeks.length} weeks.`);
	debug.push('Playoff stats only include games where both rosters were in the winners bracket — losers/toilet-bowl bracket games are excluded from wins/losses/PF/PA.');

	// ---- 4. Current win/loss streak (regular season only) ----
	rosterIds.forEach((rosterId) => {
		const rosterWeeks = weeklyResults
			.filter((r) => r.rosterId === rosterId && !r.isPlayoffs)
			.sort((a, b) => a.week - b.week);

		let type = null;
		let count = 0;
		for (let i = rosterWeeks.length - 1; i >= 0; i--) {
			const { result } = rosterWeeks[i];
			if (result === 'T') break;
			if (type === null) { type = result; count = 1; }
			else if (result === type) count += 1;
			else break;
		}
		standings[rosterId].regularSeason.streak = { type, count };
	});

	// ---- 5. Playoff placements ----
	let podiums = { championId: null, lastPlaceId: null };
	let placementsByRosterId = {};

	if (playoffBrackets) {
		const numRosters = playoffBrackets.numRosters ?? rosterIds.size;
		const resolved = resolvePlayoffPlacements(playoffBrackets.winnersBracket, playoffBrackets.losersBracket, numRosters);
		podiums = { championId: resolved.championId, lastPlaceId: resolved.lastPlaceId };
		placementsByRosterId = resolved.placementsByRosterId;
		debug.push(...resolved.debug);

		Object.values(standings).forEach((team) => {
			team.finalPlacement = placementsByRosterId[team.rosterId] ?? null;
		});
	} else {
		debug.push('No playoffBrackets supplied — skipping placement resolution.');
	}

	// ---- 6. Per-player results, tagged with year and manager IDs ----
	const playerResults = (seasonMatchupsData.playerResults || []).map((pr) => ({
		...pr,
		year: seasonMatchupsData.year
	}));

	return {
		standings: Object.values(standings).sort((a, b) => {
			if (a.finalPlacement != null && b.finalPlacement != null) return a.finalPlacement - b.finalPlacement;
			if (a.finalPlacement != null) return -1;
			if (b.finalPlacement != null) return 1;
			return b.regularSeason.wins - a.regularSeason.wins || b.regularSeason.fptsFor - a.regularSeason.fptsFor;
		}),
		weeklyResults,
		playerResults,
		podiums,
		placementsByRosterId,
		debug,
	};
}
