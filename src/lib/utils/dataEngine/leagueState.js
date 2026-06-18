/**
 * Normalizes a single season's matchup data into a weekly stats engine, then
 * aggregates it into regular season / playoff standings.
 *
 * @param {Object} seasonMatchupsData - Output of getSpecificYearMatchups(): { matchupWeeks, leagueID, year, week, regularSeasonLength }
 * @param {Object} teamManagersStore - Object mapping roster IDs to manager metadata
 * @param {Object} leagueData - Raw league settings and metadata from Sleeper API
 * @param {Object} finalBrackets - The pre-calculated bracket object returned by getBrackets()
 * @returns {Object} { standings, weeklyResults, podiums }
 */
export const getLeagueState = (seasonMatchupsData, teamManagersStore, leagueData, finalBrackets) => {
    if (!seasonMatchupsData?.matchupWeeks || !teamManagersStore || !leagueData) {
        return { standings: [], weeklyResults: [], podiums: { championId: null, lastPlaceId: null } };
    }

    const { matchupWeeks } = seasonMatchupsData;
    const regularSeasonLength = Number(
        seasonMatchupsData.regularSeasonLength ?? (leagueData.settings?.playoff_week_start - 1) ?? 14
    );

    // 1. Initialize standings, split into regularSeason / playoffs buckets per roster
    const standings = {};
    Object.keys(teamManagersStore).forEach((rosterId) => {
        standings[rosterId] = {
            rosterId: Number(rosterId),
            name: teamManagersStore[rosterId].name || `Team ${rosterId}`,
            avatar: teamManagersStore[rosterId].avatar || '',
            regularSeason: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0, streak: { type: null, count: 0 } },
            playoffs: { wins: 0, losses: 0, ties: 0, fptsFor: 0, fptsAgainst: 0 },
        };
    });

    // 2. THE WEEKLY ENGINE — one row per roster per week. This is the reusable
    //    building block for season totals, all-time totals, and rivalries.
    const weeklyResults = [];

    matchupWeeks.forEach(({ week, matchups }) => {
        if (!matchups) return;
        const weekNum = Number(week);
        const isPlayoffWeek = weekNum > regularSeasonLength;

        Object.values(matchups).forEach((pair) => {
            if (!Array.isArray(pair) || pair.length !== 2) return; // skip byes / incomplete pairs

            const [teamA, teamB] = pair;
            const rA = teamA.roster_id;
            const rB = teamB.roster_id;
            if (!standings[rA] || !standings[rB]) return;

            const pointsA = Number(teamA.points || 0);
            const pointsB = Number(teamB.points || 0);

            let resultA, resultB;
            if (pointsA > pointsB) { resultA = 'W'; resultB = 'L'; }
            else if (pointsB > pointsA) { resultA = 'L'; resultB = 'W'; }
            else { resultA = 'T'; resultB = 'T'; }

            weeklyResults.push({ week: weekNum, rosterId: rA, opponentRosterId: rB, pointsFor: pointsA, pointsAgainst: pointsB, result: resultA, isPlayoffs: isPlayoffWeek });
            weeklyResults.push({ week: weekNum, rosterId: rB, opponentRosterId: rA, pointsFor: pointsB, pointsAgainst: pointsA, result: resultB, isPlayoffs: isPlayoffWeek });

            // 3. Roll the weekly row into the right standings bucket
            const bucketA = isPlayoffWeek ? standings[rA].playoffs : standings[rA].regularSeason;
            const bucketB = isPlayoffWeek ? standings[rB].playoffs : standings[rB].regularSeason;

            bucketA.fptsFor += pointsA;
            bucketA.fptsAgainst += pointsB;
            bucketB.fptsFor += pointsB;
            bucketB.fptsAgainst += pointsA;

            if (resultA === 'W') { bucketA.wins += 1; bucketB.losses += 1; }
            else if (resultA === 'L') { bucketA.losses += 1; bucketB.wins += 1; }
            else { bucketA.ties += 1; bucketB.ties += 1; }
        });
    });

    // 4. Current win/loss streak, computed from the engine (regular season only,
    //    walking backward from the most recent completed week)
    Object.keys(standings).forEach((rosterId) => {
        const rosterWeeks = weeklyResults
            .filter((r) => r.rosterId === Number(rosterId) && !r.isPlayoffs)
            .sort((a, b) => a.week - b.week);

        let streakType = null;
        let streakCount = 0;
        for (let i = rosterWeeks.length - 1; i >= 0; i--) {
            const { result } = rosterWeeks[i];
            if (result === 'T') break; // a tie breaks the streak
            if (streakType === null) { streakType = result; streakCount = 1; }
            else if (result === streakType) { streakCount += 1; }
            else break;
        }
        standings[rosterId].regularSeason.streak = { type: streakType, count: streakCount };
    });

    // 5. Postseason podium spots (unchanged)
    const podiums = determinePlayoffPodiums(finalBrackets);

    return {
        standings: Object.values(standings).sort(
            (a, b) => b.regularSeason.wins - a.regularSeason.wins || b.regularSeason.fptsFor - a.regularSeason.fptsFor
        ),
        weeklyResults,
        podiums,
    };
};

// determinePlayoffPodiums is unchanged from your version — leave it as-is.
