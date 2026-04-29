import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- ACTIVE IMPORTS ---
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { getLeagueRosters } from '$lib/utils/leagueRostersServer.js';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history } = await request.json();
        const cleanMessage = String(message?.text || message || "");

        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text || item.parts?.[0]?.text || "") }],
        }));

        // --- OPTIMIZED PARALLEL FETCH ---
        // Fire all requests at once to stay under the 10s Vercel timeout
        const [
            currentLeague, 
            year2024, 
            year2023, 
            managersData, 
            rostersData
        ] = await Promise.all([
            getLeagueData().catch(e => { console.error(e); return null; }),
            getLeagueData("2024").catch(e => { console.error(e); return null; }),
            getLeagueData("2023").catch(e => { console.error(e); return null; }),
            getLeagueTeamManagers().catch(e => { console.error(e); return { teamManagersMap: {} }; }),
            getLeagueRosters().catch(e => { console.error(e); return {}; })
        ]);

        // Organize the history for the AI
        const leagueHistory = {};
        if (currentLeague) leagueHistory[currentLeague.season] = currentLeague;
        if (year2024) leagueHistory["2024"] = year2024;
        if (year2023) leagueHistory["2023"] = leagueHistory["2023"] || year2023;

        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", 
            systemInstruction: `You are the League Commish. You have access to the full history and manager identities.

            CONTEXT:
            - League History (Settings/Winners): ${JSON.stringify(leagueHistory)}
            - Manager Profiles (IDs to Names): ${JSON.stringify(managersData.teamManagersMap || {})}
            - Roster Mapping (Roster ID to User ID): ${JSON.stringify(rostersData || {})}

            DIAGNOSTIC WORKFLOW:
            1. If asked for a winner of a specific year:
               a. Find 'latest_league_winner_roster_id' in History for that year.
               b. Match that Roster ID to a 'user_id' in Roster Mapping.
               c. Match that 'user_id' to a Name in Manager Profiles.
            2. Always prioritize Real Names or Team Names.
            3. Stay in character as a professional commissioner. If data is missing, explain exactly where the link in the chain broke.`
        });

        const chat = model.startChat({ history: formattedHistory });
        const result = await chat.sendMessage(cleanMessage);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini API Route Error:", error);
        return json({ error: "The Commish is timed out. Try again in a moment." }, { status: 500 });
    }
};
