// allRosterStats.js
//
// Pulls fpts (actual fantasy points scored) and ppts (potential points if
// optimal lineup had been set) per manager per season. Used for Lineup IQ:
// how close did a manager get to their team's maximum possible output.
//
// LineupIQ = fpts / ppts — 1.0 = perfect lineup management every week,
// lower = left points on the bench.

import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters.js';

/**
 * @param {Array} seasons - [{ year, leagueId }] from allTimeHistory.seasons
 * @param {Object} rosterToManagerByYear - { [year]: { [rosterId]: managerId } }
 * @returns {Promise<Object>} { [managerId]: { [year]: { fpts, ppts, lineupIQ } } }
 */
export async function getAllRosterStats(seasons, rosterToManagerByYear) {
  const debug = [];
  const byManager = {};

  for (const { year, leagueId } of seasons) {
    const yearStr = String(year);
    const rosterMap = rosterToManagerByYear[yearStr];
    if (!rosterMap) {
      debug.push(`[${yearStr}] No roster→manager map available — skipping.`);
      continue;
    }

    const rostersResult = await getLeagueRosters(leagueId).catch((err) => {
      debug.push(`[${yearStr}] getLeagueRosters failed: ${err.message}`);
      return null;
    });

    if (!rostersResult?.rosters) {
      debug.push(`[${yearStr}] No rosters returned.`);
      continue;
    }

    Object.entries(rostersResult.rosters).forEach(([rosterId, roster]) => {
      const managerId = rosterMap[String(rosterId)];
      if (!managerId) return;

      const settings = roster.settings || {};
      const fpts = Number(settings.fpts || 0) + Number(settings.fpts_decimal || 0) / 100;
      const ppts = Number(settings.ppts || 0) + Number(settings.ppts_decimal || 0) / 100;
      const lineupIQ = ppts > 0 ? fpts / ppts : null;

      if (!byManager[managerId]) byManager[managerId] = {};
      byManager[managerId][yearStr] = { fpts, ppts, lineupIQ };
    });

    debug.push(`[${yearStr}] Roster stats loaded for ${Object.keys(rostersResult.rosters).length} rosters.`);
  }

  return { byManager, debug };
}
