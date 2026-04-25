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
        const [managers, nflState, currentLeague] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        // 2. BUILD THE HISTORY CONTEXT
        let historyContext = "";

        // --- Era 1: Legacy Years (Manual) ---
        // Replace these placeholders with your actual historical stats
        historyContext += `
        SEASON 2023 (Legacy): Winner: [Insert 23 Winner], Runner-up: [Name], Points Leader: [Name].
        SEASON 2024 (Legacy): Winner: [Insert 24 Winner], Runner-up: [Name], Points Leader: [Name].
        `;

        // --- Era 2: Sleeper Years (Dynamic) ---
        const prevYearID = currentLeague.previous_league_id;
        
        if (prevYearID && prevYearID !== "0") {
            try {
                // Fetch the previous year's rosters and users to map names
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
                        fpts: roster.settings.fpts + (roster.settings.fpts_decimal / 100),
                        rank: roster.settings.rank || "N/A"
                    };
                });

                historyContext += `
                SEASON 2025 (Sleeper): 
                Full Standings: ${JSON.stringify(rosterSummary)}
                `;
            } catch (err) {
                console.error("Failed to crawl 2025 Sleeper history:", err);
            }
        }

        // 3. INITIALIZE AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const systemInstruction = `
            You are the expert Commissioner and Historian for the ${currentLeague.name}.
            Current Status: Week ${nflState.week}, ${nflState.season} Season.
            
            LEAGUE HISTORY ARCHIVE:
            ${historyContext}

            CURRENT MANAGERS:
            ${JSON.stringify(managers.users.map(u => u.display_name))}

            INSTRUCTIONS:
            - Use the HISTORY ARCHIVE to answer questions about past winners or scores.
            - If asked about 2023 or 2024, use the 'Legacy' data.
            - If asked about 2025, use the 'Sleeper' standings provided.
            - Match 'Unknown Managers' in history to current managers by name if possible.
            - Be concise, witty, and authoritative.
        `;

        const result = await model.generateContent([
            { text: systemInstruction },
            { text: `User Question: ${prompt}` }
        ]);

        return json({ text: result.response.text() });

    } catch (error) {
        console.error("SERVER ERROR:", error);
        return json({ text: `The Commish is having a breakdown: ${error.message}` }, { status: 500 });
    }
}
