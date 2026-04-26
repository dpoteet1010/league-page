import { json } from '@sveltejs/kit';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from '$env/dynamic/private'; 
import { getNflState } from '$lib/utils/nflStateServer.js';
import { getLeagueData } from '$lib/utils/leagueDataServer.js';
import { getLeagueTeamManagers } from '$lib/utils/leagueTeamManagersServer.js';

export const config = {
    maxDuration: 30 
};

// ... (existing imports)

export async function POST({ request }) {
    try {
        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const { prompt } = await request.json();

        const [managersData, nflState, currentLeague] = await Promise.all([
            getLeagueTeamManagers(),
            getNflState(),
            getLeagueData()
        ]);

        const userList = Object.values(managersData.users).map(u => u.display_name);

        // 2. BUILD THE HISTORY CONTEXT
        let historyContext = "";
        
        // DEBUG: Track the chain
        const prevYearID = currentLeague.previous_league_id;
        console.log(`Debug: Current League ID is ${currentLeague.league_id}, Previous is ${prevYearID}`);

        if (prevYearID && prevYearID !== "0") {
            try {
                const [prevLeagueRes, prevRostersRes, prevUsersRes] = await Promise.all([
                    fetch(`https://api.sleeper.app/v1/league/${prevYearID}`),
                    fetch(`https://api.sleeper.app/v1/league/${prevYearID}/rosters`),
                    fetch(`https://api.sleeper.app/v1/league/${prevYearID}/users`)
                ]);
                
                const prevLeague = await prevLeagueRes.json();
                const prevRosters = await prevRostersRes.json();
                const prevUsers = await prevUsersRes.json();

                // Get the winner ID from metadata
                const winnerRosterId = prevLeague.metadata?.latest_league_winner_roster_id;

                const rosterSummary = prevRosters.map(roster => {
                    const user = prevUsers.find(u => u.user_id === roster.owner_id);
                    const name = user?.display_name || "Unknown Manager";
                    const isWinner = roster.roster_id.toString() === winnerRosterId?.toString();
                    
                    return {
                        name: name,
                        roster_id: roster.roster_id,
                        wins: roster.settings.wins,
                        points: (roster.settings.fpts || 0) + ((roster.settings.fpts_decimal || 0) / 100),
                        isWinner: isWinner
                    };
                });

                historyContext += `
                [DATABASE ENTRY: 2025 SEASON]
                League Name: ${prevLeague.name}
                Official Winner Roster ID: ${winnerRosterId || "Not recorded"}
                Final Standings: ${JSON.stringify(rosterSummary)}
                `;
            } catch (err) {
                historyContext += `\n[ERROR FETCHING 2025 DATA: ${err.message}]\n`;
            }
        } else {
            historyContext += `\n[DEBUG: No previous_league_id found in the current Sleeper data]\n`;
        }

        // 3. INITIALIZE AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        const systemInstruction = `
            You are the expert Commissioner for the ${currentLeague.name}.
            
            ARCHIVED DATA:
            ${historyContext}

            If the user asks about 2025, look at the "DATABASE ENTRY: 2025" above. 
            Identify the winner by looking for "isWinner: true". 
            If no historical data is listed or an ERROR is shown, tell the user exactly what the error is so we can debug.
        `;

        const result = await model.generateContent([
            { text: systemInstruction },
            { text: prompt }
        ]);

        return json({ text: result.response.text() });

    } catch (error) {
        return json({ text: `DEBUG BREAKDOWN: ${error.message}` }, { status: 500 });
    }
}
