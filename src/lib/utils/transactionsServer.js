import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
// Import your local legacy transaction data
import { legacyTransactions } from './helperFunctions/legacyTransactions.js';

/**
 * Server-side version of getLeagueTransactions.
 * Switches between local legacy data and the Sleeper API.
 */
export const getLeagueTransactions = async (queryLeagueID = defaultLeagueID) => {
    
    // 1. Check for Legacy Years first
    // If the ID is the literal string "2023" or "2024", use local data
    if (queryLeagueID === "2023" || queryLeagueID === "2024") {
        return {
            transactions: legacyTransactions[queryLeagueID] || [],
            leagueID: queryLeagueID,
            success: true,
            source: 'local'
        };
    }

    // 2. Otherwise, fetch from Sleeper (Current/Active Seasons)
    try {
        // Sleeper transactions API defaults to week 1 if no week is provided
        // In a full implementation, you might loop through weeks, 
        // but this fetches the most recent batch.
        const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/transactions/1`);
        
        if (!res.ok) {
            console.error(`Sleeper Transactions Error: League ${queryLeagueID} not found.`);
            return { transactions: [], leagueID: queryLeagueID, success: false };
        }
        
        const transactions = await res.json();

        return {
            transactions: Array.isArray(transactions) ? transactions : [],
            leagueID: queryLeagueID,
            success: true,
            source: 'sleeper'
        };

    } catch (err) {
        console.error(`Fetch Error for League Transactions ${queryLeagueID}:`, err);
        return { 
            transactions: [], 
            leagueID: queryLeagueID, 
            success: false, 
            error: err.message 
        };
    }
};
