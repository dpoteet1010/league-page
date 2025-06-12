import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from './legacyLeagueRosters.js';

let legacyAppended = false; // Ensures static data is added only once

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	console.log(`🔍 getLeagueRosters called for: ${queryLeagueID}`);

	// Step 0: Return immediately if this is a legacy season
	if (queryLeagueID === '2023' || queryLeagueID === '2024') {
		console.log(`📦 Using legacy rosters for league ${queryLeagueID}`);
		const legacyData = legacyLeagueRosters[queryLeagueID];
		if (!legacyData) {
			throw new Error(`❌ No legacy data found for league ${queryLeagueID}`);
		}
		return legacyData;
	}

	// Step 1: Append legacy rosters once per session (only for non-legacy requests)
	if (!legacyAppended) {
		console.log("📦 Appending legacy rosters to rostersStore...");
		rostersStore.update(current => {
			const merged = { ...current };
			for (const key in legacyLeagueRosters) {
				if (!merged[key]) {
					console.log(`✅ Adding legacy season ${key} to rostersStore`);
					merged[key] = { rosters: legacyLeagueRosters[key] };
				}
			}
			return merged;
		});
		legacyAppended = true;
		console.log("✅ Legacy rosters appended.");
	}

	const storeSnapshot = get(rostersStore);
	const storedRoster = storeSnapshot[queryLeagueID];

	// Step 2: Return from store if already valid
	if (storedRoster && storedRoster.rosters && typeof storedRoster.rosters === 'object') {
		console.log(`✅ Returning cached roster for ${queryLeagueID}`);
		return storedRoster;
	}

	// Step 3: Fetch from Sleeper API
	console.log(`🌐 Fetching rosters from Sleeper API for ${queryLeagueID}`);
	let res;
	try {
		res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, { compress: true });
	} catch (err) {
		console.error("❌ Fetch error:", err);
		throw new Error("Network error fetching roster data.");
	}

	let data;
	try {
		data = await res.json();
	} catch (err) {
		console.error("❌ JSON parsing error:", err);
		throw new Error("Invalid JSON in API response.");
	}

	if (!res.ok) {
		console.error("❌ Sleeper API returned an error:", data);
		throw new Error(data);
	}

	const processedRosters = processRosters(data);
	rostersStore.update(r => {
		r[queryLeagueID] = processedRosters;
		return r;
	});
	console.log(`✅ Rosters for ${queryLeagueID} saved to rostersStore`);
	return processedRosters;
};

// Helper: Format API response into internal structure
const processRosters = (rosters) => {
	const startersAndReserve = [];
	const rosterMap = {};
	for (const roster of rosters) {
		for (const starter of roster.starters) {
			startersAndReserve.push(starter);
		}
		if (roster.reserve) {
			for (const ir of roster.reserve) {
				startersAndReserve.push(ir);
			}
		}
		rosterMap[roster.roster_id] = roster;
	}
	console.log(`🛠️ Processed ${Object.keys(rosterMap).length} rosters`);
	return { rosters: rosterMap, startersAndReserve };
};
