export const getLeagueRosters = async (queryLeagueID = leagueID) => {
	// Append and process legacy rosters once per session
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

					// Convert legacy rosters object to array
					const rosterArray = Object.values(legacy.rosters);
					const processed = processRosters(rosterArray);
					merged[key] = processed;
				}
			}

			return merged;
		});
		legacyAppended = true;
	}

	// 🔍 Now check the updated store
	const storedRoster = get(rostersStore)[queryLeagueID];
	if (
		storedRoster &&
		typeof storedRoster.rosters === 'object' &&
		!Array.isArray(storedRoster.rosters) &&
		storedRoster.rosters !== null
	) {
		return storedRoster;
	}

	// ⬇️ Fallback to Sleeper API
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
