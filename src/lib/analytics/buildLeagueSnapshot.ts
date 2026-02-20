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
    throw new Error(`Sleeper API error: ${res.status}`)
  }

  return res.json()
}

async function fetchCurrentSeason(leagueId: string): Promise<SeasonData> {
  const league = await sleeperFetch(`${BASE_URL}/league/${leagueId}`)
  const users = await sleeperFetch(`${BASE_URL}/league/${leagueId}/users`)
  const rosters = await sleeperFetch(`${BASE_URL}/league/${leagueId}/rosters`)

  const totalWeeks =
    league.settings?.playoff_week_start
      ? league.settings.playoff_week_start - 1
      : 14

  const matchups: Record<number, any[]> = {}
  const transactions: Record<number, any[]> = {}

  for (let week = 1; week <= totalWeeks; week++) {
    matchups[week] = await sleeperFetch(
      `${BASE_URL}/league/${leagueId}/matchups/${week}`
    )

    transactions[week] = await sleeperFetch(
      `${BASE_URL}/league/${leagueId}/transactions/${week}`
    )
  }

  const drafts = await sleeperFetch<any[]>(
    `${BASE_URL}/league/${leagueId}/drafts`
  )

  let draft = null
  if (drafts.length) {
    draft = await sleeperFetch(
      `${BASE_URL}/draft/${drafts[0].draft_id}`
    )
  }

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

  const currentSeason = await fetchCurrentSeason(leagueId)

  const currentYear = currentSeason.league.season

  const seasons: Record<string, SeasonData> = {
    ...(legacySeasons ?? {}),
    [currentYear]: currentSeason
  }

  return {
    generatedAt: new Date().toISOString(),
    seasons
  }
}
