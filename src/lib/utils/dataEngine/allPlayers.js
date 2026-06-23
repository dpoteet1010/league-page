// allPlayers.js
//
// Fetches the full Sleeper NFL player database and caches it in memory.
// Used purely for display — resolving player IDs to human-readable names.
// The endpoint returns ~5MB so we only ever fetch it once per session and
// optionally persist to localStorage to avoid re-fetching on page reload.
//
// Shape of each player object from Sleeper:
//   { player_id, full_name, first_name, last_name, position, team, ... }

import { browser } from '$app/environment';

const CACHE_KEY = 'sleeper_players_cache';
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours

// In-memory cache — survives the session without re-fetching
let playersCache = null;

/**
 * Returns the full Sleeper player map: { [player_id]: { full_name, position, team, ... } }
 * Hits localStorage first (if < 24h old), then the Sleeper API, then memory.
 */
export async function getAllPlayers() {
	// 1. Already in memory this session
	if (playersCache) return playersCache;

	// 2. Try localStorage (browser only)
	if (browser) {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				const age = Date.now() - (parsed.fetchedAt || 0);
				if (age < CACHE_MAX_AGE_MS && parsed.players) {
					playersCache = parsed.players;
					return playersCache;
				}
			}
		} catch {
			// localStorage parse failure — fall through to fetch
		}
	}

	// 3. Fetch from Sleeper
	try {
		const res = await fetch('https://api.sleeper.app/v1/players/nfl', { compress: true });
		if (!res.ok) throw new Error(`Sleeper players API returned ${res.status}`);
		const data = await res.json();
		playersCache = data;

		if (browser) {
			try {
				localStorage.setItem(CACHE_KEY, JSON.stringify({ players: data, fetchedAt: Date.now() }));
			} catch {
				// localStorage quota exceeded — not a problem, we still have memory cache
			}
		}

		return playersCache;
	} catch (err) {
		console.error('getAllPlayers fetch failed:', err);
		return {};
	}
}

/**
 * Returns a lightweight name-only lookup map: { [player_id]: "First Last (POS)" }
 * Useful for display in tables where you just want a string.
 */
export function buildPlayerNameMap(allPlayersData) {
	const map = {};
	for (const id in allPlayersData) {
		const p = allPlayersData[id];
		const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Player ${id}`;
		const pos = p.position ? ` (${p.position})` : '';
		map[id] = `${name}${pos}`;
	}
	return map;
}
