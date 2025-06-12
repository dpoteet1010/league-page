import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from '$lib/data/legacyRosters';

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	const storedRoster = get(rostersStore)[queryLeagueID];

	// If already in store and valid, return it
	if (
		storedRoster &&
		typeof storedRoster.rosters === 'object' &&
		!Array.isArray(storedRoster.rosters) &&
		storedRoster.rosters !== null
	) {
		return storedRoster;
	}

	// Check if this league is in legacy format
	const legacyMatch = legacyLeagueRosters.find(lr => String(lr.year) === String(queryLeagueID));
	if (legacyMatch) {
		console.log(`📦 Using legacy rosters for league ${queryLeagueID}`);
		const legacyRosters = legacyMatch.rosters;

		if (!Array.isArray(legacyRosters)) {
			throw new Error(`❌ Legacy data for ${queryLeagueID} must be an array`);
		}

		const processed = processRosters(legacyRosters);
		rostersStore.update(r => {
			r[queryLeagueID] = processed;
			return r;
		});
		return processed;
	}

	// Else, fetch from Sleeper API
	const res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, {
		compress: true
	}).catch(err => {
		console.error(err);
	});
	const data = await res.json().catch(err => {
		console.error(err);
	});

	if (res.ok) {
		const processed = processRosters(data);
		rostersStore.update(r => {
			r[queryLeagueID] = processed;
			return r;
		});
		return processed;
	} else {
		throw new Error(data);
	}
};

const processRosters = (rosters) => {
	const startersAndReserve = [];
	const rosterMap = {};

	for (const roster of rosters) {
		if (Array.isArray(roster.starters)) {
			startersAndReserve.push(...roster.starters);
		}
		if (Array.isArray(roster.reserve)) {
			startersAndReserve.push(...roster.reserve);
		}
		rosterMap[roster.roster_id] = roster;
	}

	return {
		rosters: rosterMap,
		startersAndReserve
	};
};
