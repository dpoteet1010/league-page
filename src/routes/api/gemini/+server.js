import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

// Vercel Timeout Config
export const config = {
    maxDuration: 30 
};

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const body = await request.json();

        // 1. Parallel Data Fetching
        const [managers, nflState, leagueData] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        // 2. Use the "Permanent Alias"
        // 'gemini-flash-latest' always points to the newest stable Flash model
        // In April 2026, this is Gemini 3.1 Flash.
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const systemContext = `You are the witty AI Commissioner for the ${leagueData.name} fantasy football league. 
        Current Season: ${nflState.season}, Week: ${nflState.week}. 
        League Managers: ${JSON.stringify(managers)}. 
        Answer the user's question using this data. Be concise and slightly sarcastic.`;

        // 3. Generate Content
        const result = await model.generateContent([
            { text: systemContext },
            { text: `Manager Question: ${body.prompt || "Give me a league update."}` }
        ]);

        const response = await result.response;
        return json({ text: response.text() });

    } catch (error) {
        console.error("COMMISH ERROR:", error.message);
        
        // Return a helpful error message to the UI
        let friendlyMessage = "The Commissioner is currently at a league meeting (API Error).";
        if (error.message.includes("404")) {
            friendlyMessage = "Model mismatch. Updating to 2026 stable version...";
        }

        return json({ text: `${friendlyMessage} Detail: ${error.message}` }, { status: 500 });
    }
}
