// allPlayerSeasonStats.js
//
// Fetches complete season point totals AND games-played counts for ALL
// NFL players via the Sleeper weekly stats API. Using all players
// (not just rostered ones) gives accurate replacement level rankings.
//
// Returns:
//   totals:      { [playerId]: totalSeasonPts }
//   gamesPlayed: { [playerId]: weeksWithStats }
//
// "gamesPlayed" = number of weeks the player appeared in the stats
// API response. Players on IR or inactive typically don't appear.
// Bye weeks are excluded for everyone, so max is ~16 not 17.

const statsCache = {};

/**
 * @param {string|number} year
 * @param {Object|null} scoringSettings - league.scoring_settings from Sleeper
 * @returns {Promise<{ totals: Object, gamesPlayed: Object }>}
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

  const playerTotals     = {};
  const playerGamesPlayed = {};

  weeklyStatsArr.forEach((weekStats) => {
    if (!weekStats || typeof weekStats !== 'object') return;

    Object.entries(weekStats).forEach(([playerId, stats]) => {
      if (!stats || typeof stats !== 'object') return;

      // Count this week as a game played regardless of points
      // (player appeared in API response = they had a stat line this week)
      playerGamesPlayed[playerId] = (playerGamesPlayed[playerId] || 0) + 1;

      // Calculate fantasy points using league scoring settings
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
        playerTotals[playerId] = (playerTotals[playerId] || 0) + weekPts;
      }
    });
  });

  const result = { totals: playerTotals, gamesPlayed: playerGamesPlayed };
  statsCache[yearStr] = result;
  return result;
}
