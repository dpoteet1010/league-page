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

        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text || item.parts?.[0]?.text || "") }],
        }));

        // --- ACTIVE FETCH ---
        const league = await getLeagueData().catch(err => {
            console.error("League Data Fetch Error:", err);
            return null;
        });

        // --- INACTIVE FETCHES ---
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
                You have access to the League Configuration Data provided below. 
                This data includes the current season and potentially legacy seasons if requested.
    
                LEAGUE DATA CONTEXT:
                ${JSON.stringify(league || { error: "No data received" })}
    
                YOUR GOAL:
                1. Answer specific questions about league names, settings, and metadata for any year provided in the context.
                2. If the user asks about a year (like 2023 or 2024) and you see that data in the context, use it!
                3. If the data for a specific year is missing, tell the user exactly which league_id you checked.`
            });

        const chat = model.startChat({
            history: formattedHistory,
        });

        const result = await chat.sendMessage(String(message));
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini API Route Error:", error);
        return json({ error: error.message || "The Commish is offline." }, { status: 500 });
    }
};
