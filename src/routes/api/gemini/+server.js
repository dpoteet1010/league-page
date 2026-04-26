import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { legacyLeagueData } from '$lib/utils/helperFunctions/legacyLeagueData.js';
import { legacyLeagueUsers } from '$lib/utils/helperFunctions/legacyLeagueUsers.js';
import { legacyLeagueRosters } from '$lib/utils/helperFunctions/legacyLeagueRosters.js';

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
        
        MANAGER DIRECTORY:
        - Current/Global: ${JSON.stringify(managers.users)}
        - Historical by Year: ${JSON.stringify(managers.byYear)}
    
        DIRECTIONS:
        1. When discussing 2023 or 2024, PRIORITIZE the "Historical by Year" names for that specific season.
        2. Match 'winner_roster_id' or 'owner_id' to the correct manager name.
        3. If a manager's name changed, use the name they had DURING that season.
        4. Be witty, authoritative, and slightly hungover.
    `;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent([{ text: systemInstruction }, { text: prompt }]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `System Crash: ${error.message}` }, { status: 500 });
    }
}
