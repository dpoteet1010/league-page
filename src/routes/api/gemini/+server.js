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

        const [managers, nflState, currentLeague] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        let historyArchive = [];
        let loopID = currentLeague.previous_league_id;

        // THE LOOP
        while (loopID && loopID !== "0") {
            let seasonData = null;

            // 1. Check if we are in the LEGACY chain (2024 or 2023)
            if (legacyLeagueData[loopID]) {
                const legacy = legacyLeagueData[loopID];
                seasonData = {
                    year: legacy.season,
                    name: legacy.name,
                    winner_id: legacy.metadata?.latest_league_winner_roster_id,
                    isLegacy: true,
                    // We can expand this with more legacy stats later
                };
                // Move back: 2024's previous_league_id will point to 2023
                loopID = legacy.previous_league_id; 

            } else {
                // 2. We are in the SLEEPER chain
                try {
                    const [lRes, rRes] = await Promise.all([
                        fetch(`https://api.sleeper.app/v1/league/${loopID}`),
                        fetch(`https://api.sleeper.app/v1/league/${loopID}/rosters`)
                    ]);
                    const lData = await lRes.json();
                    const rData = await rRes.json();

                    seasonData = {
                        year: lData.season,
                        name: lData.name,
                        winner_id: lData.metadata?.latest_league_winner_roster_id,
                        standings: rData.map(r => ({
                            roster_id: r.roster_id,
                            owner_id: r.owner_id,
                            wins: r.settings.wins,
                            fpts: (r.settings.fpts || 0) + ((r.settings.fpts_decimal || 0) / 100)
                        })),
                        isLegacy: false
                    };

                    // THE BRIDGE: 
                    // If Sleeper says there's no more history, force it to the 2024 Legacy ID
                    if (!lData.previous_league_id || lData.previous_league_id === "0") {
                        loopID = "2024"; // Manually bridge to your legacy file
                    } else {
                        loopID = lData.previous_league_id;
                    }
                } catch (e) {
                    console.error("Fetch failed for ID:", loopID);
                    loopID = null;
                }
            }

            if (seasonData) historyArchive.push(seasonData);
            if (historyArchive.length > 10) break; // Safety
        }

        // 3. AI ORCHESTRATION
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const systemInstruction = `
            You are the Commissioner for the National Liver Failure League.
            
            HISTORY ARCHIVE:
            ${JSON.stringify(historyArchive)}

            MANAGERS:
            ${JSON.stringify(managers.users)}

            Your goal is to answer questions about ANY season (2023-2026). 
            If the data is in the archive, use it. Match winner_ids to manager names.
            Be concise and witty.
        `;

        const result = await model.generateContent([
            { text: systemInstruction },
            { text: prompt }
        ]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `SYSTEM ERROR: ${error.message}` }, { status: 500 });
    }
}
