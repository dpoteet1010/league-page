import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY } from '$env/static/private'; // SvelteKit's secure import
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueStandings } from '$lib/utils/leagueStandingsServer.js';
import { getLeagueRosters } from '$lib/utils/leagueRostersServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';
import { getLeagueTransactions } from '$lib/utils/transactionsServer.js';
import { getLeagueRecords } from '$lib/utils/leagueRecordsServer.js';

// Initialize the SDK with the Vercel variable
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export const POST = async ({ request }) => {
    try {
        const { message, history } = await request.json();

        // 1. Fetch Fresh League Context
        const [league, standings, rosters, managers, transactions, records] = await Promise.all([
            getLeagueData(),
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTeamManagers(),
            getLeagueTransactions(),
            getLeagueRecords()
        ]);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: `You are the "Commish", a witty fantasy football expert for this Sleeper league.
            
            CONTEXT DATA:
            - Current Season: ${league.season}
            - League Name: ${league.name}
            - Standings: ${JSON.stringify(standings)}
            - Rosters: ${JSON.stringify(rosters)}
            - Managers: ${JSON.stringify(managers.teamManagersMap[league.season])}
            - Recent Transactions: ${JSON.stringify(transactions.transactions.slice(0, 10))}
            - Historical Records: ${JSON.stringify(records)}

            RULES:
            1. Be concise but trash-talk slightly if someone is doing poorly.
            2. Use the manager names provided in the context.
            3. If asked about trades or waivers, refer to the Recent Transactions.`
        });

        const chat = model.startChat({
            history: history || [],
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Gemini API Error:", error);
        return json({ error: "Failed to fetch response from the Commish." }, { status: 500 });
    }
};
