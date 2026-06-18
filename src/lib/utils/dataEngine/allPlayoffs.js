import { getLeagueData } from '$lib/utils/helperFunctions/leagueData';
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from '$lib/utils/helperFunctions/leagueRosters';
import { get } from 'svelte/store';
import { enginePlayoffStore } from '$lib/stores';
import { legacyWinnersBrackets } from '$lib/utils/helperFunctions/legacyWinnersBrackets';
import { legacyLosersBrackets } from '$lib/utils/helperFunctions/legacyLosersBrackets';
import { legacyMatchups } from '$lib/utils/helperFunctions/legacyMatchups';

/**
 * Evaluates and returns fully processed bracket states for a target year or league ID.
 * Completely isolated from the frontend 'brackets' store.
 */
export const getSpecificYearPlayoffs = async (queryLeagueID = mainLeagueID) => {
    const currentStore = get(enginePlayoffStore);
    
    // 1. Check isolation history cache
    if (currentStore.history && currentStore.history[queryLeagueID]) {
        enginePlayoffStore.update(s => ({ ...s, ...s.history[queryLeagueID] }));
        return currentStore.history[queryLeagueID];
    }

    const isLegacyYear = /^\d{4}$/.test(queryLeagueID.toString());

    // --- PIPELINE A: LEGACY ARCHIVE ROUTE ---
    if (isLegacyYear) {
        const stringYear = queryLeagueID.toString();
        const winnersData = legacyWinnersBrackets[stringYear] || [];
        const losersData = legacyLosersBrackets[stringYear] || [];

        const playoffRounds = winnersData?.[winnersData.length - 1]?.r || 0;
        const loserRounds = losersData?.[losersData.length - 1]?.r || 0;
        const playoffsStart = 15;
        const playoffType = 0;

        const bracketsAndMatchupFetches = [
            Promise.resolve(winnersData),
            Promise.resolve(losersData),
        ];

        for (let week = playoffsStart; week < 18; week++) {
            const legacyWeekMatchups = legacyMatchups?.[stringYear]?.[week] || [];
            bracketsAndMatchupFetches.push(Promise.resolve(legacyWeekMatchups));
        }

        const playoffMatchups = await Promise.all(bracketsAndMatchupFetches);

        const winnersBracketData = playoffMatchups.shift();
        const losersBracketData = playoffMatchups.shift();

        const champs = evaluateBracket(winnersBracketData, playoffRounds, playoffMatchups, playoffType);
        const losers = evaluateBracket(losersBracketData, loserRounds, playoffMatchups, playoffType);

        const finalBrackets = {
            numRosters: 0,
            playoffsStart,
            playoffRounds,
            loserRounds,
            champs,
            losers,
            bracket: champs.bracket,
            year: stringYear,
            leagueID: stringYear
        };

        enginePlayoffStore.update(s => ({
            ...finalBrackets,
            history: { ...(s.history || {}), [queryLeagueID]: finalBrackets }
        }));

        return finalBrackets;
    }

    // --- PIPELINE B: LIVE API ROUTE ---
    try {
        const [rosterRes, leagueData] = await Promise.all([
            getLeagueRosters(queryLeagueID),
            getLeagueData(queryLeagueID)
        ]);

        const numRosters = Object.keys(rosterRes?.rosters || {}).length;
        const year = parseInt(leagueData.season);
        const playoffsStart = parseInt(leagueData.settings.playoff_week_start);

        let playoffType = 0;
        if (year > 2019) playoffType = parseInt(leagueData.settings.playoff_round_type);
        if (year === 2020 && playoffType === 1) playoffType = 2;

        const networkFetches = [
            fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/winners_bracket`, { compress: true }),
            fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/losers_bracket`, { compress: true }),
        ];

        // Fetch through week 18
        for (let i = playoffsStart; i < 19; i++) {
            networkFetches.push(
                fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`, { compress: true })
            );
        }

        const responses = await Promise.all(networkFetches);
        const playoffMatchups = await Promise.all(responses.map(res => res.json()));

        const winnersData = playoffMatchups.shift();
        const losersData = playoffMatchups.shift();

        const playoffRounds = winnersData?.[winnersData.length - 1]?.r || 0;
        const loserRounds = losersData?.[losersData.length - 1]?.r || 0;

        const champs = evaluateBracket(winnersData, playoffRounds, playoffMatchups, playoffType);
        const losers = evaluateBracket(losersData, loserRounds, playoffMatchups, playoffType);

        const finalBrackets = {
            numRosters,
            playoffsStart,
            playoffRounds,
            loserRounds,
            champs,
            losers,
            bracket: champs.bracket,
            year: year.toString(),
            leagueID: queryLeagueID
        };

        enginePlayoffStore.update(s => ({
            ...finalBrackets,
            history: { ...(s.history || {}), [queryLeagueID]: finalBrackets }
        }));

        return finalBrackets;

    } catch (err) {
        console.error("Error evaluating live playoff mapping stream:", err);
        return null;
    }
};

// --- CORE BRACKET EVALUATION ENGINE ALGORITHMS ---

const evaluateBracket = (contestants, rounds, playoffMatchups, playoffType) => {
    const bracket = [];
    const consolations = [];
    let consolationMs = [];
    let fromWs = [];
    const teamsSeen = {};

    for (let i = 1; i <= rounds; i++) {
        const playoffBrackets = contestants.filter(m => m.r == i);
        const roundMatchups = [];
        const consolationMatchups = [];
        let first = true;
        let localConsolationMs = [];
        let localFromWs = [];

        for (const playoffBracket of playoffBrackets) {
            if ((!playoffBracket.t1_from && playoffBracket.t2_from) || (!teamsSeen[playoffBracket.t1] && teamsSeen[playoffBracket.t2])) {
                const byeMatchup = processPlayoffMatchup({ playoffBracket, playoffMatchups, i: i - 2, consolationMs, fromWs, playoffType, teamsSeen });
                byeMatchup.bye = true;
                byeMatchup[0].m = null;
                byeMatchup[1].m = null;
                byeMatchup[0].r--;
                byeMatchup[1].r--;
                byeMatchup[1].roster_id = null;
                if (first) {
                    bracket[i - 2].unshift(byeMatchup);
                    first = false;
                } else {
                    bracket[i - 2].push(byeMatchup);
                }
            }

            teamsSeen[playoffBracket.t1] = playoffBracket.m;
            teamsSeen[playoffBracket.t2] = playoffBracket.m;

            const roundMatchup = processPlayoffMatchup({ playoffBracket, playoffMatchups, i: i - 1, consolationMs, fromWs, playoffType, teamsSeen });

            if (roundMatchup[0].winners) {
                localFromWs.push(roundMatchup[0].m);
            }
            if (roundMatchup[0].consolation) {
                localConsolationMs.push(roundMatchup[0].m);
                consolationMatchups.push(roundMatchup);
            } else {
                roundMatchups.push(roundMatchup);
            }
        }

        bracket.push(roundMatchups);

        for (const consolation of consolations) {
            for (const cm of consolationMatchups) {
                if (cm[0].winners && consolation[i - 2] && cm[0].t1From == consolation[i - 2][0][0].m) {
                    consolation[i - 1] = [cm];
                }
            }
        }

        const notFromWinners = consolationMatchups.filter(m => !m[0].fromWinners && !m[0].winners);
        const fromWinners = consolationMatchups.filter(m => m[0].fromWinners && !m[0].winners);

        if (notFromWinners.length) consolations.unshift(newConsolation(notFromWinners, rounds, i));
        if (fromWinners.length) consolations.push(newConsolation(fromWinners, rounds, i));

        fromWs = localFromWs;
        consolationMs = localConsolationMs;
    }

    return { bracket, consolations };
};

const newConsolation = (consolationMatchups, rounds, i) => {
    const newCons = new Array(rounds).fill([]);
    newCons[i - 1] = consolationMatchups;
    return newCons;
};

const processPlayoffMatchup = ({ playoffBracket, playoffMatchups, i, consolationMs, fromWs, playoffType, teamsSeen }) => {
    const matchup = [];
    const m = playoffBracket.m;
    const r = playoffBracket.r;
    const p = playoffBracket.p;
    const t1From = teamsSeen[playoffBracket.t1];
    const t2From = teamsSeen[playoffBracket.t2];
    const winners = playoffBracket.t1_from?.w && playoffBracket.t2_from?.w;
    const fromWinners = fromWs.includes(t2From || -999);

    let consolation = false;
    if ((p && p != 1) || (playoffBracket.t1_from?.l && playoffBracket.t2_from?.l) || consolationMs.includes(t1From) || consolationMs.includes(t2From)) {
        consolation = true;
    }

    const t1 = playoffBracket.t1;
    matchup.push(generateMatchupData(t1, t1From, { m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p }));

    const t2 = playoffBracket.t2;
    matchup.push(generateMatchupData(t2, t2From, { m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p }));

    return matchup;
};

const generateMatchupData = (t, tFrom, { m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p }) => {
    const matchup = {
        roster_id: null,
        points: undefined,
        starters: undefined,
        consolation,
        tFrom,
        m,
        r,
        winners,
        fromWinners,
    };

    if (t) {
        const tMatchup = playoffMatchups[i]?.find(ma => ma.roster_id == t);
        const starters = { 1: tMatchup?.starters };
        const startersPoints = { 1: tMatchup?.starters_points };

        if (playoffType === 2 || (p === 1 && playoffType === 1)) {
            const secondWeek = playoffMatchups[i + 1]?.find(ma => ma.roster_id == t);
            starters[2] = secondWeek?.starters;
            startersPoints[2] = secondWeek?.starters_points;
        }

        matchup.starters = starters;
        matchup.points = startersPoints;
        matchup.roster_id = t;
    }

    return matchup;
};
