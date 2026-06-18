/**
 * Traverses an evaluated playoff store object to find the champion and league loser roster IDs.
 */
export const determinePlayoffPodiums = (playoffStoreValue) => {
    if (!playoffStoreValue?.champs?.bracket?.length) {
        return { championId: null, lastPlaceId: null };
    }

    // 1. Extract Champion (Winner of the very last round in the championship bracket)
    const champsBracket = playoffStoreValue.champs.bracket;
    const finalChampsRound = champsBracket[champsBracket.length - 1];
    const finalChampsMatchup = finalChampsRound?.[0]; // Usually just 1 matchup in the finals

    let championId = null;
    if (finalChampsMatchup) {
        const t1 = finalChampsMatchup[0];
        const t2 = finalChampsMatchup[1];
        
        // Sum points across all available playoff match weeks for this round
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
            
            // In a standard toilet bowl/loser bracket, the team that LOSES stays at the bottom
            lastPlaceId = t1Pts < t2Pts ? t1.roster_id : t2.roster_id;
        }
    }

    return { championId, lastPlaceId };
};
