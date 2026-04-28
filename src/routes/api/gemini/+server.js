import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Import all our resilient server utilities
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueStandings } from '$lib/utils/leagueStandingsServer.js';
import { getLeagueRosters } from '$lib/utils/leagueRostersServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { getLeagueTransactions } from '$lib/utils/transactionsServer.js';
import { getLeagueRecords } from '$lib/utils/leagueRecordsServer.js';

// Initialize the Google Generative AI SDK
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history } = await request.json();

        // 1. Format history to the specific structure Gemini requires
        // It must be an array of { role: 'user'|'model', parts: [{ text: string }] }
        const formattedHistory = (history || []).map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(item.text || item.parts?.[0]?.text || "") }],
        }));

        // 2. Fetch all league context in parallel with error handling
        const [league, standings, rosters, managers, transactions, records] = await Promise.all([
            getLeagueData(),
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueTransactions(),
            getLeagueRecords()
        ]).catch(err => {
            console.error("Context Fetching Error:", err);
            return [{}, {}, {}, {}, {}, {}];
        });

        // 3. Configure the model and system instructions
      const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest",
            systemInstruction: `You are a data-driven league analyst. Your goal is to provide direct, accurate answers based ONLY on the provided JSON context.

            INSTRUCTIONS:
            1. If asked about a specific year (like 2023), look inside the "records.seasons" array for the object where "year" matches.
            2. If you see "undefined" or empty data for a specific request, state exactly what is missing (e.g., "The records for 2023 are currently empty in the database").
            3. Use the "managers" mapping to resolve Roster IDs to real names. If a name is missing, provide the Roster ID.
            4. Keep responses concise and focused on the statistics. No trash talk or persona-driven filler until requested.

            CURRENT DATA SNAPSHOT:
            - League: ${league?.name} (${league?.season})
            - Available Seasons in Records: ${records?.seasons?.map(s => s.year).join(', ') || 'None found'}
            - Manager Map: ${JSON.stringify(managers?.teamManagersMap?.[league?.season] || {})}
            - Standings Data: ${JSON.stringify(standings || {})}
            `
        });

        // 4. Start the chat session
        const chat = model.startChat({
            history: formattedHistory,
        });

        // 5. Ensure the message is a clean string to prevent "request is not iterable" error
        const cleanMessage = String(message);

        const result = await chat.sendMessage(cleanMessage);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini API Route Error:", error);
        // Return a 500 status with a clean error message for the frontend
        return json({ error: error.message || "The Commish is currently out of the office." }, { status: 500 });
    }
};
