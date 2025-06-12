import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from './legacyLeagueRosters.js';

let legacyAppended = false; // Ensures static data is added only once

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	console.log(`🔍 getLeagueRosters called for: ${queryLeagueID}`);

	// Step 1: Append legacy rosters once per session
	if (!legacyAppended) {
		console.log("📦 Appending legacy rosters to rostersStore...");
		rostersStore.update(current => {
			const merged = { ...current };
			for (const key in legacyLeagueRosters) {
				if (!merged[key]) {
					console.log(`✅ Adding legacy season ${key} to rostersStore`);
					merged[key] = legacyLeagueRosters[key];
				}
			}
			return merged;
		});
		legacyAppended = true;
		console.log("✅ Legacy rosters appended.");
	}

	const storeSnapshot = get(rostersStore);
	console.log("🧪 Current rostersStore snapshot:", storeSnapshot);

	const storedRoster = storeSnapshot[queryLeagueID];
	console.log(`📦 Checking storedRoster for ${queryLeagueID}:`, storedRoster);

	// Step 2: Defensive fallback for legacy wrapper
	if (
		storedRoster &&
		!storedRoster.rosters &&
		typeof storedRoster === 'object'
	) {
		console.warn(`⚠️ Legacy data for ${queryLeagueID} is missing 'rosters' wrapper. Wrapping manually.`);
		return { rosters: storedRoster };
	}

	// Step 3: Validate and return if already in store
	const isValid =
		storedRoster &&
		typeof storedRoster.rosters === 'object' &&
		!Array.isArray(storedRoster.rosters) &&
		storedRoster.rosters !== null;

	console.log(`📦 Is storedRoster valid for ${queryLeagueID}?`, isValid);

	if (isValid) {
		console.log(`✅ Returning storedRoster for ${queryLeagueID}`);
		return storedRoster;
	}

	// Step 4: Fetch from Sleeper API if not in store
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

	if (res.ok) {
		console.log(`✅ Sleeper API fetch succeeded for ${queryLeagueID}. Processing rosters...`);
		const processedRosters = processRosters(data);
		rostersStore.update(r => {
			r[queryLeagueID] = processedRosters;
			return r;
		});
		console.log(`✅ Rosters for ${queryLeagueID} saved to rostersStore`);
		return processedRosters;
	} else {
		console.error("❌ Sleeper API returned an error:", data);
		throw new Error(data);
	}
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
