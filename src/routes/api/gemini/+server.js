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

        // 1. Fetch current 2026 league context
        const currentLeague2026 = await getLeagueData();
        const managers = await getLeagueTeamManagers();

        // 2. BUILD THE ARCHIVE
        let historyArchive = [];

        // Helper to map managers/teams and align the "Sleeper Winner" shift
        const processLegacySeason = (year) => {
            const rosters = legacyLeagueRosters[year]?.rosters;
            const users = legacyLeagueUsers[year];
            if (!rosters || !users) return null;

            // FIX: Sleeper stores the winner of year X in the metadata of year X+1
            const lookupYear = (parseInt(year) + 1).toString();
            const winnerID = legacyLeagueData[lookupYear]?.metadata?.latest_league_winner_roster_id;

            let seasonMap = {
                year: year,
                winner_roster_id: winnerID,
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

        // Add 2023 and 2024
        const data2023 = processLegacySeason("2023");
        const data2024 = processLegacySeason("2024");
        if (data2023) historyArchive.push(data2023);
        if (data2024) historyArchive.push(data2024);

        // Add 2025 (Pulling from Sleeper API)
        const sleeper2025Id = currentLeague2026.previous_league_id || "1125215535314714624"; 
        try {
            const [rRes, uRes] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}/rosters`),
                fetch(`https://api.sleeper.app/v1/league/${sleeper2025Id}/users`)
            ]);
            
            const rData = await rRes.json();
            const uData = await uRes.json();

            let season2025 = {
                year: "2025",
                // The 2025 winner is found in the CURRENT (2026) league metadata
                winner_roster_id: currentLeague2026.metadata?.latest_league_winner_roster_id,
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
            You are the Commissioner for the National Liver Failure League. It is currently April 2026.
            
            LEAGUE HISTORY:
            ${JSON.stringify(historyArchive)}

            DIRECTIONS:
            1. Use the "teams" object for each year to identify the manager and team name for that specific season.
            2. To find the winner of a season, look at "winner_roster_id" for that year and match it to the team in that year's "teams" list.
            3. The 2025 season IS finished. If you see a winner_roster_id for 2025, acknowledge them as the reigning champ.
            4. Be witty, cynical, and talk trash about their wins and fantasy points (fpts).
            5. You are slightly hungover and have a headache from the office lights.
        `;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent([{ text: systemInstruction }, { text: prompt }]);

        return json({ text: result.response.text() });

    } catch (error) {
        console.error("Critical System Failure:", error);
        return json({ text: `System Crash: ${error.message}` }, { status: 500 });
    }
}
