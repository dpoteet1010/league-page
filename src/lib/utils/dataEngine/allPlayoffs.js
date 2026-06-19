// allPlayoffs.js
//
// Pulls a season's raw winners/losers bracket data (live Sleeper API or
// legacy local files) and resolves it into final placements WITHOUT
// reconstructing the full bracket tree. Every match with a `p` field is a
// placement game — its `w`/`l` already give us the final rank for those two
// rosters directly, regardless of how byes shaped earlier rounds. That's
// what makes this robust to byes (no tree-walking needed) and to
// in-progress brackets (undecided matches are just skipped, not guessed at).

import { legacyWinnersBrackets } from '$lib/utils/helperFunctions/legacyWinnersBrackets.js';
import { legacyLosersBrackets } from '$lib/utils/helperFunctions/legacyLosersBrackets.js';

const LEGACY_YEARS = ['2023', '2024'];

/**
 * Fetches the raw bracket arrays for a season — legacy local file or live Sleeper API.
 * @param {string|number} leagueId
 * @returns {Promise<{ winnersBracket: Array, losersBracket: Array, debug: string[] }>}
 */
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
 * @param {Array} winnersBracket
 * @param {Array} losersBracket
 * @param {number} numRosters - total teams in the league that season
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

  (winnersBracket || []).forEach((match) => {
    if (match?.p == null) return; // not a placement game, just a bracket-advancement game
    if (match.w == null || match.l == null) {
      debug.push(`Winners match m=${match.m} has p=${match.p} but isn't decided yet (missing w/l) — skipping.`);
      return;
    }
    applyPlacement(match.w, match.p);
    applyPlacement(match.l, match.p + 1);
  });

  if (numRosters) {
    (losersBracket || []).forEach((match) => {
      if (match?.p == null) return;
      if (match.w == null || match.l == null) {
        debug.push(`Losers match m=${match.m} has p=${match.p} but isn't decided yet (missing w/l) — skipping.`);
        return;
      }
      applyPlacement(match.l, numRosters - match.p + 1);
      applyPlacement(match.w, numRosters - match.p);
    });
  } else {
    debug.push('No numRosters provided — skipping losers bracket placement resolution.');
  }

  const championEntry = Object.entries(placementsByRosterId).find(([, place]) => place === 1);
  const lastPlaceEntry = numRosters
    ? Object.entries(placementsByRosterId).find(([, place]) => place === numRosters)
    : null;

  debug.push(`Resolved ${Object.keys(placementsByRosterId).length} placements out of ${numRosters || '?'} rosters.`);

  return {
    placementsByRosterId,
    championId: championEntry ? Number(championEntry[0]) : null,
    lastPlaceId: lastPlaceEntry ? Number(lastPlaceEntry[0]) : null,
    debug
  };
}
