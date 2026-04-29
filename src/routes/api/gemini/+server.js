import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- ACTIVE IMPORTS ---
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { getLeagueRosters } from '$lib/utils/leagueRostersServer.js';

// --- INACTIVE IMPORTS ---
// import { getLeagueStandings } from '$lib/utils/leagueStandingsServer.js';
// import { getLeagueTransactions } from '$lib/utils/transactionsServer.js';
// import { getLeagueRecords } from '$lib/utils/leagueRecordsServer.js';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history } = await request.json();
        const cleanMessage = String(message?.text || message || "");

        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text || item.parts?.[0]?.text || "") }],
        }));

        // 1. Fetch League Data (History Walk)
        const leagueHistory = {};
        const currentLeague = await getLeagueData().catch(() => null); 
        if (currentLeague) {
            leagueHistory[currentLeague.season] = currentLeague;
            const year2024 = await getLeagueData("2024").catch(() => null);
            const year2023 = await getLeagueData("2023").catch(() => null);
            if (year2024) leagueHistory["2024"] = year2024;
            if (year2023) leagueHistory["2023"] = year2023;
        }

        // 2. Fetch Managers and Rosters (The Bridge)
        const [managersData, rostersData] = await Promise.all([
            getLeagueTeamManagers(),
            getLeagueRosters()
        ]).catch(err => {
            console.error("Context Fetching Error:", err);
            return [{}, {}];
        });

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", 
            systemInstruction: `You are the League Commish. You now have the ability to see REAL names.

            CONTEXT:
            - League History: ${JSON.stringify(leagueHistory)}
            - Manager Profiles: ${JSON.stringify(managersData.teamManagersMap || {})}
            - Roster Mapping: ${JSON.stringify(rostersData || {})}

            DIAGNOSTIC RULES:
            1. To find a winner's name: 
               a. Look at the "metadata.latest_league_winner_roster_id" for a year.
               b. Use the "Roster Mapping" for that year to find the "user_id" for that roster.
               c. Use the "Manager Profiles" for that year to find the "name" for that user_id.
            2. ALWAYS use real names or team names if available. 
            3. If you can't find a name, tell the user exactly which Roster ID or User ID was missing in the chain.`
        });

        const chat = model.startChat({ history: formattedHistory });
        const result = await chat.sendMessage(cleanMessage);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini API Route Error:", error);
        return json({ error: error.message || "The Commish is offline." }, { status: 500 });
    }
};
