import { getLeagueData } from './leagueDataServer';
import { getLeagueRosters } from './leagueRostersServer';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { legacyWinnersBrackets } from './helperFunctions/legacyWinnersBrackets';
import { legacyLosersBrackets } from './helperFunctions/legacyLosersBrackets';
import { legacyMatchups } from './helperFunctions/legacyMatchups';

/**
 * Server-side version of getBrackets.
 * Removed Svelte store dependencies and manual Svelte-based fetch wrappers.
 */
export const getBrackets = async (queryLeagueID = defaultLeagueID) => {
    // 1. HANDLE LEGACY DATA (2023, 2024, etc)
    if (queryLeagueID === '2023' || queryLeagueID === '2024') {
        const winnersData = legacyWinnersBrackets[queryLeagueID];
        const losersData = legacyLosersBrackets[queryLeagueID];

        const playoffRounds = winnersData?.[winnersData.length - 1]?.r || 0;
        const loserRounds = losersData?.[losersData.length - 1]?.r || 0;
        const playoffsStart = 15;
        const playoffType = 0;

        const playoffMatchups = [winnersData, losersData];

        for (let week = playoffsStart; week < 18; week++) {
            const legacyWeekMatchups = legacyMatchups?.[queryLeagueID]?.[week] || [];
            playoffMatchups.push(legacyWeekMatchups);
        }

        const winnersBracketData = playoffMatchups.shift();
        const losersBracketData = playoffMatchups.shift();

        const champs = evaluateBracket(winnersBracketData, playoffRounds, playoffMatchups, playoffType);
        const losers = evaluateBracket(losersBracketData, loserRounds, playoffMatchups, playoffType);

        return {
            numRosters: 0,
            playoffsStart,
            playoffRounds,
            loserRounds,
            champs,
            losers,
            bracket: champs.bracket,
        };
    }

    // 2. HANDLE LIVE API DATA
    const [rosterData, leagueData] = await Promise.all([
        getLeagueRosters(queryLeagueID),
        getLeagueData(queryLeagueID)
    ]);

    const numRosters = Object.keys(rosterData.rosters).length;
    const year = parseInt(leagueData.season);
    const playoffsStart = parseInt(leagueData.settings.playoff_week_start);

    let playoffType = 0;
    if (year > 2019) playoffType = parseInt(leagueData.settings.playoff_round_type);
    if (year === 2020 && playoffType === 1) playoffType = 2;

    const fetches = [
        fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/winners_bracket`).then(res => res.json()),
        fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/losers_bracket`).then(res => res.json()),
    ];

    // Fetch matchups for every playoff week
    for (let i = playoffsStart; i < 19; i++) {
        fetches.push(fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`).then(res => res.json()));
    }

    const results = await Promise.all(fetches);
    
    const winnersData = results.shift();
    const losersData = results.shift();
    const playoffMatchups = results;

    const playoffRounds = winnersData?.[winnersData.length - 1]?.r || 0;
    const loserRounds = losersData?.[losersData.length - 1]?.r || 0;

    const champs = evaluateBracket(winnersData, playoffRounds, playoffMatchups, playoffType);
    const losers = evaluateBracket(losersData, loserRounds, playoffMatchups, playoffType);

    return {
        numRosters,
        playoffsStart,
        playoffRounds,
        loserRounds,
        champs,
        losers,
        bracket: champs.bracket,
    };
};

// --- CORE LOGIC (Kept intact but cleaned of Svelte dependencies) ---

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
        const localConsolationMs = [];
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
                    bracket[i - 2]?.unshift(byeMatchup);
                    first = false;
                } else {
                    bracket[i - 2]?.push(byeMatchup);
                }
            }

            teamsSeen[playoffBracket.t1] = playoffBracket.m;
            teamsSeen[playoffBracket.t2] = playoffBracket.m;

            const roundMatchup = processPlayoffMatchup({ playoffBracket, playoffMatchups, i: i - 1, consolationMs, fromWs, playoffType, teamsSeen });

            if (roundMatchup[0].winners) localFromWs.push(roundMatchup[0].m);
            
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
    const { m, r, p } = playoffBracket;
    const t1From = teamsSeen[playoffBracket.t1];
    const t2From = teamsSeen[playoffBracket.t2];
    const winners = playoffBracket.t1_from?.w && playoffBracket.t2_from?.w;
    const fromWinners = fromWs.includes(t2From || -999);

    let consolation = false;
    if ((p && p != 1) || (playoffBracket.t1_from?.l && playoffBracket.t2_from?.l) || consolationMs.includes(t1From) || consolationMs.includes(t2From)) {
        consolation = true;
    }

    matchup.push(generateMatchupData(playoffBracket.t1, t1From, { m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p }));
    matchup.push(generateMatchupData(playoffBracket.t2, t2From, { m, r, playoffMatchups, i, playoffType, winners, fromWinners, consolation, p }));

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
