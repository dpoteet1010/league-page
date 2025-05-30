import { getLeagueData } from './leagueData';
import { getLeagueRosters } from './leagueRosters';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { awards } from '$lib/stores';
import { legacyWinnersBrackets } from './legacyWinnersBrackets.js';
import { legacyLosersBrackets } from './legacyLosersBrackets.js';

export const getAwards = async () => {
	if(get(awards).length) {
		return get(awards);
	}
	const leagueData = await getLeagueData().catch((err) => { console.error(err); });

	let previousSeasonID = leagueData.status === "complete"
		? leagueData.league_id
		: leagueData.previous_league_id;

	const podiums = await getPodiums(previousSeasonID);

	awards.update(() => podiums);

	return podiums;
};

const getPodiums = async (previousSeasonID) => {
	const podiums = [];

	while(previousSeasonID && previousSeasonID !== 0) {
		const previousSeasonData = await getPreviousLeagueData(previousSeasonID);

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

		previousSeasonID = previousSeasonData.previousSeasonID;

		const divisions = buildDivisionsAndManagers({ previousRosters, leagueMetadata, numDivisions });

		const divisionArr = Object.values(divisions);

		const finalsMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.w);
		const champion = finalsMatch?.w;
		const second = finalsMatch?.l;

		const runnersUpMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.l);
		const third = runnersUpMatch?.w;

		const toiletBowlMatch = losersData.find(m => m.r === toiletRounds && (!m.t1_from || m.t1_from.w));
		const toilet = toiletBowlMatch?.w;

		if (!champion) {
			continue;
		}

		const podium = {
			year,
			champion,
			second,
			third,
			divisions: divisionArr,
			toilet
		};
		podiums.push(podium);
	}
	return podiums;
};

const getPreviousLeagueData = async (previousSeasonID) => {
	const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}`, { compress: true }).catch(err => console.error(err));
	if (!leagueRes.ok) throw new Error('Failed to fetch league data');

	const prevLeagueData = await leagueRes.json();
	const year = prevLeagueData.season;

	const useLegacy = legacyWinnersBrackets[year] && legacyLosersBrackets[year];

	let winnersData, losersData;

	if (useLegacy) {
		winnersData = legacyWinnersBrackets[year];
		losersData = legacyLosersBrackets[year];
	} else {
		const [losersRes, winnersRes] = await waitForAll(
			fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/losers_bracket`, { compress: true }),
			fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/winners_bracket`, { compress: true })
		).catch((err) => { console.error(err); });

		if (!losersRes.ok || !winnersRes.ok) {
			throw new Error('Failed to fetch bracket data');
		}

		[losersData, winnersData] = await waitForAll(
			losersRes.json(),
			winnersRes.json()
		).catch((err) => { console.error(err); });
	}

	const rostersData = await getLeagueRosters(previousSeasonID);
	const previousRosters = rostersData.rosters;

	const numDivisions = prevLeagueData.settings.divisions || 1;
	previousSeasonID = prevLeagueData.previous_league_id;

	const playoffRounds = winnersData[winnersData.length - 1].r;
	const toiletRounds = losersData[losersData.length - 1].r;

	return {
		losersData,
		winnersData,
		year,
		previousRosters,
		numDivisions,
		previousSeasonID,
		playoffRounds,
		toiletRounds,
		leagueMetadata: prevLeagueData.metadata
	};
};

const buildDivisionsAndManagers = ({ previousRosters, leagueMetadata, numDivisions }) => {
	const divisions = {};

	for (let i = 1; i <= numDivisions; i++) {
		divisions[i] = {
			name: leagueMetadata ? leagueMetadata[`division_${i}`] : null,
			wins: -1,
			points: -1
		};
	}

	for (const rosterID in previousRosters) {
		const rSettings = previousRosters[rosterID].settings;
		const div = !rSettings.division || rSettings.division > numDivisions ? 1 : rSettings.division;

		const totalPoints = rSettings.fpts + rSettings.fpts_decimal / 100;
		const current = divisions[div];

		if (
			rSettings.wins > current.wins ||
			(rSettings.wins === current.wins && totalPoints > current.points)
		) {
			current.points = totalPoints;
			current.wins = rSettings.wins;
			current.rosterID = rosterID;
		}
	}

	return divisions;
};
