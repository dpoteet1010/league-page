import { leagueID } from '$lib/utils/leagueInfo';
import { get } from 'svelte/store';
import { rostersStore } from '$lib/stores';
import { legacyLeagueRosters } from './legacyLeagueRosters.js';

// ✅ Must be declared at top-level scope
let legacyAppended = false;

export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	// 🧠 Append and process legacy rosters once per session
	if (!legacyAppended) {
		rostersStore.update(current => {
			const merged = { ...current };

			for (const [key, legacy] of Object.entries(legacyLeagueRosters)) {
				if (!merged[key]) {
					if (
						!legacy.rosters ||
						typeof legacy.rosters !== 'object' ||
						Array.isArray(legacy.rosters)
					) {
						continue;
					}

					// 🛠 Convert legacy rosters object to array
					const rosterArray = Object.values(legacy.rosters);
					const processed = processRosters(rosterArray);
					merged[key] = processed;
				}
			}

			return merged;
		});
		legacyAppended = true;
	}

	// 🔍 Check the updated store for this league
	const storedRoster = get(rostersStore)[queryLeagueID];
	if (
		storedRoster &&
		typeof storedRoster.rosters === 'object' &&
		!Array.isArray(storedRoster.rosters) &&
		storedRoster.rosters !== null
	) {
		return storedRoster;
	}

	// ⬇️ Fallback to live Sleeper API fetch
	let res;
	try {
		res = await fetch(`https://api.sleeper.app/v1/league/${queryLeagueID}/rosters`, {
			compress: true
		});
	} catch (err) {
		throw new Error('Network error fetching roster data.');
	}

	let data;
	try {
		data = await res.json();
	} catch (err) {
		throw new Error('Invalid JSON in API response.');
	}

	if (res.ok) {
		const processedRosters = processRosters(data);
		rostersStore.update(r => {
			r[queryLeagueID] = processedRosters;
			return r;
		});
		return processedRosters;
	} else {
		throw new Error(data);
	}
};

const processRosters = (rosters) => {
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

	return { rosters: rosterMap, startersAndReserve };
};
