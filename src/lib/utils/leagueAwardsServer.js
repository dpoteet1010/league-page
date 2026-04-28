import { getLeagueData } from './leagueDataServer.js';
import { getLeagueRosters } from './leagueRostersServer.js';
import { legacyWinnersBrackets } from './helperFunctions/legacyWinnersBrackets.js';
import { legacyLosersBrackets } from './helperFunctions/legacyLosersBrackets.js';

/**
 * Server-side version of getAwards. 
 * Corrected for Vercel: Added .js extensions and ensured named exports match +server.js
 */
export const getAwards = async () => {
    // 1. Fetch current league info
    const leagueData = await getLeagueData().catch(err => {
        console.error(err);
        return null;
    });

    if (!leagueData) return [];

    // Determine the starting point for the historical walk-back
    let previousSeasonID = leagueData.status === "complete"
        ? leagueData.league_id
        : leagueData.previous_league_id;

    return await getPodiums(previousSeasonID);
};

const getPodiums = async (previousSeasonID) => {
    const podiums = [];
    let currentID = previousSeasonID;

    // 2. Walk back through Sleeper seasons
    while (currentID && currentID !== "0") {
        const previousSeasonData = await getPreviousLeagueData(currentID);

        if (!previousSeasonData) break;

        const {
            losersData,
            winnersData,
            year,
            previousRosters,
            numDivisions,
            playoffRounds,
            toiletRounds,
            leagueMetadata
        } = previousSeasonData;

        // Move to next year in loop
        currentID = previousSeasonData.previousSeasonID;

        const divisions = buildDivisionsAndManagers({
            previousRosters,
            leagueMetadata,
            numDivisions
        });

        const divisionArr = Object.values(divisions);

        // Find podium finishers
        const finalsMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.w);
        const champion = finalsMatch?.w;
        const second = finalsMatch?.l;

        const runnersUpMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.l);
        const third = runnersUpMatch?.w;

        const toiletBowlMatch = losersData.find(m => m.r === toiletRounds && (!m.t1_from || m.t1_from.w));
        const toilet = toiletBowlMatch?.w;

        if (champion) {
            podiums.push({
                year,
                champion,
                second,
                third,
                divisions: divisionArr,
                toilet
            });
        }
    }

    // 3. Append Legacy Data (The hardcoded local files)
    for (const [yearStr, winnersData] of Object.entries(legacyWinnersBrackets)) {
        const year = Number(yearStr);
        if (podiums.find(p => p.year === year)) continue; 

        const losersData = legacyLosersBrackets[year];
        const playoffRounds = Math.max(...winnersData.map(m => m.r));
        const toiletRounds = Math.max(...losersData.map(m => m.r));

        const finalsMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.w);
        const champion = finalsMatch?.w;
        const second = finalsMatch?.l;

        const runnersUpMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.l);
        const third = runnersUpMatch?.w;

        const toiletBowlMatch = losersData.find(m => m.r === toiletRounds && (!m.t1_from || m.t1_from.w));
        const toilet = toiletBowlMatch?.w;

        if (champion) {
            podiums.push({
                year,
                champion,
                second,
                third,
                divisions: [], 
                toilet
            });
        }
    }

    return podiums.sort((a, b) => b.year - a.year);
};

const getPreviousLeagueData = async (leagueID) => {
    try {
        const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${leagueID}`);
        if (!leagueRes.ok) return null;

        const prevLeagueData = await leagueRes.json();
        const year = Number(prevLeagueData.season);

        let winnersData, losersData;

        // Check legacy files first
        if (legacyWinnersBrackets[year] && legacyLosersBrackets[year]) {
            winnersData = legacyWinnersBrackets[year];
            losersData = legacyLosersBrackets[year];
        } else {
            const [losersRes, winnersRes] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${leagueID}/losers_bracket`),
                fetch(`https://api.sleeper.app/v1/league/${leagueID}/winners_bracket`)
            ]);

            if (!losersRes.ok || !winnersRes.ok) return null;
            losersData = await losersRes.json();
            winnersData = await winnersRes.json();
        }

        const rostersData = await getLeagueRosters(leagueID);
        const previousRosters = rostersData.rosters;

        const numDivisions = prevLeagueData.settings.divisions || 1;
        const playoffRounds = winnersData.length ? Math.max(...winnersData.map(m => m.r)) : 0;
        const toiletRounds = losersData.length ? Math.max(...losersData.map(m => m.r)) : 0;

        return {
            losersData,
            winnersData,
            year,
            previousRosters,
            numDivisions,
            previousSeasonID: prevLeagueData.previous_league_id,
            playoffRounds,
            toiletRounds,
            leagueMetadata: prevLeagueData.metadata
        };
    } catch (err) {
        console.error("Error in getPreviousLeagueData:", err);
        return null;
    }
};

const buildDivisionsAndManagers = ({ previousRosters, leagueMetadata, numDivisions }) => {
    const divisions = {};
    for (let i = 1; i <= numDivisions; i++) {
        divisions[i] = {
            name: leagueMetadata ? leagueMetadata[`division_${i}`] : `Division ${i}`,
            wins: -1,
            points: -1
        };
    }

    for (const rosterID in previousRosters) {
        const rSettings = previousRosters[rosterID].settings;
        const div = !rSettings.division || rSettings.division > numDivisions ? 1 : rSettings.division;

        const totalPoints = rSettings.fpts + (rSettings.fpts_decimal || 0) / 100;
        const current = divisions[div];

        if (rSettings.wins > current.wins || (rSettings.wins === current.wins && totalPoints > current.points)) {
            current.points = totalPoints;
            current.wins = rSettings.wins;
            current.rosterID = rosterID;
        }
    }
    return divisions;
};
