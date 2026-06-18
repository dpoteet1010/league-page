/**
 * Compiles weekly matchup datasets into structured regular season standings.
 * Safely normalizes nested store histories, raw array pipelines, and object maps.
 * * @param {Object|Array} matchupsStoreValue - Raw or wrapped weekly matchup time series data
 * @param {Object} teamManagersStoreValue - Hydrated metadata map containing user and roster info
 * @param {string|number} selectedLeagueYear - The explicit seasonal target year context
 * @returns {Object} Structured key-value lookup of roster IDs to regular season totals
 */
export const getLeagueState = (matchupsStoreValue, teamManagersStoreValue, selectedLeagueYear) => {
    // 1. Safety guard against unresolved initialization timelines
    if (!matchupsStoreValue || !teamManagersStoreValue) return {};

    // 2. Resolve target season year context safely
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
        // Handle a direct key-value object mapping week numbers down to matchups arrays
        weeksList = Object.entries(matchupsStoreValue).map(([wk, data]) => ({
            week: parseInt(wk),
            matchups: data?.matchups || data
        }));
    }

    // 5. Loop through every regular season match week and aggregate numbers
    weeksList.forEach((weekItem) => {
        if (!weekItem) return;

        // Unpack raw matchups data safely across tuple array loops and engine abstractions
        let rawMatchups = weekItem.matchups || weekItem;
        if (Array.isArray(weekItem) && weekItem.length === 2) {
            rawMatchups = weekItem[1]?.matchups || weekItem[1];
        }

        if (!rawMatchups) return;

        // Group team performances by matchup_id to resolve head-to-head pairings
        const matchupPairs = {};

        // Flatten inner structures down if matchups were nested inside extra wrapper layers
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
            if (pair.length !== 2) return; // Ignore incomplete weeks, byes, or odd team numbers safely

            const [teamA, teamB] = pair;
            const recordA = standings[teamA.roster_id];
            const recordB = standings[teamB.roster_id];

            // Safety guard against roster drift anomalies or historical size changes
            if (!recordA || !recordB) return;

            const pointsA = Number(teamA.points || 0);
            const pointsB = Number(teamB.points || 0);

            // Accumulate Points For (PF) and Points Against (PA)
            recordA.pf += pointsA;
            recordA.pa += pointsB;

            recordB.pf += pointsB;
            recordB.pa += pointsA;

            // Resolve head-to-head records
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
 * Evaluates max rounds dynamically to account for varying historical structures.
 * * @param {Object} playoffStoreValue - Evaluated playoff tree object matching Sleeper patterns
 * @returns {Object} Structured podium maps containing { championId, lastPlaceId }
 */
export const determinePlayoffPodiums = (playoffStoreValue) => {
    let championId = null;
    let lastPlaceId = null;

    if (!playoffStoreValue) return { championId, lastPlaceId };

    // ==========================================
    // 1. RESOLVE THE CHAMPION (WINNERS BRACKET)
    // ==========================================
    const champsBracket = playoffStoreValue.champs?.bracket || playoffStoreValue.champs || [];
    if (Array.isArray(champsBracket) && champsBracket.length > 0) {
        const flatChamps = champsBracket.flat(2);
        
        // Find the maximum championship playoff round present
        const maxRound = Math.max(...flatChamps.map(m => Number(m?.r || 0)));
        const finalRoundMatches = flatChamps.filter(m => Number(m?.r) === maxRound);
        
        // Sort ascending by match ID; Match 1 of the final round targets the real title game
        finalRoundMatches.sort((a, b) => Number(a?.m || 0) - Number(b?.m || 0));
        const champMatch = finalRoundMatches[0];

        if (champMatch) {
            if (champMatch.w) {
                championId = champMatch.w;
            } else if (champMatch.t1 && champMatch.t2) {
                // Fallback score aggregation if the outcome marker hasn't been written
                const p1 = Object.values(champMatch.points || {}).reduce((s, v) => s + Number(v || 0), 0);
                const p2 = Object.values(champMatch.points || {}).reduce((s, v) => s + Number(v || 0), 0);
                championId = p1 > p2 ? champMatch.t1 : champMatch.t2;
            }
        }
    }

    // ==========================================
    // 2. RESOLVE THE LAST PLACE (LOSERS/TOILET BRACKET)
    // ==========================================
    const losersBracket = playoffStoreValue.losers?.bracket || playoffStoreValue.losers || [];
    if (Array.isArray(losersBracket) && losersBracket.length > 0) {
        const flatLosers = losersBracket.flat(2);
        
        // Find the maximum lower bracket round present
        const maxLoserRound = Math.max(...flatLosers.map(m => Number(m?.r || 0)));
        const finalLoserRoundMatches = flatLosers.filter(m => Number(m?.r) === maxLoserRound);

        // Isolate final series link chain
        finalLoserRoundMatches.sort((a, b) => Number(a?.m || 0) - Number(b?.m || 0));
        const finalLoserMatch = finalLoserRoundMatches[0];

        if (finalLoserMatch) {
            // Check if league maps via Toilet Bowl rules (losers advance downwards)
            const isToiletBowl = JSON.stringify(finalLoserMatch).includes('"l":') || 
                                 JSON.stringify(flatLosers).includes('"t1_from":{"l"');

            if (isToiletBowl) {
                // Toilet bowl structure: The final game loser finishes dead last
                if (finalLoserMatch.l) {
                    lastPlaceId = finalLoserMatch.l;
                } else if (finalLoserMatch.t1 && finalLoserMatch.t2) {
                    const p1 = Object.values(finalLoserMatch.points || {}).reduce((s, v) => s + Number(v || 0), 0);
                    const p2 = Object.values(finalLoserMatch.points || {}).reduce((s, v) => s + Number(v || 0), 0);
                    lastPlaceId = p1 < p2 ? finalLoserMatch.t1 : finalLoserMatch.t2;
                }
            } else {
                // Standard consolation structure: The final game loser finishes dead last
                if (finalLoserMatch.l) {
                    lastPlaceId = finalLoserMatch.l;
                } else if (finalLoserMatch.w) {
                    lastPlaceId = finalLoserMatch.w === finalLoserMatch.t1 ? finalLoserMatch.t2 : finalLoserMatch.t1;
                }
            }
        }
    }

    return { championId, lastPlaceId };
};
