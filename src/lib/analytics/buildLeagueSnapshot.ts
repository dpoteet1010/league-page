// lib/analytics/buildLeagueSnapshot.ts

type SeasonData = {
  league: any
  users: any[]
  rosters: any[]
  matchups: Record<number, any[]>
  transactions: Record<number, any[]>
  draft: any | null
}

export type LeagueSnapshot = {
  generatedAt: string
  seasons: Record<string, SeasonData>
}

const BASE_URL = "https://api.sleeper.app/v1"

async function sleeperFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Sleeper API error: ${res.status} at ${url}`)
  }
  return res.json()
}

async function fetchCurrentSeason(leagueId: string): Promise<SeasonData> {
  console.log(`[Snapshot] Fetching league info for ${leagueId}`)
  const league = await sleeperFetch(`${BASE_URL}/league/${leagueId}`)
  const users = await sleeperFetch(`${BASE_URL}/league/${leagueId}/users`)
  const rosters = await sleeperFetch(`${BASE_URL}/league/${leagueId}/rosters`)

  const totalWeeks = league.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : 14

  const matchups: Record<number, any[]> = {}
  const transactions: Record<number, any[]> = {}

  for (let week = 1; week <= totalWeeks; week++) {
    console.log(`[Snapshot] Fetching week ${week} matchups and transactions`)
    matchups[week] = await sleeperFetch(
      `${BASE_URL}/league/${leagueId}/matchups/${week}`
    )
    transactions[week] = await sleeperFetch(
      `${BASE_URL}/league/${leagueId}/transactions/${week}`
    )
  }

  const drafts = await sleeperFetch<any[]>(`${BASE_URL}/league/${leagueId}/drafts`)
  let draft = null
  if (drafts.length) {
    draft = await sleeperFetch(`${BASE_URL}/draft/${drafts[0].draft_id}`)
    console.log(`[Snapshot] Draft found: ${drafts[0].draft_id}, picks: ${draft.picks?.length || 0}`)
  } else {
    console.log(`[Snapshot] No draft found for league ${leagueId}`)
  }

  console.log(`[Snapshot] Finished fetching current season data: ${league.name} (${league.season})`)
  return {
    league,
    users,
    rosters,
    matchups,
    transactions,
    draft
  }
}

export async function buildLeagueSnapshot(
  leagueId: string,
  legacySeasons?: Record<string, SeasonData>
): Promise<LeagueSnapshot> {

  console.log(`[Snapshot] Starting league snapshot for ${leagueId}`)
  const currentSeason = await fetchCurrentSeason(leagueId)
  const currentYear = currentSeason.league.season

  const seasons: Record<string, SeasonData> = {
    ...(legacySeasons ?? {}),
    [currentYear]: currentSeason
  }

  console.log(`[Snapshot] Seasons in snapshot: ${Object.keys(seasons).join(', ')}`)
  for (const year of Object.keys(seasons)) {
    const s = seasons[year]
    console.log(`[Snapshot] Year: ${year}, League: ${s.league.name}, Status: ${s.league.status}`)
    console.log(`[Snapshot] Users: ${s.users.length}, Rosters: ${s.rosters.length}`)
    console.log(`[Snapshot] Total weeks of matchups: ${Object.keys(s.matchups).length}`)
    console.log(`[Snapshot] Total weeks of transactions: ${Object.keys(s.transactions).length}`)
    console.log(`[Snapshot] Draft present: ${s.draft ? 'Yes' : 'No'}`)
    if (s.draft?.picks) console.log(`[Snapshot] Draft picks: ${s.draft.picks.length}`)
  }

  console.log(`[Snapshot] League snapshot generation complete at ${new Date().toISOString()}`)
  return {
    generatedAt: new Date().toISOString(),
    seasons
  }
}
