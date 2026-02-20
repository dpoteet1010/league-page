// lib/analytics/buildLeagueSnapshot.ts

import { legacySeasons } from '$lib/utils/helperFunctions/legacyLeagueData.js'

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

const BASE_URL = 'https://api.sleeper.app/v1'

// -------------------- Sleeper fetch with error handling --------------------
async function sleeperFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status} on ${url}`)
  return res.json()
}

// -------------------- Fetch current season data from Sleeper --------------------
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

  const drafts = await sleeperFetch<any[]>(`${BASE_URL}/league/${leagueId}/drafts`)
  const draft = drafts.length
    ? await sleeperFetch(`${BASE_URL}/draft/${drafts[0].draft_id}`)
    : null

  return {
    league,
    users,
    rosters,
    matchups,
    transactions,
    draft
  }
}

// -------------------- Normalize season data --------------------
function normalizeSeason(season: SeasonData) {
  season.matchups ||= {}
  season.transactions ||= {}
  season.draft ||= null
  season.rosters ||= []
  season.users ||= []
  season.league ||= {}
}

// -------------------- Main function: build snapshot in memory --------------------
export async function buildLeagueSnapshot(
  leagueId: string
): Promise<LeagueSnapshot> {
  // Start with legacy data
  const seasons: Record<string, SeasonData> = {}
  for (const year in legacySeasons) {
    seasons[year] = legacySeasons[year]
    normalizeSeason(seasons[year])
  }

  // Fetch current season from Sleeper
  const currentSeason = await fetchCurrentSeason(leagueId)
  const currentYear = currentSeason.league.season
  normalizeSeason(currentSeason)

  // Merge current season
  seasons[currentYear] = currentSeason

  return {
    generatedAt: new Date().toISOString(),
    seasons
  }
}
