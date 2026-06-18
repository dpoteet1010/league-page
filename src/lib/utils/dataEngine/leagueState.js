/**
 * Compiles weekly matchup datasets into structured regular season standings.
 * Reacts instantly when store values update on screen.
 */
export const getLeagueState = (matchupsStoreValue, teamManagersStoreValue, selectedLeagueYear) => {
    // Safety guard against unresolved initialization timelines
    if (!matchupsStoreValue || !teamManagersStoreValue) return {};

    // 1. Resolve target season year context
    const targetYear = selectedLeagueYear || teamManagersStoreValue.year || "2025";
    const currentYearManagers = teamManagersStoreValue?.teamManagersMap?.[targetYear] || {};
    const standings = {};

    // 2. Pre-populate teams mapping using current year manager profiles
    Object.entries(currentYearManagers).forEach(([rosterId, managerMeta]) => {
        standings[rosterId] = {
            team: managerMeta.teamName || `Team ${rosterId}`,
            manager: managerMeta.name || "Unknown Manager",
            wins: 0,
            losses: 0,
            ties: 0,
            pf: 0,
            pa: 0
        };
    });

    // Extract raw data structures (handles both direct array mapping and nested objects safely)
    const weeksData = matchupsStoreValue.matchupWeeks || Object.entries(matchupsStoreValue);

    // 3. Loop through every regular season match week and aggregate numbers
    weeksData.forEach((weekItem) => {
        // Safe structural fallback to parse both engine private history format and raw api responses
        let matchupsList = weekItem.matchups || weekItem[1];
        let numericalWeek = weekItem.week || parseInt(weekItem[0]);

        if (!matchupsList) return;

        // Group team performances by matchup_id to resolve head-to-head pairings
        const matchupPairs = {};

        // If the inner layer is grouped as an object structure (processed by engine matchups)
        if (!Array.isArray(matchupsList)) {
            Object.values(matchupsList).forEach(pairGroup => {
                const pairId = pairGroup[0]?.matchup_id || Math.random();
                if (!matchupPairs[pairId]) matchupPairs[pairId] = [];
                matchupPairs[pairId] = pairGroup;
            });
        } else {
            // Otherwise parse as flat arrays (raw API response patterns)
            matchupsList.forEach(teamPerf => {
                if (!teamPerf.matchup_id) return;
                if (!matchupPairs[teamPerf.matchup_id]) {
                    matchupPairs[teamPerf.matchup_id] = [];
                }
                matchupPairs[teamPerf.matchup_id].push(teamPerf);
            });
        }

        // 4. Calculate Wins, Losses, and Total Points
        Object.values(matchupPairs).forEach(pair => {
            if (pair.length !== 2) return; // Ignore incomplete weeks, byes, or broken pairings safely

            const [teamA, teamB] = pair;
            const recordA = standings[teamA.roster_id];
            const recordB = standings[teamB.roster_id];

            // If a manager left the league or roster IDs changed incorrectly, ignore to avoid script crashes
            if (!recordA || !recordB) return;

            // Extract total points scores using root 'points' fallback checks
            const pointsA = Number(teamA.points || 0);
            const pointsB = Number(teamB.points || 0);

            // Accumulate Points For (PF) and Points Against (PA)
            recordA.pf += pointsA;
            recordA.pa += pointsB;

            recordB.pf += pointsB;
            recordB.pa += pointsA;

            // Resolve Match outcome records
            if (pointsA > pointsB) {
                recordA.wins += 1;
                recordB.losses += 1;
            } else if (pointsB > pointsA) {
                recordB.wins += 1;
                recordA.losses += 1;
            } else {
                recordA.ties += 1;
                recordB.ties += 1;
            }
        });
    });

    return standings;
};

/**
 * Traverses an evaluated playoff store tree structure to isolate the 
 * exact roster IDs representing first and last place podium positions.
 */
export const determinePlayoffPodiums = (playoffStoreValue) => {
    if (!playoffStoreValue?.champs?.bracket?.length) {
        return { championId: null, lastPlaceId: null };
    }

    // 1. Extract Champion (Winner of the very final matchup slot in the primary bracket tree)
    const champsBracket = playoffStoreValue.champs.bracket;
    const finalChampsRound = champsBracket[champsBracket.length - 1];
    const finalChampsMatchup = finalChampsRound?.[0];

    let championId = null;
    if (finalChampsMatchup) {
        const t1 = finalChampsMatchup[0];
        const t2 = finalChampsMatchup[1];
        
        // Sum multi-week playoff rules perfectly if applicable (e.g. 2-week championships)
        const t1Pts = Object.values(t1?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
        const t2Pts = Object.values(t2?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
        
        if (t1.roster_id && t2.roster_id) {
            championId = t1Pts > t2Pts ? t1.roster_id : t2.roster_id;
        }
    }

    // 2. Extract Last Place Toilet Bowl Loser (The team that loses the final match chain)
    const losersBracket = playoffStoreValue.losers?.bracket || [];
    let lastPlaceId = null;
    
    if (losersBracket.length > 0) {
        const finalLosersRound = losersBracket[losersBracket.length - 1];
        const finalLosersMatchup = finalLosersRound?.[0];

        if (finalLosersMatchup) {
            const t1 = finalLosersMatchup[0];
            const t2 = finalLosersMatchup[1];

            const t1Pts = Object.values(t1?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
            const t2Pts = Object.values(t2?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
            
            if (t1.roster_id && t2.roster_id) {
                // In Sleeper's standard consolation/toilet bowl bracket, the LOSING side drops to the absolute bottom
                lastPlaceId = t1Pts < t2Pts ? t1.roster_id : t2.roster_id;
            }
        }
    }

    return { championId, lastPlaceId };
};
