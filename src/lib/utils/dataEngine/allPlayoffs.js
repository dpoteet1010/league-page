// allPlayoffs.js
//
// Pulls a season's raw winners/losers bracket data (live Sleeper API or
// legacy local files) and resolves it into final placements WITHOUT
// reconstructing the full bracket tree. Every match with a `p` field is a
// placement game — its `w`/`l` already give us the final rank for those two
// rosters directly.

import { legacyWinnersBrackets } from '$lib/utils/helperFunctions/legacyWinnersBrackets.js';
import { legacyLosersBrackets } from '$lib/utils/helperFunctions/legacyLosersBrackets.js';

const LEGACY_YEARS = ['2023', '2024'];

export async function getLeaguePlayoffs(leagueId) {
	const debug = [];
	const idStr = leagueId?.toString();

	if (LEGACY_YEARS.includes(idStr)) {
		const winnersBracket = legacyWinnersBrackets?.[idStr] || [];
		const losersBracket = legacyLosersBrackets?.[idStr] || [];
		debug.push(`Loaded legacy brackets for ${idStr}: ${winnersBracket.length} winners matches, ${losersBracket.length} losers matches.`);
		return { winnersBracket, losersBracket, debug };
	}

	try {
		const [winnersRes, losersRes] = await Promise.all([
			fetch(`https://api.sleeper.app/v1/league/${leagueId}/winners_bracket`, { compress: true }),
			fetch(`https://api.sleeper.app/v1/league/${leagueId}/losers_bracket`, { compress: true })
		]);

		const winnersBracket = winnersRes.ok ? await winnersRes.json() : [];
		const losersBracket = losersRes.ok ? await losersRes.json() : [];

		debug.push(`Fetched live brackets for league ${leagueId}: ${winnersBracket?.length || 0} winners matches, ${losersBracket?.length || 0} losers matches.`);

		return { winnersBracket: winnersBracket || [], losersBracket: losersBracket || [], debug };
	} catch (err) {
		debug.push(`getLeaguePlayoffs fetch failed: ${err.message}`);
		return { winnersBracket: [], losersBracket: [], debug };
	}
}

/**
 * Resolves raw bracket arrays into final placements.
 *
 * Winners bracket: a match with `p` decided means winner finishes rank `p`,
 * loser finishes rank `p + 1` (p:1 -> 1st/2nd, p:3 -> 3rd/4th, etc.)
 *
 * Losers bracket (toilet bowl): uses the SAME local p-numbering (p:1, p:3,
 * p:5...) but it's relative to ITS OWN bracket, not the league overall.
 * To get absolute placement, it's offset by however many teams made the
 * winners bracket — e.g. in a 12-team league with a 6-team playoff field,
 * the losers bracket's own "p:1" game decides 7th/8th place
 * (offset 6 + p:1 = 7th), not 1st/2nd. The winner of the ENTIRE losers
 * bracket therefore finishes 7th, not 1st.
 *
 * @param {Array} winnersBracket
 * @param {Array} losersBracket
 * @param {number} numRosters - used only as a sanity cross-check in debug logs
 * @returns {{ placementsByRosterId: Object, championId: number|null, lastPlaceId: number|null, debug: string[] }}
 */
export function resolvePlayoffPlacements(winnersBracket, losersBracket, numRosters) {
	const debug = [];
	const placementsByRosterId = {};

	const applyPlacement = (rosterId, place) => {
		if (rosterId == null || place == null) return;
		if (placementsByRosterId[rosterId] != null) return; // don't let anything overwrite a confirmed placement
		placementsByRosterId[rosterId] = place;
	};

	const applyFromBracket = (bracket, label, offset) => {
		(bracket || []).forEach((match) => {
			if (match?.p == null) return; // not a placement game, just a bracket-advancement game
			if (match.w == null || match.l == null) {
				debug.push(`${label} match m=${match.m} has p=${match.p} but isn't decided yet (missing w/l) — skipping.`);
				return;
			}
			applyPlacement(match.w, offset + match.p);
			applyPlacement(match.l, offset + match.p + 1);
		});
	};

	const winnersTeamCount = getRosterIdsInBracket(winnersBracket).size;
	debug.push(`Winners bracket has ${winnersTeamCount} teams — losers bracket placements offset by ${winnersTeamCount}.`);

	applyFromBracket(winnersBracket, 'Winners', 0);
	applyFromBracket(losersBracket, 'Losers', winnersTeamCount);

	const resolvedPlaces = Object.values(placementsByRosterId);
	const maxPlace = resolvedPlaces.length ? Math.max(...resolvedPlaces) : null;

	if (numRosters && maxPlace != null && maxPlace !== numRosters) {
		debug.push(`Warning: highest resolved placement is ${maxPlace}, but numRosters is ${numRosters} — some rosters may be missing a final placement.`);
	}

	const championEntry = Object.entries(placementsByRosterId).find(([, place]) => place === 1);
	const lastPlaceEntry = maxPlace != null
		? Object.entries(placementsByRosterId).find(([, place]) => place === maxPlace)
		: null;

	debug.push(`Resolved ${resolvedPlaces.length} placements (highest place number found: ${maxPlace ?? 'none'}).`);

	return {
		placementsByRosterId,
		championId: championEntry ? Number(championEntry[0]) : null,
		lastPlaceId: lastPlaceEntry ? Number(lastPlaceEntry[0]) : null,
		debug
	};
}

/**
 * Returns the set of roster_ids that appear anywhere in a raw bracket array
 * (as t1, t2, w, or l — ignoring {w: matchId}/{l: matchId} placeholder
 * references).
 */
export function getRosterIdsInBracket(bracket) {
	const ids = new Set();
	(bracket || []).forEach((match) => {
		[match?.t1, match?.t2, match?.w, match?.l].forEach((val) => {
			if (typeof val === 'number') ids.add(val);
		});
	});
	return ids;
}
