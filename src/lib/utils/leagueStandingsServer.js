import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { getNflState } from "./nflStateServer.js";
import { getLeagueData } from "./leagueDataServer.js";
import { getLeagueRosters } from "./leagueRostersServer.js";
import { round } from '$lib/utils/helperFunctions/universalFunctions.js';

/**
 * Server-side version of getLeagueStandings.
 * Calculates current record, points, and division standings.
 * Fully resilient against malformed or missing Sleeper settings.
 */
export const getLeagueStandings = async () => {
    // 1. Fetch prerequisite data
    const [nflState, leagueData, rostersData] = await Promise.all([
        getNflState(),
        getLeagueData(),
        getLeagueRosters(),
    ]).catch((err) => { 
        console.error("Standings Pre-fetch Error:", err); 
        return [null, null, null];
    });

    // 2. Safety Guards: Abort if core data is missing
    if (!nflState || !leagueData || !rostersData) return null;

    // 3. Extract settings with fallbacks
    const settings = leagueData.settings || {};
    const yearData = leagueData.season;
    
    // Safety check: Prevents the "playoff_week_start" undefined crash
    const playoffStart = settings.playoff_week_start || 15;
    const regularSeasonLength = playoffStart - 1;
    const divisions = (settings.divisions || 0) > 1;
    const rosters = rostersData.rosters;

    // 4. Validate season status
    const validStatus = ["in_season", "post_season", "complete"];
    if (!validStatus.includes(leagueData.status) || nflState.week < 1) {
        return null;
    }

    // 5. Initialize Standings Object
    let standings = {};
    for (const rosterID in rosters) {
        const roster = rosters[rosterID];
        const rSettings = roster.settings || {};
        
        standings[rosterID] = {
            rosterID,
            wins: rSettings.wins || 0,
            losses: rSettings.losses || 0,
            ties: rSettings.ties || 0,
            fpts: round((rSettings.fpts || 0) + ((rSettings.fpts_decimal || 0) / 100)),
            fptsAgainst: round((rSettings.fpts_against || 0) + ((rSettings.fpts_against_decimal || 0) / 100)),
            streak: roster.metadata?.streak || "0W",
            divisionWins: divisions ? 0 : null,
            divisionLosses: divisions ? 0 : null,
            divisionTies: divisions ? 0 : null,
        }
    }

    // 6. Calculate Division Stats
    if (divisions) {
        let week = 0;
        if (nflState.season_type == 'regular') {
            week = nflState.display_week > regularSeasonLength ? regularSeasonLength + 1 : nflState.display_week;
        } else if (nflState.season_type == 'post') {
            week = regularSeasonLength + 1;
        }

        if (week >= 2) {
            const matchupsPromises = [];
            for (let i = week - 1; i > 0; i--) {
                matchupsPromises.push(
                    fetch(`https://api.sleeper.app/v1/league/${defaultLeagueID}/matchups/${i}`)
                        .then(res => res.ok ? res.json() : [])
                        .catch(() => [])
                );
            }

            const matchupsDataArray = await Promise.all(matchupsPromises).catch((err) => {
                console.error("Division Matchup Fetch Error:", err);
                return [];
            });

            for (const matchup of matchupsDataArray) {
                if (Array.isArray(matchup)) {
                    standings = processStandings(matchup, standings, rosters);
                }
            }
        }
    }

    return {
        standingsInfo: standings,
        yearData,
    };
}

/**
 * Helper to determine division wins/losses by comparing head-to-head scores
 */
const processStandings = (matchup, standingsData, rosters) => {
    const matchups = {};
    for (const match of matchup) {
        if (!match || !match.roster_id) continue;
        
        if (!matchups[match.matchup_id]) {
            matchups[match.matchup_id] = [];
        }
        
        const rosterID = match.roster_id;
        matchups[match.matchup_id].push({
            rosterID,
            division: rosters[rosterID]?.settings?.division,
            points: match.points || 0,
        });
    }

    for (const matchupKey in matchups) {
        const teamA = matchups[matchupKey][0];
        const teamB = matchups[matchupKey][1];

        const divisionMatchup = teamA && teamB && 
                               teamA.division && teamB.division && 
                               teamA.division == teamB.division;

        if (divisionMatchup) {
            if (teamA.points > teamB.points) {
                standingsData[teamA.rosterID].divisionWins++;
                standingsData[teamB.rosterID].divisionLosses++;
            } else if (teamB.points > teamA.points) {
                standingsData[teamB.rosterID].divisionWins++;
                standingsData[teamA.rosterID].divisionLosses++;
            } else {
                standingsData[teamA.rosterID].divisionTies++;
                standingsData[teamB.rosterID].divisionTies++;
            }
        }
    }
    return standingsData;
}
