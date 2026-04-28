import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SECRET_GEMINI_API_KEY } from '$env/static/private';

// Server-side utilities
import { getLeagueData } from '$lib/utils/leagueDataServer';
import { getLeagueStandings } from '$lib/utils/leagueStandingsServer';
import { getLeagueRosters } from '$lib/utils/leagueRostersServer';
import { getLeagueTransactions } from '$lib/utils/transactionsServer';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer';
import { getLeagueRecords } from '$lib/utils/leagueRecordsServer';
import { getDrafts } from '$lib/utils/draftsServer'; 
import { getBrackets } from '$lib/utils/bracketsServer'; 
import { getLeagueMatchups } from '$lib/utils/leagueMatchupsServer'; 
import { getAwards } from '$lib/utils/leagueAwardsServer'; // Added

const genAI = new GoogleGenerativeAI(SECRET_GEMINI_API_KEY);

export async function POST({ request }) {
    try {
        const { message, history } = await request.json();

        // 1. GATHER ALL LEAGUE DATA
        const [
            league, 
            standings, 
            rosters, 
            transactions, 
            managers, 
            records, 
            drafts, 
            brackets, 
            matchups,
            awards // Added to the parallel fetch
        ] = await Promise.all([
            getLeagueData(),
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTransactions(),
            getLeagueTeamManagers(),
            getLeagueRecords(),
            getDrafts(),
            getBrackets(),
            getLeagueMatchups(),
            getAwards() // New data source
        ]);

        // 2. SYSTEM INSTRUCTIONS (The "Commish" Bible)
        const systemInstruction = `
            You are "The Commish," the witty, slightly arrogant, and all-knowing authority of this fantasy football league.
            
            LEAGUE CONTEXT:
            - Name: ${league.name}
            - Current Season: ${league.season}
            
            LEAGUE AWARDS & HISTORY:
            - Championship & Toilet Bowl History: ${JSON.stringify(awards)}
            - All-Time Records (Highs/Lows): ${JSON.stringify(records.regularSeasonData)}
            
            CURRENT STATE:
            - Standings: ${JSON.stringify(standings?.standingsInfo)}
            - Latest Matchups: ${JSON.stringify(matchups?.matchupWeeks?.slice(-1))}
            - Managers: ${JSON.stringify(managers.teamManagersMap[league.season])}
            
            DRAFTS & TRANSACTIONS:
            - Draft History: ${JSON.stringify(drafts)}
            - Transaction Aggression (Trades/Waivers): ${JSON.stringify(transactions.totals.allTime)}
            - Recent Activity: ${JSON.stringify(transactions.transactions.slice(0, 10))}

            YOUR MISSION:
            1. Use the AWARDS data to identify past champions. If someone asks "Who is the GOAT?", look at who has the most titles.
            2. Reference manager names from the manager map to make responses personal.
            3. Be snarky but accurate. If someone has won a Toilet Bowl, don't let them forget it.
            4. When using legacy data (2023-2024), cite it as "historical records."
        `;

        // 3. INITIALIZE MODEL
        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", 
            systemInstruction: systemInstruction 
        });

        // 4. CHAT EXECUTION
        const chat = model.startChat({
            history: history || [],
            generationConfig: {
                temperature: 0.75,
                maxOutputTokens: 1000,
            },
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Commish API Error:", error);
        return json({ 
            error: "The Commish is currently polishing the trophies. Try again in a minute." 
        }, { status: 500 });
    }
}
