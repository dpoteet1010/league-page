/**
 * Compiles weekly matchup datasets into structured regular season standings.
 * Safely normalizes nested store histories and raw array pipelines.
 */
export const getLeagueState = (matchupsStoreValue, teamManagersStoreValue, selectedLeagueYear) => {
    // 1. Safety guard against unresolved initialization timelines
    if (!matchupsStoreValue || !teamManagersStoreValue) return {};

    // 2. Resolve target season year context
    const targetYear = selectedLeagueYear || teamManagersStoreValue.year || "2025";
    const currentYearManagers = teamManagersStoreValue?.teamManagersMap?.[targetYear] || {};
    const standings = {};

    // 3. Pre-populate teams mapping using current year manager profiles
    Object.entries(currentYearManagers).forEach(([rosterId, managerMeta]) => {
        const managerNames = managerMeta?.managers?.map(mID => 
            teamManagersStoreValue.users?.[mID]?.display_name || "Unknown"
        ).join(' & ') || "Unknown Manager";

        standings[rosterId] = {
            team: managerMeta?.team?.name || `Team ${rosterId}`,
            manager: managerNames,
            wins: 0,
            losses: 0,
            ties: 0,
            pf: 0,
            pa: 0
        };
    });

    // 4. FIX: Extract regular week maps cleanly regardless of cache layering variations
    let weeksData = [];
    if (matchupsStoreValue.matchupWeeks && Array.isArray(matchupsStoreValue.matchupWeeks)) {
        weeksData = matchupsStoreValue.matchupWeeks;
    } else if (Array.isArray(matchupsStoreValue)) {
        weeksData = matchupsStoreValue;
    } else {
        weeksData = Object.entries(matchupsStoreValue);
    }

    // 5. Loop through every regular season match week and aggregate numbers
    weeksData.forEach((weekItem) => {
        if (!weekItem) return;

        // Unpack properties whether structured as an engine object or a raw tuple array entry
        let matchupsList = weekItem.matchups;
        if (!matchupsList && Array.isArray(weekItem)) {
            matchupsList = weekItem[1];
        } else if (!matchupsList) {
            matchupsList = weekItem; // Direct fallback flat array mapping pattern
        }

        if (!matchupsList) return;

        // Group team performances by matchup_id to resolve head-to-head pairings
        const matchupPairs = {};

        // If the inner layer is grouped as an object structure (processed by engine matchups)
        if (!Array.isArray(matchupsList)) {
            Object.values(matchupsList).forEach(pairGroup => {
                if (!Array.isArray(pairGroup) || pairGroup.length === 0) return;
                const pairId = pairGroup[0]?.matchup_id || Math.random();
                if (!matchupPairs[pairId]) matchupPairs[pairId] = [];
                matchupPairs[pairId] = pairGroup;
            });
        } else {
            // Otherwise parse as flat arrays (raw API response patterns)
            matchupsList.forEach(teamPerf => {
                if (!teamPerf || !teamPerf.matchup_id) return;
                if (!matchupPairs[teamPerf.matchup_id]) {
                    matchupPairs[teamPerf.matchup_id] = [];
                }
                matchupPairs[teamPerf.matchup_id].push(teamPerf);
            });
        }

        // 6. Calculate Wins, Losses, and Total Points
        Object.values(matchupPairs).forEach(pair => {
            if (pair.length !== 2) return; // Ignore incomplete weeks or active byes safely

            const [teamA, teamB] = pair;
            const recordA = standings[teamA.roster_id];
            const recordB = standings[teamB.roster_id];

            if (!recordA || !recordB) return;

            const pointsA = Number(teamA.points || 0);
            const pointsB = Number(teamB.points || 0);

            // Accumulate Points For (PF) and Points Against (PA)
            recordA.pf += pointsA;
            recordA.pa += pointsB;

            recordB.pf += pointsB;
            recordB.pa += pointsA;

            // Resolve head-to-head match records
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
    if (!playoffStoreValue || !playoffStoreValue.champs || !playoffStoreValue.champs.bracket) {
        return { championId: null, lastPlaceId: null };
    }

    // Extract Champion (Winner of the very final matchup slot in the primary bracket tree)
    const champsBracket = playoffStoreValue.champs.bracket;
    if (!Array.isArray(champsBracket) || champsBracket.length === 0) {
        return { championId: null, lastPlaceId: null };
    }

    const finalChampsRound = champsBracket[champsBracket.length - 1];
    const finalChampsMatchup = Array.isArray(finalChampsRound) ? finalChampsRound[0] : null;

    let championId = null;
    if (Array.isArray(finalChampsMatchup) && finalChampsMatchup.length === 2) {
        const t1 = finalChampsMatchup[0];
        const t2 = finalChampsMatchup[1];
        
        const t1Pts = Object.values(t1?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
        const t2Pts = Object.values(t2?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
        
        if (t1.roster_id && t2.roster_id) {
            championId = t1Pts > t2Pts ? t1.roster_id : t2.roster_id;
        }
    }

    // Extract Last Place Toilet Bowl Loser (The team that loses the final match chain)
    const losersBracket = playoffStoreValue.losers?.bracket || [];
    let lastPlaceId = null;
    
    if (Array.isArray(losersBracket) && losersBracket.length > 0) {
        const finalLosersRound = losersBracket[losersBracket.length - 1];
        const finalLosersMatchup = Array.isArray(finalLosersRound) ? finalLosersRound[0] : null;

        if (Array.isArray(finalLosersMatchup) && finalLosersMatchup.length === 2) {
            const t1 = finalLosersMatchup[0];
            const t2 = finalLosersMatchup[1];

            const t1Pts = Object.values(t1?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
            const t2Pts = Object.values(t2?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
            
            if (t1.roster_id && t2.roster_id) {
                lastPlaceId = t1Pts < t2Pts ? t1.roster_id : t2.roster_id;
            }
        }
    }

    return { championId, lastPlaceId };
};
