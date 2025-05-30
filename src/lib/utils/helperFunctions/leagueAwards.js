import { getLeagueData } from './leagueData';
import { getLeagueRosters } from './leagueRosters';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { awards } from '$lib/stores';
import { legacyWinnersBrackets } from './legacyWinnersBrackets.js';
import { legacyLosersBrackets } from './legacyLosersBrackets.js';

let legacyBracketsAppended = false;

export const getAwards = async () => {
	if (get(awards).length) {
		return get(awards);
	}

	// Fetch current league info
	const leagueData = await getLeagueData().catch(err => {
		console.error(err);
	});

	let previousSeasonID = leagueData.status === "complete"
		? leagueData.league_id
		: leagueData.previous_league_id;

	const podiums = await getPodiums(previousSeasonID);

	awards.update(() => podiums);

	return podiums;
};

const getPodiums = async (previousSeasonID) => {
	const podiums = [];

	while (previousSeasonID && previousSeasonID !== 0) {
		const previousSeasonData = await getPreviousLeagueData(previousSeasonID);

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

		previousSeasonID = previousSeasonData.previousSeasonID;

		const divisions = buildDivisionsAndManagers({
			previousRosters,
			leagueMetadata,
			numDivisions
		});

		const divisionArr = Object.values(divisions);

		const finalsMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.w);
		const champion = finalsMatch?.w;
		const second = finalsMatch?.l;

		const runnersUpMatch = winnersData.find(m => m.r === playoffRounds && m.t1_from?.l);
		const third = runnersUpMatch?.w;

		const toiletBowlMatch = losersData.find(m => m.r === toiletRounds && (!m.t1_from || m.t1_from.w));
		const toilet = toiletBowlMatch?.w;

		if (!champion) continue;

		podiums.push({
			year,
			champion,
			second,
			third,
			divisions: divisionArr,
			toilet
		});
	}

	// Add static legacy data if not already added
	if (!legacyBracketsAppended) {
		for (const [yearStr, winnersData] of Object.entries(legacyWinnersBrackets)) {
			const year = Number(yearStr);
			if (podiums.find(p => p.year === year)) continue; // Skip if already included

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

			if (!champion) continue;

			podiums.push({
				year,
				champion,
				second,
				third,
				divisions: [], // Legacy doesn't have division info
				toilet
			});
		}
		legacyBracketsAppended = true;
	}

	return podiums.sort((a, b) => b.year - a.year); // Sort newest first
};

const getPreviousLeagueData = async (previousSeasonID) => {
	try {
		const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}`, { compress: true });
		if (!leagueRes.ok) throw new Error('Failed to fetch league data');

		const prevLeagueData = await leagueRes.json();
		const year = Number(prevLeagueData.season);

		let winnersData, losersData;

		// Use legacy if available
		if (legacyWinnersBrackets[year] && legacyLosersBrackets[year]) {
			winnersData = legacyWinnersBrackets[year];
			losersData = legacyLosersBrackets[year];
		} else {
			const [losersRes, winnersRes] = await waitForAll(
				fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/losers_bracket`, { compress: true }),
				fetch(`https://api.sleeper.app/v1/league/${previousSeasonID}/winners_bracket`, { compress: true })
			);

			if (!losersRes.ok || !winnersRes.ok) throw new Error('Bracket data fetch failed');

			[losersData, winnersData] = await waitForAll(losersRes.json(), winnersRes.json());
		}

		const rostersData = await getLeagueRosters(previousSeasonID);
		const previousRosters = rostersData.rosters;

		const numDivisions = prevLeagueData.settings.divisions || 1;
		const playoffRounds = winnersData[winnersData.length - 1].r;
		const toiletRounds = losersData[losersData.length - 1].r;

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
