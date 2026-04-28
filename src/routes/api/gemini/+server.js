import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
// 1. Change from 'static' to 'dynamic'
import { env } from '$env/dynamic/private'; 

// Server-side utilities
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueStandings } from '$lib/utils/leagueStandingsServer.js';
import { getLeagueRosters } from '$lib/utils/leagueRostersServer.js';
import { getLeagueTransactions } from '$lib/utils/transactionsServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { getLeagueRecords } from '$lib/utils/leagueRecordsServer.js';
import { getDrafts } from '$lib/utils/draftsServer.js'; 
import { getBrackets } from '$lib/utils/bracketsServer.js'; 
import { getLeagueMatchups } from '$lib/utils/leagueMatchupsServer.js'; 
import { getAwards } from '$lib/utils/leagueAwardsServer.js'; 

export async function POST({ request }) {
    // 2. Move genAI initialization inside the POST function 
    // to ensure it has access to the runtime environment variables
    const apiKey = env.SECRET_GEMINI_API_KEY;
    
    if (!apiKey) {
        console.error("API Key is missing from environment variables");
        return json({ error: "The Commish lost his office keys. (Missing API Key)" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        const { message, history } = await request.json();

        // ... rest of your data gathering (getLeagueData, etc.) ...
        const [
            league, standings, rosters, transactions, managers, records, drafts, brackets, matchups, awards
        ] = await Promise.all([
            getLeagueData(),
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTransactions(),
            getLeagueTeamManagers(),
            getLeagueRecords(),
            getDrafts(),
            getBrackets(),
            getLeagueMatchups(),
            getAwards()
        ]);

        const systemInstruction = `...`; // Your existing prompt

        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", // Use the full string to be safe
            systemInstruction: systemInstruction 
        });

        const chat = model.startChat({
            history: history || [],
            generationConfig: {
                temperature: 0.75,
                maxOutputTokens: 1000,
            },
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Commish API Error:", error);
        return json({ error: "The Commish is currently polishing the trophies." }, { status: 500 });
    }
}
