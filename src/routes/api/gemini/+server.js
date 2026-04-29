import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- ACTIVE IMPORT ---
import { getLeagueData } from '$lib/utils/leagueDataServer.js';

// --- INACTIVE IMPORTS (Commented out for visibility) ---
// import { getLeagueStandings } from '$lib/utils/leagueStandingsServer.js';
// import { getLeagueRosters } from '$lib/utils/leagueRostersServer.js';
// import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
// import { getLeagueTransactions } from '$lib/utils/transactionsServer.js';
// import { getLeagueRecords } from '$lib/utils/leagueRecordsServer.js';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history } = await request.json();

        // Ensure the message is a clean string
        const cleanMessage = String(message?.text || message || "");

        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text || item.parts?.[0]?.text || "") }],
        }));

        // --- ACTIVE FETCH (The "History Walk") ---
        const leagueHistory = {};
        
        // 1. Get the current season (Sleeper)
        const currentLeague = await getLeagueData().catch(() => null); 
        if (currentLeague) {
            leagueHistory[currentLeague.season] = currentLeague;
        }

        // 2. Explicitly fetch Legacy years (from your local data logic)
        const year2024 = await getLeagueData("2024").catch(() => null);
        const year2023 = await getLeagueData("2023").catch(() => null);

        if (year2024) leagueHistory["2024"] = year2024;
        if (year2023) leagueHistory["2023"] = year2023;

        // --- INACTIVE FETCHES (Commented out for visibility) ---
        /*
        const [standings, rosters, managers, transactions, records] = await Promise.all([
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueTransactions(),
            getLeagueRecords()
        ]).catch(err => {
            console.error("Context Fetching Error:", err);
            return [{}, {}, {}, {}, {}, {}];
        });
        */

        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", 
            systemInstruction: `You are the League Commish.
            
            You have access to a HISTORY of league settings. Each year has its own name, roster positions, and metadata (like winners).
            
            LEAGUE HISTORY CONTEXT:
            ${JSON.stringify(leagueHistory)}

            GOAL:
            - When asked about 2023, look at the data under the "2023" key.
            - When asked about 2024, look at the data under the "2024" key.
            - If asked about "latest_league_winner_roster_id", check the "metadata" section for that specific year.
            - If data is missing for a year, be specific about what you looked for.
            - Keep the persona professional but firm, like a real fantasy commissioner.`
        });

        const chat = model.startChat({
            history: formattedHistory,
        });

        const result = await chat.sendMessage(cleanMessage);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini API Route Error:", error);
        return json({ error: error.message || "The Commish is offline." }, { status: 500 });
    }
};
