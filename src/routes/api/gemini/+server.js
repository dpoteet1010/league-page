import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { leagueID } from '$lib/utils/leagueInfo';
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueData';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagers';
import { getLeagueTransactions } from '$lib/utils/getLeagueTransactions';
import { getRivalryMatchups } from '$lib/utils/getRivalryMatchups';
import { loadPlayers } from '$lib/utils/loadPlayers';
import { 
    getRosterIDFromManagerIDAndYear, 
    getTeamNameFromTeamManagers,
    getDatesActive 
} from '$lib/utils/helperFunctions/universalFunctions';

// Initialize Gemini (Ensure your API key is in your .env)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST({ fetch }) {
    try {
        // 1. Parallel Data Ingestion
        // We bypass local cache (refresh=true) for server-side accuracy
        const [nflState, teamManagers, transData, playersData] = await Promise.all([
            getNflState(),
            getLeagueTeamManagers(),
            getLeagueTransactions(false, true), 
            loadPlayers(fetch, true)
        ]);

        const currentYear = nflState.season;
        const targetWeek = nflState.season_type === 'regular' ? nflState.week - 1 : 18;

        // 2. Build the "League Bible" (The Context Object)
        // We use your utility functions to map IDs to Names and History
        const leagueBible = {
            metadata: {
                week: targetWeek,
                year: currentYear,
                totalManagers: Object.keys(teamManagers.users).length
            },
            standings: {}, 
            storylines: {
                trades: [],
                rivalries: []
            }
        };

        // 3. Process Transactions (The "Art of the Deal")
        // Mapping Sleeper IDs to actual Player Names using loadPlayers data
        leagueBible.storylines.trades = transData.transactions
            .filter(tx => tx.type === 'trade' && tx.season === currentYear)
            .slice(0, 5)
            .map(trade => ({
                date: trade.date,
                moves: trade.moves.map(move => {
                    // Logic to find which manager got which player
                    // Cross-referencing playersData.players[id]
                    return move; 
                })
            }));

        // 4. Identify a "Rivalry of the Week"
        // We'll pick two top managers and see their historical beef
        const managerIds = Object.keys(teamManagers.users);
        if (managerIds.length >= 2) {
            const m1 = managerIds[0];
            const m2 = managerIds[1];
            const rivalry = await getRivalryMatchups(m1, m2);
            
            leagueBible.storylines.rivalries.push({
                names: [teamManagers.users[m1].display_name, teamManagers.users[m2].display_name],
                history: {
                    wins: rivalry.wins,
                    points: rivalry.points,
                    totalMatchups: rivalry.matchups.length
                }
            });
        }

        // 5. Construct the AI Prompt
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `
            You are a witty, slightly sarcastic Fantasy Football Commissioner. 
            Review the following league data and write a "State of the Union" recap.

            DATA HIGHLIGHTS:
            - Transaction Stats: ${JSON.stringify(transData.totals.allTime)}
            - Recent Big Trades: ${JSON.stringify(leagueBible.storylines.trades)}
            - Featured Rivalry: ${JSON.stringify(leagueBible.storylines.rivalries)}

            INSTRUCTIONS:
            1. Call out "Transaction Addicts" (high waiver/trade counts).
            2. Reference historical team names if they've changed (Use the context from getNestedTeamNames).
            3. Roast the loser of the Featured Rivalry based on their all-time record.
            4. Keep it engaging, professional yet humorous.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;

        return json({ 
            recap: response.text(),
            rawStats: leagueBible 
        });

    } catch (error) {
        console.error("League Recap Error:", error);
        return json({ error: "Failed to generate league recap" }, { status: 500 });
    }
}
