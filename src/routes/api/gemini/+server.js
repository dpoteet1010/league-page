import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

export async function POST({ request }) {
    try {
        // 1. Check API Key immediately
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return json({ text: "ERROR: GEMINI_API_KEY is not found in Vercel env variables." }, { status: 500 });
        }

        const body = await request.json();
        const userPrompt = body.prompt;

        // 2. Wrap data fetching in its own try/catch to identify WHICH file is failing
        let managers, nflState, leagueData;
        try {
            [managers, nflState, leagueData] = await Promise.all([
                getLeagueTeamManagers(),
                getNflState(),
                getLeagueData()
            ]);
        } catch (dataErr) {
            return json({ text: `ERROR fetching Sleeper data: ${dataErr.message}. Check if your leagueID is correct in leagueInfo.js` }, { status: 500 });
        }

        // 3. Initialize AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ 
                        text: `You are the AI Commissioner for ${leagueData.name}. Week: ${nflState.week}. Data: ${JSON.stringify(managers)}` 
                    }],
                },
                {
                    role: "model",
                    parts: [{ text: "Acknowledged. I am the Commissioner." }],
                },
            ],
        });

        const result = await chat.sendMessage(userPrompt || "Hello");
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        // This will now show the REAL error in your Chat UI
        console.error(error);
        return json({ text: `SYSTEM CRASH: ${error.message}` }, { status: 500 });
    }
}
