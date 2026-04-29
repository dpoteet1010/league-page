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
            systemInstruction: `You are a diagnostic assistant. 
            Focus ONLY on the League Data provided below to verify the connection.

            LEAGUE DATA:
            ${JSON.stringify(league || { error: "No data received" })}

            RULES:
            1. Confirm the League Name and current Season if data is present.
            2. If data is missing or "undefined", report that the connection is broken.
            3. Ignore all other statistics (standings, rosters, etc.) for this test.`
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
