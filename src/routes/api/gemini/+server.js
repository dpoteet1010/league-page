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

const genAI = new GoogleGenerativeAI(SECRET_GEMINI_API_KEY);

export async function POST({ request }) {
    try {
        const { message, history } = await request.json();

        // 1. DATA GATHERING
        const [league, standings, rosters, transactions, managers, records] = await Promise.all([
            getLeagueData(),
            getLeagueStandings(),
            getLeagueRosters(),
            getLeagueTransactions(),
            getLeagueTeamManagers(),
            getLeagueRecords()
        ]);

        // 2. SYSTEM INSTRUCTIONS
        const systemInstruction = `
            You are "The Commish," the definitive authority of this fantasy football league.
            You have access to the full league history, including legacy data from 2023 and 2024.
            
            LEAGUE CONTEXT:
            - Name: ${league.name}
            - Season: ${league.season}
            
            CURRENT DATA:
            - Standings: ${JSON.stringify(standings?.standingsInfo)}
            - Current Rosters: ${JSON.stringify(rosters.rosters)}
            - Managers: ${JSON.stringify(managers.teamManagersMap[league.season])}
            
            HISTORICAL & ALL-TIME DATA:
            - Records: ${JSON.stringify(records.regularSeasonData)}
            - Transactions (Last 20): ${JSON.stringify(transactions.transactions.slice(0, 20))}
            - Career Aggression: ${JSON.stringify(transactions.totals.allTime)}

            YOUR ROLE:
            - Answer questions using the provided JSON data.
            - When discussing the past, reference the 2023 and 2024 legacy records.
            - Maintain a professional yet witty commissioner persona.
            - Address managers by their name or team name from the Manager map.
        `;

        // 3. INITIALIZE LATEST PRO MODEL
        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest", // Always utilizes the newest stable Pro version
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
            error: "The Commish is busy adjusting the waiver wire. Please try again." 
        }, { status: 500 });
    }
}
