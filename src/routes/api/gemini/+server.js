import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return json({ text: "SYSTEM ERROR: API Key missing from Vercel." }, { status: 500 });
        }

        const body = await request.json();
        const userPrompt = body.prompt;

        // 1. GATHER DATA
        const [managers, nflState, leagueData] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        // 2. INITIALIZE AI WITH 2026 STABLE ALIAS
        // "gemini-flash-latest" is a special alias that Google keeps updated
        // to the latest working Flash model (currently Gemini 3.1 Flash).
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        // 3. START CHAT
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ 
                        text: `You are the AI Commissioner for ${leagueData.name}. 
                               Current Week: ${nflState.week}. 
                               Roster Data: ${JSON.stringify(managers)}` 
                    }],
                },
                {
                    role: "model",
                    parts: [{ text: "Commissioner online. Data synced. How can I help?" }],
                },
            ],
        });

        const result = await chat.sendMessage(userPrompt || "Hello");
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        // This will print the EXACT reason for the 500 error in your browser
        console.error("DEBUG:", error.message);
        return json({ text: `COMMISSIONER ERROR: ${error.message}` }, { status: 500 });
    }
}
