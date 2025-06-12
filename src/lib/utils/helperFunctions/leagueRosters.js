import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from './legacyLeagueRosters.js';

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	console.log(`📥 getLeagueRosters called with league ID: ${queryLeagueID}`);

	const storedRoster = get(rostersStore)[queryLeagueID];

	// If already in store and valid, return it
	if (
		storedRoster &&
		typeof storedRoster.rosters === 'object' &&
		!Array.isArray(storedRoster.rosters) &&
		storedRoster.rosters !== null
	) {
		console.log(`✅ Returning roster from store for league ${queryLeagueID}`);
		return storedRoster;
	}

	// Check if this league is in legacy format
	const legacyMatch = legacyLeagueRosters.find(lr => String(lr.year) === String(queryLeagueID));
	if (legacyMatch) {
		console.log(`📦 Using legacy rosters for league ${queryLeagueID}`);
		console.log(`🗃️ Raw legacy roster data:`, legacyMatch);

		const legacyRosters = legacyMatch.rosters;

		if (!Array.isArray(legacyRosters)) {
			console.error(`❌ Legacy data for ${queryLeagueID} must be an array`, legacyRosters);
			throw new Error(`❌ Legacy data for ${queryLeagueID} must be an array`);
		}

		const processed = processRosters(legacyRosters);
		console.log(`🛠️ Processed legacy roster data:`, processed);

		rostersStore.update(r => {
			r[queryLeagueID] = processed;
			return r;
		});

		console.log(`📝 Legacy roster data stored for league ${queryLeagueID}`);
		return processed;
	}

	// Else, fetch from Sleeper API
	console.log(`🌐 Fetching rosters from Sleeper API for league ${queryLeagueID}...`);

	let res, data;
	try {
		res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, {
			compress: true
		});
		data = await res.json();
	} catch (err) {
		console.error(`❌ Error fetching or parsing data from Sleeper API for ${queryLeagueID}:`, err);
		throw err;
	}

	if (res.ok) {
		console.log(`✅ Successfully fetched roster data from API for league ${queryLeagueID}`);
		const processed = processRosters(data);
		console.log(`🛠️ Processed API roster data:`, processed);

		rostersStore.update(r => {
			r[queryLeagueID] = processed;
			return r;
		});

		console.log(`📝 API roster data stored for league ${queryLeagueID}`);
		return processed;
	} else {
		console.error(`❌ API error for league ${queryLeagueID}:`, data);
		throw new Error(data);
	}
};

const processRosters = (rosters) => {
	console.log(`🔄 Processing ${rosters.length} rosters...`);

	const startersAndReserve = [];
	const rosterMap = {};

	for (const roster of rosters) {
		console.log(`➡️ Processing roster ID ${roster.roster_id}`);

		if (Array.isArray(roster.starters)) {
			console.log(`✅ Found starters for roster ${roster.roster_id}:`, roster.starters);
			startersAndReserve.push(...roster.starters);
		}

		if (Array.isArray(roster.reserve)) {
			console.log(`✅ Found reserve for roster ${roster.roster_id}:`, roster.reserve);
			startersAndReserve.push(...roster.reserve);
		}

		rosterMap[roster.roster_id] = roster;
	}

	console.log(`✅ Completed processing rosters. Total players (starters + reserve): ${startersAndReserve.length}`);

	return {
		rosters: rosterMap,
		startersAndReserve
	};
};
