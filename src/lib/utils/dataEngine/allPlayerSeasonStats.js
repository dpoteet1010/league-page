// allPlayerSeasonStats.js
//
// Fetches complete season point totals for ALL NFL players using the
// Sleeper weekly stats API. Unlike playerResults (which only captures
// players while rostered), this includes every player regardless of
// roster status — fixing the replacement level calculation for players
// who spent time on waivers.
//
// Points are calculated using the league's actual scoring_settings so
// the rankings match what happened in your league, not standard scoring.

const statsCache = {};

/**
 * Fetches and totals fantasy points for every NFL player in a season.
 *
 * Fetches all 17 weeks from the Sleeper stats API and applies the league's
 * scoring_settings to each raw stat. Results are cached in memory so
 * switching seasons doesn't re-fetch.
 *
 * @param {string|number} year - NFL season year (e.g. 2025)
 * @param {Object} scoringSettings - league.scoring_settings from Sleeper API
 * @returns {Promise<Object>} { [playerId]: totalSeasonPts }
 */
export async function getSeasonStatTotals(year, scoringSettings) {
  const yearStr = String(year);

  if (statsCache[yearStr]) return statsCache[yearStr];

  const weekPromises = [];
  for (let week = 1; week <= 17; week++) {
    weekPromises.push(
      fetch(
        `https://api.sleeper.app/v1/stats/nfl/regular/${yearStr}/${week}`,
        { compress: true }
      )
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
    );
  }

  const weeklyStatsArr = await Promise.all(weekPromises);
  const playerTotals = {};

  weeklyStatsArr.forEach((weekStats) => {
    if (!weekStats || typeof weekStats !== 'object') return;

    Object.entries(weekStats).forEach(([playerId, stats]) => {
      if (!stats || typeof stats !== 'object') return;

      let weekPts = 0;

      if (scoringSettings) {
        Object.entries(scoringSettings).forEach(([statKey, weight]) => {
          const statVal = stats[statKey];
          if (statVal != null && weight != null && typeof statVal === 'number') {
            weekPts += statVal * weight;
          }
        });
      }

      if (weekPts !== 0) {
        if (!playerTotals[playerId]) playerTotals[playerId] = 0;
        playerTotals[playerId] += weekPts;
      }
    });
  });

  statsCache[yearStr] = playerTotals;
  return playerTotals;
}
