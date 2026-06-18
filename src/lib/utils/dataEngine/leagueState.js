/**
 * Compiles weekly matchup datasets into structured regular season standings.
 * Safely normalizes nested store histories and raw array pipelines.
 */
export const getLeagueState = (matchupsStoreValue, teamManagersStoreValue, selectedLeagueYear) => {
    // 1. Safety guard against unresolved initialization timelines
    if (!matchupsStoreValue || !teamManagersStoreValue) return {};

    // 2. Resolve target season year context
    const targetYear = selectedLeagueYear || teamManagersStoreValue.year || "2026";
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

    // 4. Extract regular week items cleanly regardless of cache layering variations
    let weeksList = [];
    if (matchupsStoreValue.matchupWeeks && Array.isArray(matchupsStoreValue.matchupWeeks)) {
        weeksList = matchupsStoreValue.matchupWeeks;
    } else if (Array.isArray(matchupsStoreValue)) {
        weeksList = matchupsStoreValue;
    } else {
        // If it's a key-value store object mapping week numbers directly
        weeksList = Object.entries(matchupsStoreValue).map(([wk, data]) => ({
            week: parseInt(wk),
            matchups: data?.matchups || data
        }));
    }

    // 5. Loop through every regular season match week and aggregate numbers
    weeksList.forEach((weekItem) => {
        if (!weekItem) return;

        // Unpack raw matchups data safely
        let rawMatchups = weekItem.matchups || weekItem;
        if (Array.isArray(weekItem) && weekItem.length === 2) {
            rawMatchups = weekItem[1]?.matchups || weekItem[1];
        }

        if (!rawMatchups) return;

        // Group team performances by matchup_id to resolve head-to-head pairings
        const matchupPairs = {};

        // Convert rawMatchups to an array list if it was parsed as an inner nested object
        const flatTeamsArray = Array.isArray(rawMatchups) 
            ? rawMatchups 
            : Object.values(rawMatchups).flatMap(val => Array.isArray(val) ? val : [val]);

        flatTeamsArray.forEach(teamPerf => {
            if (!teamPerf || !teamPerf.matchup_id) return;
            if (!matchupPairs[teamPerf.matchup_id]) {
                matchupPairs[teamPerf.matchup_id] = [];
            }
            matchupPairs[teamPerf.matchup_id].push(teamPerf);
        });

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
