import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
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

        // 2. BUILD THE ARCHIVE MANUALLY
        let historyArchive = [];

        const processLegacySeason = (year) => {
            const rosters = legacyLeagueRosters[year]?.rosters;
            const users = legacyLeagueUsers[year];
            if (!rosters || !users) return null;

            let seasonMap = {
                year: year,
                winner_roster_id: legacyLeagueData[year]?.metadata?.latest_league_winner_roster_id,
                teams: {}
            };

            Object.values(rosters).forEach(roster => {
                const user = users.find(u => u.user_id === roster.owner_id);
                seasonMap.teams[roster.roster_id] = {
                    manager: user ? user.display_name : "Unknown",
                    teamName: user?.metadata?.team_name || "Unknown Team",
                    wins: roster.settings?.wins,
                    fpts: roster.settings?.fpts
                };
            });
            return seasonMap;
        };

        // Add Legacy Years
        const data2023 = processLegacySeason("2023");
        const data2024 = processLegacySeason("2024");
        if (data2023) historyArchive.push(data2023);
        if (data2024) historyArchive.push(data2024);

        // Add 2025 (Sleeper Fetch) - Just once!
        const sleeper2025Id = currentLeague.previous_league_id || "1125215535314714624"; 
        try {
            const [lRes, rRes, uRes] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}`),
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}/rosters`),
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}/users`)
            ]);
            
            const lData = await lRes.json();
            const rData = await rRes.json();
            const uData = await uRes.json();

            let season2025 = {
                year: "2025",
                winner_roster_id: lData.metadata?.latest_league_winner_roster_id,
                teams: {}
            };

            rData.forEach(roster => {
                const user = uData.find(u => u.user_id === roster.owner_id);
                season2025.teams[roster.roster_id] = {
                    manager: user ? user.display_name : "Unknown",
                    teamName: user?.metadata?.team_name || "Unknown Team",
                    wins: roster.settings?.wins,
                    fpts: (roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100)
                };
            });
            historyArchive.push(season2025);
        } catch (e) {
            console.error("2025 Fetch Failed", e);
        }

        // 3. AI ORCHESTRATION
        const systemInstruction = `
            You are the Commissioner for the National Liver Failure League.
            
            LEAGUE HISTORY:
            ${JSON.stringify(historyArchive)}

            DIRECTIONS:
            1. Every season in LEAGUE HISTORY has a "teams" object. 
            2. The keys in "teams" are the Roster IDs.
            3. When asked about a winner or a specific team, look at that year's "teams" to find the correct 'manager' and 'teamName'.
            4. Never use 2026 names for 2023 results.
            5. Be witty, talk trash about their scores (fpts), and keep the Commissioner persona.
        `;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent([{ text: systemInstruction }, { text: prompt }]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `System Crash: ${error.message}` }, { status: 500 });
    }
}
