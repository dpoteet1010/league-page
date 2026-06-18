import { get } from 'svelte/store';
import { engineMatchupsStore, teamManagersStore } from '$lib/stores';

/**
 * Compiles weekly matchup data into a structured regular season standings object.
 * Used by the validator UI grid table.
 */
export const getLeagueState = (leagueID) => {
    const matchupsByWeek = get(engineMatchupsStore);
    const managersStore = get(teamManagersStore);
    
    // Safely pull the correct year out of our store based on the active league ID mapping
    const targetYear = Object.keys(managersStore?.teamManagersMap || {}).find(year => {
        const matchingId = Object.keys(managersStore?.teamManagersMap[year] || {})[0];
        // If the store context matches, capture this season's key
        return managersStore.year === year; 
    }) || managersStore?.year || "2025";

    const currentYearManagers = managersStore?.teamManagersMap?.[targetYear] || {};
    const standings = {};

    // Initialize standings object for all managers in the league
    Object.entries(currentYearManagers).forEach(([rosterId, managerMeta]) => {
        standings[rosterId] = {
            team: managerMeta.teamName || `Team ${rosterId}`,
            manager: managerMeta.name || "Unknown Manager",
            wins: 0,
            losses: 0,
            pf: 0,
            pa: 0
        };
    });

    // Loop through weeks and aggregate metrics
    Object.entries(matchupsByWeek || {}).forEach(([week, matchupsList]) => {
        if (!Array.isArray(matchupsList)) return;

        // Group team performances by matchup_id to calculate wins/losses and points against (PA)
        const matchupPairs = {};
        matchupsList.forEach(teamPerf => {
            if (!teamPerf.matchup_id) return;
            if (!matchupPairs[teamPerf.matchup_id]) {
                matchupPairs[teamPerf.matchup_id] = [];
            }
            matchupPairs[teamPerf.matchup_id].push(teamPerf);
        });

        // Evaluate heads-up match pairs
        Object.values(matchupPairs).forEach(pair => {
            if (pair.length !== 2) return; // Skip incomplete data or byes

            const [teamA, teamB] = pair;
            const recordA = standings[teamA.roster_id];
            const recordB = standings[teamB.roster_id];

            if (!recordA || !recordB) return;

            // Accumulate Points For (PF)
            recordA.pf += (teamA.points || 0);
            recordB.pf += (teamB.points || 0);

            // Accumulate Points Against (PA)
            recordA.pa += (teamB.points || 0);
            recordB.pa += (teamA.points || 0);

            // Assign Wins/Losses
            if (teamA.points > teamB.points) {
                recordA.wins += 1;
                recordB.losses += 1;
            } else {
                recordB.wins += 1;
                recordA.losses += 1;
            }
        });
    });

    return standings;
};

/**
 * Traverses an evaluated playoff store object to find the champion and league loser roster IDs.
 */
export const determinePlayoffPodiums = (playoffStoreValue) => {
    if (!playoffStoreValue?.champs?.bracket?.length) {
        return { championId: null, lastPlaceId: null };
    }

    // 1. Extract Champion (Winner of the final round in the championship bracket)
    const champsBracket = playoffStoreValue.champs.bracket;
    const finalChampsRound = champsBracket[champsBracket.length - 1];
    const finalChampsMatchup = finalChampsRound?.[0];

    let championId = null;
    if (finalChampsMatchup) {
        const t1 = finalChampsMatchup[0];
        const t2 = finalChampsMatchup[1];
        
        const t1Pts = Object.values(t1?.points || {}).reduce((a, b) => (a || 0) + (b || 0), 0);
        const t2Pts = Object.values(t2?.points || {}).reduce((a, b) => (a || 0) + (b || 0), 0);
        
        championId = t1Pts > t2Pts ? t1.roster_id : t2.roster_id;
    }

    // 2. Extract Last Place (Loser of the final round in the losers/toilet bowl bracket)
    const losersBracket = playoffStoreValue.losers?.bracket || [];
    let lastPlaceId = null;
    
    if (losersBracket.length > 0) {
        const finalLosersRound = losersBracket[losersBracket.length - 1];
        const finalLosersMatchup = finalLosersRound?.[0];

        if (finalLosersMatchup) {
            const t1 = finalLosersMatchup[0];
            const t2 = finalLosersMatchup[1];

            const t1Pts = Object.values(t1?.points || {}).reduce((a, b) => (a || 0) + (b || 0), 0);
            const t2Pts = Object.values(t2?.points || {}).reduce((a, b) => (a || 0) + (b || 0), 0);
            
            lastPlaceId = t1Pts < t2Pts ? t1.roster_id : t2.roster_id;
        }
    }

    return { championId, lastPlaceId };
};
