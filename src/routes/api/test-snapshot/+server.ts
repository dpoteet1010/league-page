// src/routes/api/test-league-snapshot/+server.ts
import type { RequestHandler } from '@sveltejs/kit'
import { buildLeagueSnapshot } from '$lib/analytics/buildLeagueSnapshot'
import { legacyLeagueData } from '$lib/utils/helperFunctions/legacyLeagueData.js'

/**
 * Convert legacyLeagueData to SeasonData shape
 */
function formatLegacySeasons(legacy: Record<string, any>) {
    return Object.fromEntries(
        Object.entries(legacy).map(([year, data]) => [
            year,
            {
                league: data,
                users: [],        // populate if you have legacy users
                rosters: [],      // populate if you have legacy rosters
                matchups: {},     // populate if you have legacy matchups
                transactions: {}, // populate if you have legacy transactions
                draft: null       // populate if you have legacy draft data
            }
        ])
    )
}

export const GET: RequestHandler = async () => {
    try {
        const formattedLegacySeasons = formatLegacySeasons(legacyLeagueData)

        const snapshot = await buildLeagueSnapshot(
            '1211171901003550720', // your league ID
            formattedLegacySeasons
        )

        console.log('✅ League snapshot generated successfully')
        console.log('Seasons included:', Object.keys(snapshot.seasons))
        Object.entries(snapshot.seasons).forEach(([year, season]) => {
            console.log(`- ${year}: league keys = ${Object.keys(season.league).join(', ')}`)
        })

        return new Response(JSON.stringify(snapshot, null, 2), {
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (err) {
        console.error('❌ Error generating league snapshot:', err)
        return new Response(
            JSON.stringify({ error: (err as Error).message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
    }
}
