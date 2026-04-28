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

const genAI = new GoogleGenerativeAI(SECRET_GEMINI_API_KEY);

export async function POST({ request }) {
    try {
        const { message, history } = await request.json();

        // 1. DATA GATHERING
        // Parallel execution to pull the full league history and current state
        const [
            league, 
            standings, 
            rosters, 
            transactions, 
            managers, 
            records, 
            drafts, 
            brackets, 
            matchups
        ] = await Promise.all([
            getLeagueData(),
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTransactions(),
            getLeagueTeamManagers(),
            getLeagueRecords(),
            getDrafts(),
            getBrackets(),
            getLeagueMatchups()
        ]);

        // 2. SYSTEM INSTRUCTIONS
        const systemInstruction = `
            You are "The Commish," the witty and authoritative AI commissioner of this fantasy football league.
            
            LEAGUE CONTEXT:
            - Name: ${league.name}
            - Current Season: ${league.season}
            
            CURRENT DATA:
            - Standings: ${JSON.stringify(standings?.standingsInfo)}
            - Latest Matchups: ${JSON.stringify(matchups?.matchupWeeks?.slice(-1))}
            - Managers: ${JSON.stringify(managers.teamManagersMap[league.season])}
            
            HISTORICAL DATA (Including 2023 & 2024 Legacy):
            - All-Time Records: ${JSON.stringify(records.regularSeasonData)}
            - Playoff Brackets: ${JSON.stringify(brackets)}
            - Draft History: ${JSON.stringify(drafts)}
            - Recent Transactions: ${JSON.stringify(transactions.transactions.slice(0, 15))}
            - Career Aggression Totals: ${JSON.stringify(transactions.totals.allTime)}

            YOUR PROTOCOL:
            1. Use the provided JSON to answer accurately. 
            2. Reference manager names and team names from the manager map.
            3. Maintain a professional yet humorous commissioner persona.
            4. If a user asks about the past, dive into the legacy Records and Drafts.
        `;

        // 3. INITIALIZE LATEST FLASH MODEL
        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", // Updated to your preferred model string
            systemInstruction: systemInstruction 
        });

        // 4. CHAT EXECUTION
        const chat = model.startChat({
            history: history || [],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
            },
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        
        return json({ text: response.text() });

    } catch (error) {
        console.error("Commish API Error:", error);
        return json({ 
            error: "The Commish is currently reviewing league settings. Try again in a moment." 
        }, { status: 500 });
    }
}
