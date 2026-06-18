/**
 * Normalizes and processes active and historical league data to construct
 * comprehensive regular season standings and track playoff podium finishes.
 * 
 * @param {Array} engineMatchupsStore - Array of weeks containing raw regular season matchup data
 * @param {Object} teamManagersStore - Object mapping roster IDs to manager metadata
 * @param {Object} leagueData - Raw league settings and metadata from Sleeper API
 * @param {Object} finalBrackets - The pre-calculated bracket object returned by getBrackets()
 * @returns {Object} Cleaned, aggregated league statistics and standings
 */
export const getLeagueState = (engineMatchupsStore, teamManagersStore, leagueData, finalBrackets) => {
    if (!engineMatchupsStore || !teamManagersStore || !leagueData) {
        return { standings: [], podiums: { championId: null, lastPlaceId: null } };
    }

    const standings = {};
    const regularSeasonWeeks = Number(leagueData.settings?.playoff_week_start || 15) - 1;

    // 1. Initialize roster standing metrics using your manager metadata
    Object.keys(teamManagersStore).forEach((rosterId) => {
        standings[rosterId] = {
            rosterId: Number(rosterId),
            name: teamManagersStore[rosterId].name || `Team ${rosterId}`,
            avatar: teamManagersStore[rosterId].avatar || '',
            wins: 0,
            losses: 0,
            ties: 0,
            fptsFor: 0,
            fptsAgainst: 0,
        };
    });

    // 2. Aggregate regular season head-to-head performance
    engineMatchupsStore.forEach((weekData, index) => {
        const currentWeek = index + 1;
        if (currentWeek > regularSeasonWeeks || !Array.isArray(weekData)) return;

        // Group matchups by their unique match ID to evaluate head-to-head pairs
        const matchupPairs = {};
        weekData.forEach((team) => {
            if (!team.matchup_id) return;
            if (!matchupPairs[team.matchup_id]) {
                matchupPairs[team.matchup_id] = [];
            }
            matchupPairs[team.matchup_id].push(team);
        });

        // Evaluate points and outcomes for each head-to-head match
        Object.values(matchupPairs).forEach((pair) => {
            if (pair.length !== 2) return; // Skip if it's an uncompleted pairing or a raw bye week

            const [teamA, teamB] = pair;
            const rA = teamA.roster_id;
            const rB = teamB.roster_id;

            if (!standings[rA] || !standings[rB]) return;

            const pointsA = Number(teamA.points || 0);
            const pointsB = Number(teamB.points || 0);

            // Accumulate points for and points against
            standings[rA].fptsFor += pointsA;
            standings[rA].fptsAgainst += pointsB;
            standings[rB].fptsFor += pointsB;
            standings[rB].fptsAgainst += pointsA;

            // Assign standard win / loss / tie records
            if (pointsA > pointsB) {
                standings[rA].wins += 1;
                standings[rB].losses += 1;
            } else if (pointsB > pointsA) {
                standings[rB].wins += 1;
                standings[rA].losses += 1;
            } else {
                standings[rA].ties += 1;
                standings[rB].ties += 1;
            }
        });
    });

    // 3. Extract postseason podium spots using the updated UI-aligned parser
    const podiums = determinePlayoffPodiums(finalBrackets);

    return {
        standings: Object.values(standings).sort((a, b) => b.wins - a.wins || b.fptsFor - a.fptsFor),
        podiums
    };
};

/**
 * Safely parses the output of your UI's evaluated getBrackets() data engine.
 * Accounts for 2-week multi-round point accumulation and local legacy file properties.
 * 
 * @param {Object} finalBrackets - The structural output containing evaluated champs and losers properties
 * @returns {Object} Extracted postseason results { championId, lastPlaceId }
 */
export const determinePlayoffPodiums = (finalBrackets) => {
    let championId = null;
    let lastPlaceId = null;

    if (!finalBrackets) return { championId, lastPlaceId };

    // 1. Resolve League Champion from the championship bracket
    const champsBracket = finalBrackets.champs?.bracket || finalBrackets.bracket || [];
    if (champsBracket.length > 0) {
        const finalRoundMatches = champsBracket[champsBracket.length - 1];
        if (finalRoundMatches && finalRoundMatches.length > 0) {
            const titleMatch = finalRoundMatches[0]; // Primary championship pairing
            
            if (titleMatch && titleMatch[0] && titleMatch[1]) {
                // Safely sum up points across all scheduled weeks for this particular playoff matchup
                const pointsA = Object.values(titleMatch[0].points || {}).reduce((sum, wk) => sum + Object.values(wk || {}).reduce((a, b) => a + Number(b || 0), 0), 0);
                const pointsB = Object.values(titleMatch[1].points || {}).reduce((sum, wk) => sum + Object.values(wk || {}).reduce((a, b) => a + Number(b || 0), 0), 0);
                
                championId = pointsA > pointsB ? titleMatch[0].roster_id : titleMatch[1].roster_id;
            }
        }
    }

    // 2. Resolve Last Place Loser from the consolation / toilet bowl tree
    const losersBracket = finalBrackets.losers?.bracket || [];
    if (losersBracket.length > 0) {
        const finalLoserRound = losersBracket[losersBracket.length - 1];
        if (finalLoserRound && finalLoserRound.length > 0) {
            const toiletMatch = finalLoserRound[0]; // Final bottom-tier survival pairing
            
            if (toiletMatch && toiletMatch[0] && toiletMatch[1]) {
                const pointsA = Object.values(toiletMatch[0].points || {}).reduce((sum, wk) => sum + Object.values(wk || {}).reduce((a, b) => a + Number(b || 0), 0), 0);
                const pointsB = Object.values(toiletMatch[1].points || {}).reduce((sum, wk) => sum + Object.values(wk || {}).reduce((a, b) => a + Number(b || 0), 0), 0);
                
                // Matches standard Sleeper logic: lower scorer drops to the absolute bottom 
                lastPlaceId = pointsA < pointsB ? toiletMatch[0].roster_id : toiletMatch[1].roster_id;
            }
        }
    }

    return { championId, lastPlaceId };
};
