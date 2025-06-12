import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from './legacyLeagueRosters.js';

let legacyAppended = false; // Ensures static data is added only once

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	// Append and process legacy rosters once per session
	if (!legacyAppended) {
		console.log('📦 Preloading legacy rosters into rostersStore...');
		rostersStore.update(current => {
			const merged = { ...current };
			for (const legacy of legacyLeagueRosters) {
				const key = String(legacy.year);
				if (!merged[key]) {
					if (!Array.isArray(legacy.rosters)) {
						console.error(`❌ Invalid legacy data for ${key}:`, legacy.rosters);
						continue;
					}
					const processed = processRosters(legacy.rosters);
					merged[key] = processed;
					console.log(`✅ Legacy roster pre-stored for league ${key}`);
				}
			}
			return merged;
		});
		legacyAppended = true;
	}

	const storedRoster = get(rostersStore)[queryLeagueID];
	if (
		storedRoster &&
		typeof storedRoster.rosters === 'object' &&
		!Array.isArray(storedRoster.rosters) &&
		storedRoster.rosters !== null
	) {
		console.log(`✅ Returning roster from store for league ${queryLeagueID}`);
		return storedRoster;
	}

	// Fetch from Sleeper API
	console.log(`🌐 Fetching rosters from Sleeper API for league ${queryLeagueID}...`);
	let res;
	try {
		res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, {
			compress: true
		});
	} catch (err) {
		console.error('❌ Fetch error:', err);
		throw new Error('Network error fetching roster data.');
	}

	let data;
	try {
		data = await res.json();
	} catch (err) {
		console.error('❌ JSON parsing error:', err);
		throw new Error('Invalid JSON in API response.');
	}

	if (res.ok) {
		const processedRosters = processRosters(data);
		console.log(`✅ Fetched and processed API rosters for ${queryLeagueID}`);
		rostersStore.update(r => {
			r[queryLeagueID] = processedRosters;
			return r;
		});
		return processedRosters;
	} else {
		console.error('❌ Sleeper API error:', data);
		throw new Error(data);
	}
};

const processRosters = (rosters) => {
	console.log(`🔄 Processing ${rosters.length} rosters...`);
	const startersAndReserve = [];
	const rosterMap = {};
	for (const roster of rosters) {
		if (Array.isArray(roster.starters)) {
			for (const starter of roster.starters) {
				startersAndReserve.push(starter);
			}
		}
		if (Array.isArray(roster.reserve)) {
			for (const ir of roster.reserve) {
				startersAndReserve.push(ir);
			}
		}
		rosterMap[roster.roster_id] = roster;
	}
	console.log(`✅ Processed ${Object.keys(rosterMap).length} rosters`);
	return { rosters: rosterMap, startersAndReserve };
};
