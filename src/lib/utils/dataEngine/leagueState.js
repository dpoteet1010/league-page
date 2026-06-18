/**
 * Compiles weekly matchup datasets into structured regular season standings.
 * Reacts instantly when store values update on screen.
 */
export const getLeagueState = (matchupsStoreValue, teamManagersStoreValue, selectedLeagueYear) => {
    if (!matchupsStoreValue || !teamManagersStoreValue) return {};

    const targetYear = selectedLeagueYear || teamManagersStoreValue.year || "2025";
    const currentYearManagers = teamManagersStoreValue?.teamManagersMap?.[targetYear] || {};
    const standings = {};

    // 1. FIXED: Extract correct manager names and team names from your store schema
    Object.entries(currentYearManagers).forEach(([rosterId, managerMeta]) => {
        // Resolve complex or co-managed team names dynamically
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

    const weeksData = matchupsStoreValue.matchupWeeks || Object.entries(matchupsStoreValue);

    weeksData.forEach((weekItem) => {
        let matchupsList = weekItem.matchups || weekItem[1];
        if (!matchupsList) return;

        const matchupPairs = {};

        if (!Array.isArray(matchupsList)) {
            Object.values(matchupsList).forEach(pairGroup => {
                const pairId = pairGroup[0]?.matchup_id || Math.random();
                if (!matchupPairs[pairId]) matchupPairs[pairId] = [];
                matchupPairs[pairId] = pairGroup;
            });
        } else {
            matchupsList.forEach(teamPerf => {
                if (!teamPerf.matchup_id) return;
                if (!matchupPairs[teamPerf.matchup_id]) {
                    matchupPairs[teamPerf.matchup_id] = [];
                }
                matchupPairs[teamPerf.matchup_id].push(teamPerf);
            });
        }

        Object.values(matchupPairs).forEach(pair => {
            if (pair.length !== 2) return;

            const [teamA, teamB] = pair;
            const recordA = standings[teamA.roster_id];
            const recordB = standings[teamB.roster_id];

            if (!recordA || !recordB) return;

            const pointsA = Number(teamA.points || 0);
            const pointsB = Number(teamB.points || 0);

            recordA.pf += pointsA;
            recordA.pa += pointsB;
            recordB.pf += pointsB;
            recordB.pa += pointsA;

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

    const champsBracket = playoffStoreValue.champs.bracket;
    const finalChampsRound = champsBracket[champsBracket.length - 1];
    const finalChampsMatchup = finalChampsRound?.[0];

    let championId = null;
    if (finalChampsMatchup) {
        const t1 = finalChampsMatchup[0];
        const t2 = finalChampsMatchup[1];
        
        const t1Pts = Object.values(t1?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
        const t2Pts = Object.values(t2?.points || {}).reduce((sum, val) => (sum || 0) + (val || 0), 0);
        
        if (t1.roster_id && t2.roster_id) {
            championId = t1Pts > t2Pts ? t1.roster_id : t2.roster_id;
        }
    }

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
                lastPlaceId = t1Pts < t2Pts ? t1.roster_id : t2.roster_id;
            }
        }
    }

    return { championId, lastPlaceId };
};
