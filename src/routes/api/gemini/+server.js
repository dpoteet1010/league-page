import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { legacyLeagueData } from '$lib/utils/helperFunctions/legacyLeagueData.js';
export const config = {
    maxDuration: 30 
};

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const { prompt } = await request.json();

        // 1. Fetch managers and current data
        const managers = await getLeagueTeamManagers();
        const currentLeague = await getLeagueData();

        // 2. BUILD THE ARCHIVE MANUALLY (The "No-Fail" Way)
        let historyArchive = [];

        // Add 2024 and 2023 immediately from your local file
        if (legacyLeagueData["2024"]) {
            historyArchive.push({ 
                year: "2024", 
                winner_roster_id: legacyLeagueData["2024"].metadata?.latest_league_winner_roster_id,
                source: "Legacy" 
            });
        }
        if (legacyLeagueData["2023"]) {
            historyArchive.push({ 
                year: "2023", 
                winner_roster_id: legacyLeagueData["2023"].metadata?.latest_league_winner_roster_id,
                source: "Legacy" 
            });
        }

        // Add 2025 by fetching it directly
        // Replace '1125215535314714624' with your actual 2025 Sleeper League ID
        const sleeper2025Id = currentLeague.previous_league_id || "1125215535314714624"; 
        
        try {
            const [lRes, rRes] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}`),
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}/rosters`)
            ]);
            
            const lData = await lRes.json();
            const rData = await rRes.json();

            historyArchive.push({
                year: "2025",
                winner_roster_id: lData.metadata?.latest_league_winner_roster_id,
                standings: rData.map(r => ({
                    roster_id: r.roster_id,
                    owner_id: r.owner_id,
                    fpts: (r.settings.fpts || 0) + ((r.settings.fpts_decimal || 0) / 100)
                })),
                source: "Sleeper"
            });
        } catch (e) {
            console.error("2025 Fetch Failed");
        }

        // 3. AI ORCHESTRATION
        const systemInstruction = `
            You are the Commissioner for the National Liver Failure League.
            
            HISTORY DATA: ${JSON.stringify(historyArchive)}
            MANAGERS: ${JSON.stringify(managers.users)}

            DIRECTIONS:
            - To find a winner, match 'winner_roster_id' to the correct manager in the MANAGERS list.
            - If you see 2025 data, use the standings to discuss scores.
            - Be witty and slightly hungover.
        `;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent([{ text: systemInstruction }, { text: prompt }]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `System Crash: ${error.message}` }, { status: 500 });
    }
