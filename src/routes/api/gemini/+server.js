import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

// 1. Tell Vercel to allow more time (Up to 60s on newer Pro plans, max 10-30s on Hobby)
export const config = {
    maxDuration: 30 
};

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const body = await request.json();

        // 2. Fetch data in parallel (Essential for speed!)
        const [managers, nflState, leagueData] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        const genAI = new GoogleGenerativeAI(apiKey);
        // Using "flash-lite" specifically for the fastest possible response
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });

        const systemContext = `You are the commissioner for ${leagueData.name}. 
        Current Week: ${nflState.week}. 
        League Data: ${JSON.stringify(managers)}. 
        Be extremely concise and witty.`;

        // 3. Simple generateContent is faster than startChat for one-off questions
        const result = await model.generateContent([
            { text: systemContext },
            { text: `User Question: ${body.prompt || "Give me a recap"}` }
        ]);

        const response = await result.response;
        return json({ text: response.text() });

    } catch (error) {
        console.error("TIMEOUT OR API ERROR:", error.message);
        return json({ text: `THE COMMISH IS STUCK: ${error.message}` }, { status: 500 });
    }
}
