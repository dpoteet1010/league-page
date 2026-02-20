import { json } from '@sveltejs/kit'
import { buildLeagueSnapshot } from '$lib/analytics/buildLeagueSnapshot'
import { legacyLeagueData } from '$lib/data/legacy'

export async function GET() {
  try {
    const leagueId = process.env.SLEEPER_LEAGUE_ID

    if (!leagueId) {
      throw new Error('Missing SLEEPER_LEAGUE_ID')
    }

    const snapshot = await buildLeagueSnapshot(
      leagueId,
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
