import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { getTransactions } from '$lib/utils/transactionsServer.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST() {
    try {
        // These will now work because they don't use Svelte Stores!
        const nflState = await getNflState();
        const leagueData = await getLeagueData();
        const managers = await getLeagueTeamManagers();
        
        // ... rest of your Gemini logic
        return json({ success: true, week: nflState.week });
    } catch (error) {
        console.error(error);
        return json({ error: error.message }, { status: 500 });
    }
}
