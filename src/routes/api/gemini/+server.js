import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; // Safer for Vercel secrets
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

// Access the API key using the SvelteKit env handler
// This falls back to process.env if env.GEMINI_API_KEY isn't populated
const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

export async function POST({ request }) {
    try {
        // 1. Parse the request body
        const body = await request.json();
        const userPrompt = body.prompt;

        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is missing from Vercel Environment Variables.");
        }

        // 2. Gather Server-Safe Context
        // We use Promise.all to fetch everything in parallel (faster)
        const [managers, nflState, leagueData] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        // 3. Initialize the Gemini Model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // 4. Start Chat with System Context
        // We stringify the data to feed the AI's "memory"
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ 
                        text: `You are the AI Commissioner for the ${leagueData.name} fantasy football league. 
                        It is currently Week ${nflState.week} of the ${nflState.season} season.
                        Here is the manager and league data for context: ${JSON.stringify(managers)}. 
                        Answer questions concisely and with a bit of personality.` 
                    }],
                },
                {
                    role: "model",
                    parts: [{ text: "Understood. I am the Commissioner. I have the league data. Ask me anything about the rosters or the season." }],
                },
            ],
        });

        // 5. Send the message and get response
        const result = await chat.sendMessage(userPrompt || "Give me a quick status update on the league.");
        const response = await result.response;
        const text = response.text();

        // 6. Return the JSON response
        return json({ text });

    } catch (error) {
        // This logs the real error to your Vercel Function Logs
        console.error("CRITICAL API ERROR:", error.message);
        
        return json({ 
            error: "The Commissioner is busy at the moment.", 
            details: error.message 
        }, { status: 500 });
    }
}
