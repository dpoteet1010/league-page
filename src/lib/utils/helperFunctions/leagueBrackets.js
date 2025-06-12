import { getLeagueData } from './leagueData';
import { leagueID } from '$lib/utils/leagueInfo';
import { getLeagueRosters } from './leagueRosters';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { brackets } from '$lib/stores';
import { legacyWinnersBrackets } from './legacyWinnersBrackets';
import { legacyLosersBrackets } from './legacyLosersBrackets';

export const getBrackets = async (queryLeagueID = leagueID) => {
    console.log('📦 Fetching brackets for leagueID:', queryLeagueID);

    if (get(brackets).champs && queryLeagueID == leagueID) {
        console.log('✅ Returning cached brackets');
        return get(brackets);
    }

    // ✅ Legacy leagues: use local bracket data
    if (queryLeagueID === '2023' || queryLeagueID === '2024') {
        console.log('🕰 Using legacy data for:', queryLeagueID);

        const winnersData = legacyWinnersBrackets[queryLeagueID];
        const losersData = legacyLosersBrackets[queryLeagueID];

        const playoffRounds = winnersData?.[winnersData.length - 1]?.r || 0;
        const loserRounds = losersData?.[losersData.length - 1]?.r || 0;
        const playoffsStart = 15;
        const playoffType = 0;

        // ⚠️ No API calls for legacy IDs
        const playoffMatchups = new Array(3).fill([]); // Stubbed for weeks 15–17

        const champs = evaluateBracket(winnersData, playoffRounds, playoffMatchups, playoffType);
        const losers = evaluateBracket(losersData, loserRounds, playoffMatchups, playoffType);

        const finalBrackets = {
            numRosters: 0,
            playoffsStart,
            playoffRounds,
            loserRounds,
            champs,
            losers,
            bracket: champs.bracket,
        };

        console.log('✅ Final legacy brackets:', finalBrackets);
        return finalBrackets;
    }

    // ✅ Modern Sleeper API flow
    const [rosterRes, leagueData] = await waitForAll(
        getLeagueRosters(queryLeagueID),
        getLeagueData(queryLeagueID)
    ).catch((err) => {
        console.error('❌ Roster or League Data fetch error:', err);
    });

    const numRosters = Object.keys(rosterRes.rosters).length;

    const year = parseInt(leagueData.season);
    const playoffsStart = parseInt(leagueData.settings.playoff_week_start);

    let playoffType = 0;
    if (year > 2019) playoffType = parseInt(leagueData.settings.playoff_round_type);
    if (year === 2020 && playoffType === 1) playoffType = 2;

    const bracketsAndMatchupFetches = [
        fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/winners_bracket`, { compress: true }),
        fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/losers_bracket`, { compress: true }),
    ];

    for (let i = playoffsStart; i < 19; i++) {
        bracketsAndMatchupFetches.push(
            fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/matchups/${i}`, { compress: true })
        );
    }

    const bracketsAndMatchupResps = await waitForAll(...bracketsAndMatchupFetches).catch((err) => {
        console.error('❌ Brackets and Matchups fetch error:', err);
    });

    const bracketsAndMatchupJson = [];
    for (const res of bracketsAndMatchupResps) {
        bracketsAndMatchupJson.push(res.json());
    }

    const playoffMatchups = await waitForAll(...bracketsAndMatchupJson).catch((err) => {
        console.error('❌ JSON Parsing error for brackets/matchups:', err);
    });

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
    };

    if (queryLeagueID == leagueID) {
        brackets.update(() => finalBrackets);
    }

    return finalBrackets;
};

const evaluateBracket = (contestants, rounds, playoffMatchups, playoffType) => {
    console.log(`🔍 evaluateBracket called — rounds: ${rounds}, playoffType: ${playoffType}`);
    const bracket = [];
    const consolations = [];
    let consolationMs = [];
    let fromWs = [];
    const teamsSeen = {};

    for (let i = 1; i <= rounds; i++) {
        console.log(`➡️ Evaluating Round ${i}`);
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

    console.log('🏁 Bracket Evaluation Complete:', bracket);
    return { bracket, consolations };
}

const newConsolation = (consolationMatchups, rounds, i) => {
    const newCons = new Array(rounds).fill([]);
    newCons[i - 1] = consolationMatchups;
    return newCons;
}

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
}

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
}
