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

        const currentLeague2026 = await getLeagueData();
        let historyArchive = [];

        // 1. PROCESS 2023
        const rosters2023 = legacyLeagueRosters["2023"]?.rosters;
        const users2023 = legacyLeagueUsers["2023"];
        // Manual override based on your confirmation: Evan (Roster 1) won 2023
        let data2023 = {
            year: "2023",
            winner_roster_id: 1, 
            teams: {}
        };
        Object.values(rosters2023).forEach(r => {
            const u = users2023.find(user => user.user_id === r.owner_id);
            data2023.teams[r.roster_id] = { manager: u?.display_name, teamName: u?.metadata?.team_name, fpts: r.settings?.fpts };
        });
        historyArchive.push(data2023);

        // 2. PROCESS 2024
        const rosters2024 = legacyLeagueRosters["2024"]?.rosters; // Note: Ensure your rosters file has a 2024 key
        const users2024 = legacyLeagueUsers["2024"];
        // Manual override based on your confirmation: James (Roster 8) won 2024
        let data2024 = {
            year: "2024",
            winner_roster_id: 8, 
            teams: {}
        };
        if (rosters2024) {
            Object.values(rosters2024).forEach(r => {
                const u = users2024.find(user => user.user_id === r.owner_id);
                data2024.teams[r.roster_id] = { manager: u?.display_name, teamName: u?.metadata?.team_name, fpts: r.settings?.fpts };
            });
            historyArchive.push(data2024);
        }

        // 3. PROCESS 2025 (Live Fetch)
        const sleeper2025Id = "1125215535314714624"; 
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
                    fpts: (roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100)
                };
            });
            historyArchive.push(season2025);
        } catch (e) { console.error("2025 Fetch Failed", e); }

        const systemInstruction = `
            You are a helpful assistant providing fantasy football league history.
            
            LEAGUE DATA:
            ${JSON.stringify(historyArchive)}

            INSTRUCTIONS:
            1. For each year, identify the manager whose roster_id matches the winner_roster_id.
            2. Report the results clearly: Year, Winner Name, Team Name, and Points.
            3. Do not use a persona. Be direct and factual.
        `;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent([{ text: systemInstruction }, { text: prompt }]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `System Error: ${error.message}` }, { status: 500 });
    }
}
