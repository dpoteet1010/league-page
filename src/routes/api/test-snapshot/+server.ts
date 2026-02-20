import { json } from '@sveltejs/kit'
import { buildLeagueSnapshot } from '$lib/analytics/buildLeagueSnapshot'
import { leagueID } from '$lib/utils/leagueInfo.js' // <-- adjust path if needed
import { legacyLeagueData } from '$lib/data/legacy' // adjust if needed

export async function GET() {
  try {
    const snapshot = await buildLeagueSnapshot(
      leagueID,
      legacyLeagueData
    )

    return json({
      success: true,
      generatedAt: snapshot.generatedAt,
      leagueName: snapshot.league?.name,
      totalUsers: snapshot.users?.length,
      totalRosters: snapshot.rosters?.length,
      totalWeeks: Object.keys(snapshot.matchups).length,
      sampleWeek1Matchups: snapshot.matchups[1]?.length,
      hasDraft: !!snapshot.draft,
      hasLegacy: !!snapshot.legacy
    })
  } catch (error: any) {
    console.error(error)

    return json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    )
  }
}
