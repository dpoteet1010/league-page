// allPlayerSeasonStats.js
//
// Fetches complete season point totals AND games-played counts for ALL
// NFL players via the Sleeper weekly stats API. Using all players
// (not just rostered ones) gives accurate replacement level rankings.
//
// Returns:
//   totals:      { [playerId]: totalPts }   (through `throughWeek`)
//   gamesPlayed: { [playerId]: weeksWithStats }
//   throughWeek: last week included in the totals
//
// "gamesPlayed" = number of weeks the player appeared in the stats
// API response. Players on IR or inactive typically don't appear.
// Bye weeks are excluded for everyone, so max is ~16 not 17.

const statsCache = {};

// Sleeper's regular season runs weeks 1-18 (17 games + 1 bye per team,
// same convention used for FINAL_POSSIBLE_WEEK elsewhere in this app).
const FINAL_REGULAR_SEASON_WEEK = 18;

/**
 * @param {string|number} year
 * @param {Object|null} scoringSettings - league.scoring_settings from Sleeper
 * @param {number|null} throughWeek - last week to include. Pass the number of
 *   COMPLETED weeks for an in-progress season so the live week's partial stats
 *   never leak into totals. Omit/null for a finished season (all weeks).
 * @returns {Promise<{ totals: Object, gamesPlayed: Object, throughWeek: number }>}
 */
export async function getSeasonStatTotals(year, scoringSettings, throughWeek = null) {
  const yearStr = String(year);
  const lastWeek = throughWeek == null || !Number.isFinite(Number(throughWeek))
    ? FINAL_REGULAR_SEASON_WEEK
    : Math.max(0, Math.min(Number(throughWeek), FINAL_REGULAR_SEASON_WEEK));

  // Cache key includes the week cap, so when a new week completes the
  // cap changes and the stats are refetched instead of served stale.
  const cacheKey = `${yearStr}-${lastWeek}`;
  if (statsCache[cacheKey]) return statsCache[cacheKey];

  const weekPromises = [];
  for (let week = 1; week <= lastWeek; week++) {
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

  const playerTotals      = {};
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

  const result = { totals: playerTotals, gamesPlayed: playerGamesPlayed, throughWeek: lastWeek };
  statsCache[cacheKey] = result;
  return result;
}
