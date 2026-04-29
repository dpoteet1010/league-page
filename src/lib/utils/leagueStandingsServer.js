import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo.js';
import { getNflState } from "./nflStateServer.js";
import { getLeagueData } from "./leagueDataServer.js";
import { getLeagueRosters } from "./leagueRostersServer.js";
import { round } from '$lib/utils/helperFunctions/universalFunctions.js';
import { legacyMatchups } from './helperFunctions/legacyMatchups.js'; // Import local matchups

/**
 * Server-side version of getLeagueStandings.
 * Now supports historical years by accepting a queryLeagueID.
 */
export const getLeagueStandings = async (queryLeagueID = defaultLeagueID) => {
    // 1. Fetch prerequisite data (Hybrid-aware thanks to previous fixes)
    const [nflState, leagueData, rostersData] = await Promise.all([
        getNflState(),
        getLeagueData(queryLeagueID),
        getLeagueRosters(queryLeagueID),
    ]).catch((err) => { 
        console.error("Standings Pre-fetch Error:", err); 
        return [null, null, null];
    });

    if (!nflState || !leagueData || !rostersData) return null;

    const settings = leagueData.settings || {};
    const yearData = leagueData.season;
    const isLegacy = queryLeagueID === "2023" || queryLeagueID === "2024";
    
    const playoffStart = settings.playoff_week_start || 15;
    const regularSeasonLength = playoffStart - 1;
    const divisions = (settings.divisions || 0) > 1;
    const rosters = rostersData.rosters;

    // 2. Validate season status
    const validStatus = ["in_season", "post_season", "complete"];
    if (!isLegacy && (!validStatus.includes(leagueData.status) || nflState.week < 1)) {
        return null;
    }

    // 3. Initialize Standings Object
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

    // 4. Calculate Division Stats (Hybrid Logic)
    if (divisions) {
        let matchupsDataArray = [];

        if (isLegacy) {
            // Use local matchups for 2023/2024
            matchupsDataArray = legacyMatchups[yearData] || [];
        } else {
            // Use Sleeper API for 2025/2026
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
                        fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`)
                            .then(res => res.ok ? res.json() : [])
                            .catch(() => [])
                    );
                }
                matchupsDataArray = await Promise.all(matchupsPromises);
            }
        }

        // Process the gathered matchups
        for (const matchup of matchupsDataArray) {
            if (Array.isArray(matchup)) {
                standings = processStandings(matchup, standings, rosters);
            }
        }
    }

    return {
        standingsInfo: standings,
        yearData,
    };
}

const processStandings = (matchup, standingsData, rosters) => {
    const matchups = {};
    for (const match of matchup) {
        if (!match || !match.roster_id) continue;
        if (!matchups[match.matchup_id]) matchups[match.matchup_id] = [];
        
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

        const isDivMatch = teamA && teamB && teamA.division && teamB.division && teamA.division == teamB.division;

        if (isDivMatch && standingsData[teamA.rosterID] && standingsData[teamB.rosterID]) {
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
