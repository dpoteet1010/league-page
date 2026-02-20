// league-page/src/routes/api/test-snapshot/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { buildLeagueSnapshot } from '$lib/analytics/buildLeagueSnapshot';
import { legacyLeagueData } from '$lib/utils/helperFunctions/legacyLeagueData';
import { leagueID } from '$lib/utils/leagueInfo'; // <-- use the same import that worked before

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
    const week1Matchups = snapshot.seasons[currentYear]?.matchups?.[1]?.length ?? 0;
    logs.push(`⚔️ Matchups in week 1 of ${currentYear}: ${week1Matchups}`);

    // Return both the logs and snapshot summary in the API response
    return new Response(
      JSON.stringify({
        logs,
        snapshotSummary: {
          generatedAt: snapshot.generatedAt,
          seasons: seasons.map((y) => ({
            year: y,
            rosters: snapshot.seasons[y]?.rosters?.length ?? 0,
            matchups: Object.keys(snapshot.seasons[y]?.matchups ?? {}).length
          }))
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    logs.push(`❌ Error building snapshot: ${(err as Error).message}`);
    return new Response(
      JSON.stringify({ logs, error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
