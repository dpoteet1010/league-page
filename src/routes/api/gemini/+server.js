import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

export const config = {
    maxDuration: 30 
};

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const { prompt } = await request.json();

        // 1. Fetch Current Infrastructure Data
        const [managersData, nflState, currentLeague] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        // FIX: The template returns 'users' as an object. We turn it into a list for the AI.
        const userList = Object.values(managersData.users).map(u => u.display_name);

        // 2. BUILD THE HISTORY CONTEXT
        let historyContext = "";

        // --- Era 1: Legacy Years (Manual) ---
        // Since your server files don't handle 2023/2024, we hardcode the key takeaways here
        historyContext += `
        SEASON 2023 (Legacy): Inaugural season. Winner: [Insert 23 Winner], Runner-up: [Name].
        SEASON 2024 (Legacy): Second season. Winner: [Insert 24 Winner], Runner-up: [Name].
        `;

        // --- Era 2: Sleeper Years (Dynamic) ---
        const prevYearID = currentLeague.previous_league_id;
        
        if (prevYearID && prevYearID !== "0") {
            try {
                const [prevRostersRes, prevUsersRes] = await Promise.all([
                    fetch(`https://api.sleeper.app/v1/league/${prevYearID}/rosters`),
                    fetch(`https://api.sleeper.app/v1/league/${prevYearID}/users`)
                ]);
                
                const prevRosters = await prevRostersRes.json();
                const prevUsers = await prevUsersRes.json();

                const rosterSummary = prevRosters.map(roster => {
                    const user = prevUsers.find(u => u.user_id === roster.owner_id);
                    return {
                        name: user?.display_name || "Unknown Manager",
                        wins: roster.settings.wins,
                        losses: roster.settings.losses,
                        fpts: (roster.settings.fpts || 0) + ((roster.settings.fpts_decimal || 0) / 100),
                    };
                });

                historyContext += `
                SEASON 2025 (Sleeper): 
                Standings: ${JSON.stringify(rosterSummary)}
                `;
            } catch (err) {
                console.error("Sleeper history fetch failed:", err);
            }
        }

        // 3. INITIALIZE AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const systemInstruction = `
            You are the expert Commissioner and Historian for the ${currentLeague.name}.
            
            LEAGUE HISTORY ARCHIVE:
            ${historyContext}

            CURRENT MANAGERS:
            ${JSON.stringify(userList)}

            INSTRUCTIONS:
            - If asked about 2023/2024, use the Legacy data.
            - If asked about 2025, use the Sleeper standings provided.
            - Match 'Unknown Managers' in history to current managers by name.
            - Be authoritative, concise, and witty.
        `;

        const result = await model.generateContent([
            { text: systemInstruction },
            { text: prompt }
        ]);

        return json({ text: result.response.text() });

    } catch (error) {
        console.error("SERVER ERROR:", error);
        return json({ text: `The Commish is stuck: ${error.message}` }, { status: 500 });
    }
}
