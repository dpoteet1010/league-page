import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

export const config = {
    maxDuration: 30 
};

// ... (keep your existing imports)

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const { prompt } = await request.json();

        // 1. Fetch Current Data
        const [managers, nflState, currentLeague] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        // 2. THE HISTORY FIX: Check for previous seasons
        let historyContext = "No previous season data found.";
        
        if (currentLeague.previous_league_id && currentLeague.previous_league_id !== "0") {
            try {
                // Fetch the previous year's basic info
                const prevResponse = await fetch(`https://api.sleeper.app/v1/league/${currentLeague.previous_league_id}`);
                const prevLeague = await prevResponse.json();
                
                // Fetch the previous year's rosters/standings
                const prevRostersRes = await fetch(`https://api.sleeper.app/v1/league/${currentLeague.previous_league_id}/rosters`);
                const prevRosters = await prevRostersRes.json();

                historyContext = `
                    PREVIOUS SEASON (${prevLeague.season}) SUMMARY:
                    - League Name: ${prevLeague.name}
                    - Final Rosters/Stats: ${JSON.stringify(prevRosters.map(r => ({
                        owner_id: r.owner_id,
                        wins: r.settings.wins,
                        losses: r.settings.losses,
                        fpts: r.settings.fpts
                    })))}
                `;
            } catch (e) {
                console.error("History fetch failed:", e);
            }
        }

        // 3. AI ORCHESTRATION
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const systemInstruction = `
            You are the All-Knowing League Historian. 
            CURRENT SEASON: ${JSON.stringify(currentLeague)}
            HISTORICAL DATA: ${historyContext}
            MANAGER NAMES: ${JSON.stringify(managers.users)}

            When asked about history, look at the PREVIOUS SEASON data provided. 
            Match owner_ids to display_names to tell the story of who won or lost last year.
        `;

        const result = await model.generateContent([
            { text: systemInstruction },
            { text: `User Question: ${prompt}` }
        ]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `DEBUG ERROR: ${error.message}` }, { status: 500 });
    }
}
