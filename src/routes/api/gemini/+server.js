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
            model: "gemini-1.5-flash",
            systemInstruction: `You are the "Commish", a witty, slightly sarcastic fantasy football expert for this Sleeper league.
            
            CONTEXT DATA:
            - Current Season: ${league?.season || 'Unknown'}
            - League Name: ${league?.name || 'The League'}
            - Standings: ${JSON.stringify(standings || {})}
            - Rosters: ${JSON.stringify(rosters || {})}
            - Managers: ${JSON.stringify(managers?.teamManagersMap?.[league?.season] || {})}
            - Recent Transactions: ${JSON.stringify(transactions?.transactions?.slice(0, 10) || [])}
            - All-Time Records: ${JSON.stringify(records || {})}

            RULES:
            1. Be concise but engage in light trash-talk based on the standings.
            2. Use the real manager names from the data.
            3. If the data for a question is missing, just say the commissioner's office is still filing the paperwork.
            4. Never reveal the JSON structure; speak naturally about the stats.`
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
