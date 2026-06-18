// utils/leagueState.js

/**
 * Fetches basic league info, rosters, and user configurations from Sleeper.
 */
export async function getSleeperBaseData(leagueId) {
  try {
    const [leagueRes, rostersRes, usersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)
    ]);

    if (!leagueRes.ok || !rostersRes.ok || !usersRes.ok) {
      throw new Error('Failed to fetch foundational data from Sleeper APIs.');
    }

    const leagueInfo = await leagueRes.json();
    const rosters = await rostersRes.json();
    const users = await usersRes.json();

    return { leagueInfo, rosters, users };
  } catch (error) {
    console.error(`Error in getSleeperBaseData for League ${leagueId}:`, error);
    throw error;
  }
}

/**
 * Fetches and aggregates matchup metrics up to a specific target week.
 */
export async function getSleeperWeeklyState(leagueId, targetWeek) {
  const weeklyFetchPromises = [];
  
  // Build concurrent requests up to the requested week threshold
  for (let week = 1; week <= targetWeek; week++) {
    weeklyFetchPromises.push(
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`)
        .then(res => res.ok ? res.json() : [])
        .then(data => ({ week, data }))
    );
  }

  const allWeeksData = await Promise.all(weeklyFetchPromises);
  
  // Aggregate player scoring data and points maps
  const matchupAggregates = {};

  allWeeksData.forEach(({ week, data }) => {
    data.forEach(teamMatchup => {
      const { roster_id, matchup_id, points } = teamMatchup;
      if (!matchupAggregates[roster_id]) {
        matchupAggregates[roster_id] = { pointsByWeek: {}, matchupsByWeek: {} };
      }
      matchupAggregates[roster_id].pointsByWeek[week] = points || 0;
      matchupAggregates[roster_id].matchupsByWeek[week] = matchup_id;
    });
  });

  return matchupAggregates;
}

/**
 * Combines foundational arrays and aggregated performance metrics into a clean snapshot object.
 */
export function buildLeagueSnapshot({ leagueInfo, rosters, users, matchupAggregates }) {
  // Map users by ID for efficient lookup
  const userMap = users.reduce((acc, user) => {
    acc[user.user_id] = {
      username: user.display_name,
      teamName: user.metadata?.team_name || user.display_name
    };
    return acc;
  }, {});

  // Build clean roster models
  const compiledRosters = rosters.map(roster => {
    const owner = userMap[roster.owner_id] || { username: 'Unknown Owner', teamName: 'Unnamed Team' };
    const performance = matchupAggregates[roster.roster_id] || { pointsByWeek: {}, matchupsByWeek: {} };

    return {
      rosterId: roster.roster_id,
      ownerId: roster.owner_id,
      username: owner.username,
      teamName: owner.teamName,
      settings: {
        wins: roster.settings?.wins || 0,
        losses: roster.settings?.losses || 0,
        ties: roster.settings?.ties || 0,
        fpts: roster.settings?.fpts || 0,
        fptsDecimal: roster.settings?.fpts_decimal || 0,
      },
      weeklyPoints: performance.pointsByWeek,
      weeklyMatchupIds: performance.matchupsByWeek
    };
  });

  return {
    leagueId: leagueInfo.league_id,
    season: leagueInfo.season,
    name: leagueInfo.name,
    totalRosters: leagueInfo.total_rosters,
    status: leagueInfo.status,
    currentWeek: leagueInfo.settings?.leg || 1,
    rosters: compiledRosters
  };
}
