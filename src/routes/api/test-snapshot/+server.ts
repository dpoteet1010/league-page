// league-page/src/routes/api/test-snapshot/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { buildLeagueSnapshot } from '$lib/analytics/buildLeagueSnapshot';
import { leagueID, legacyLeagueData } from '$lib/utils/helperFunctions/legacyLeagueData';

export const GET: RequestHandler = async () => {
  const logs: string[] = [];

  try {
    logs.push('🟢 Starting buildLeagueSnapshot');

    // Build the snapshot using legacy data for historical seasons
    const snapshot = await buildLeagueSnapshot(leagueID, legacyLeagueData);
    logs.push('✅ Snapshot built successfully');

    const seasons = Object.keys(snapshot.seasons);
    logs.push(`📅 Seasons included in snapshot: ${seasons.join(', ')}`);

    // Example: log number of rosters for current season
    const currentYear = seasons[seasons.length - 1];
    const currentRosters = snapshot.seasons[currentYear]?.rosters?.length ?? 0;
    logs.push(`👥 Rosters in current season (${currentYear}): ${currentRosters}`);

    // Example: log number of matchups for week 1
    const week1Matchups =
      snapshot.seasons[currentYear]?.matchups?.[1]?.length ?? 0;
    logs.push(`⚔️ Matchups in week 1 of ${currentYear}: ${week1Matchups}`);

    // Return the snapshot along with the logs
    return new Response(
      JSON.stringify({
        logs,
        snapshot
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    logs.push(`❌ Error building snapshot: ${err.message}`);
    return new Response(
      JSON.stringify({ logs, error: err.message }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
};
