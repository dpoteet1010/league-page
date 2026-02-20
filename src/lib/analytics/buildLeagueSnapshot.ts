// lib/analytics/buildLeagueSnapshot.ts

// ---------------------------------
// Types
// ---------------------------------

export type LeagueSnapshot = {
  generatedAt: string
  league: any
  users: any[]
  rosters: any[]
  matchups: Record<number, any[]>
  transactions: Record<number, any[]>
  draft: any | null
  legacy: any | null
}

// ---------------------------------
// Sleeper Helpers
// ---------------------------------

const BASE_URL = "https://api.sleeper.app/v1"

async function sleeperFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Sleeper API error: ${res.status}`)
  }

  return res.json()
}

async function fetchLeague(leagueId: string) {
  return sleeperFetch(`${BASE_URL}/league/${leagueId}`)
}

async function fetchUsers(leagueId: string) {
  return sleeperFetch(`${BASE_URL}/league/${leagueId}/users`)
}

async function fetchRosters(leagueId: string) {
  return sleeperFetch(`${BASE_URL}/league/${leagueId}/rosters`)
}

async function fetchMatchups(leagueId: string, week: number) {
  return sleeperFetch(`${BASE_URL}/league/${leagueId}/matchups/${week}`)
}

async function fetchTransactions(leagueId: string, week: number) {
  return sleeperFetch(`${BASE_URL}/league/${leagueId}/transactions/${week}`)
}

async function fetchDraft(leagueId: string) {
  const drafts = await sleeperFetch<any[]>(
    `${BASE_URL}/league/${leagueId}/drafts`
  )

  if (!drafts.length) return null

  return sleeperFetch(`${BASE_URL}/draft/${drafts[0].draft_id}`)
}

// ---------------------------------
// Utilities
// ---------------------------------

function getRegularSeasonWeeks(league: any): number {
  return league.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : 14
}

async function fetchAllMatchups(
  leagueId: string,
  totalWeeks: number
) {
  const result: Record<number, any[]> = {}

  for (let week = 1; week <= totalWeeks; week++) {
    result[week] = await fetchMatchups(leagueId, week)
  }

  return result
}

async function fetchAllTransactions(
  leagueId: string,
  totalWeeks: number
) {
  const result: Record<number, any[]> = {}

  for (let week = 1; week <= totalWeeks; week++) {
    result[week] = await fetchTransactions(leagueId, week)
  }

  return result
}

// ---------------------------------
// Main Builder
// ---------------------------------

export async function buildLeagueSnapshot(
  leagueId: string,
  legacyData?: any // injected, not dynamically loaded
): Promise<LeagueSnapshot> {
  console.log(`Building snapshot for ${leagueId}`)

  const league = await fetchLeague(leagueId)
  const users = await fetchUsers(leagueId)
  const rosters = await fetchRosters(leagueId)

  const totalWeeks = getRegularSeasonWeeks(league)

  const matchups = await fetchAllMatchups(leagueId, totalWeeks)
  const transactions = await fetchAllTransactions(leagueId, totalWeeks)
  const draft = await fetchDraft(leagueId)

  return {
    generatedAt: new Date().toISOString(),
    league,
    users,
    rosters,
    matchups,
    transactions,
    draft,
    legacy: legacyData ?? null
  }
}
