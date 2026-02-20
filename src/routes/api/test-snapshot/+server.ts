// src/routes/api/test-snapshot/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { buildLeagueSnapshot } from '$lib/analytics/buildLeagueSnapshot';
import { leagueID } from '$lib/utils/leagueInfo';
import { legacySeasons } from '$lib/utils/helperFunctions/legacyLeagueData';

export const GET: RequestHandler = async () => {
  try {
    console.log(`[Snapshot] Starting league snapshot for leagueID: ${leagueID}`);

    const snapshot = await buildLeagueSnapshot(leagueID, legacySeasons);

    console.log(`[Snapshot] Completed snapshot generation`);
    console.log(`[Snapshot] Seasons included: ${Object.keys(snapshot.seasons).join(', ')}`);

    // Example logging of current season summary
    const currentYear = snapshot.seasons[leagueID]?.league?.season || Object.keys(snapshot.seasons).pop();
    const currentSeason = snapshot.seasons[currentYear!];
    console.log(`[Snapshot] Current season year: ${currentYear}`);
    console.log(`[Snapshot] Number of users: ${currentSeason.users.length}`);
    console.log(`[Snapshot] Number of rosters: ${currentSeason.rosters.length}`);
    console.log(`[Snapshot] Matchups loaded for weeks: ${Object.keys(currentSeason.matchups).join(', ')}`);
    console.log(`[Snapshot] Transactions loaded for weeks: ${Object.keys(currentSeason.transactions).join(', ')}`);
    console.log(`[Snapshot] Draft available: ${currentSeason.draft ? 'Yes' : 'No'}`);

    return new Response(JSON.stringify(snapshot, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[Snapshot] Error generating snapshot:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
