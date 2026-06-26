// allDrafts.js
//
// Fetches and normalizes draft data across all seasons.
// Handles legacy seasons (localDrafts.js + draftSummaries.js) and
// live Sleeper API seasons. Returns a clean normalized format for
// draftAnalysis.js to consume.
//
// Normalized pick format:
// {
//   playerId, playerName, position, team,
//   round, pickNo, slot, rosterId, managerId,
//   year, draftType
// }

import { get } from 'svelte/store';
import { leagueID as mainLeagueID } from '$lib/utils/leagueInfo';
import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
import { localDrafts } from '$lib/utils/helperFunctions/localDrafts.js';
import { draftSummaries } from '$lib/utils/helperFunctions/draft_summary.js';
import { teamManagersStore } from '$lib/stores';

const draftCache = {};

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Fetch timeout: ${url}`)), timeout)
    )
  ]);
}

/**
 * Builds a rosterId → managerId map for a given year.
 */
function getRosterToManagerMap(managersSnapshot, year) {
  const yearMap = managersSnapshot?.teamManagersMap?.[String(year)] || {};
  const out = {};
  Object.entries(yearMap).forEach(([rosterId, teamInfo]) => {
    const managerId = teamInfo?.managers?.[0] ?? null;
    if (managerId != null) out[String(rosterId)] = managerId;
  });
  return out;
}

/**
 * Normalizes a raw pick object (from localDrafts or Sleeper API picks endpoint)
 * into our clean format.
 */
function normalizePick(rawPick, slotToRosterId, rosterToManager, year, draftType, allPlayersData) {
  const playerId   = String(rawPick.player_id || rawPick.metadata?.player_id || '');
  const round      = rawPick.round;
  const slot       = rawPick.draft_slot;
  const pickNo     = rawPick.pick_no;
  const rosterId   = String(slotToRosterId?.[String(slot)] || rawPick.roster_id || '');
  const managerId  = rosterToManager?.[rosterId] ?? null;

  const playerInfo = allPlayersData[playerId];
  const playerName = playerInfo?.full_name ||
    (playerInfo ? `${playerInfo.first_name || ''} ${playerInfo.last_name || ''}`.trim() : null) ||
    rawPick.metadata?.first_name
      ? `${rawPick.metadata.first_name} ${rawPick.metadata.last_name}`.trim()
      : `Player ${playerId}`;

  const position = playerInfo?.position || rawPick.metadata?.position || null;
  const team     = playerInfo?.team || rawPick.metadata?.team || null;

  return {
    playerId,
    playerName,
    position,
    team,
    round,
    pickNo,
    slot,
    rosterId,
    managerId,
    year: Number(year),
    draftType: draftType || 'snake'
  };
}

/**
 * Processes legacy seasons from localDrafts.js + draftSummaries.js.
 */
function buildLegacyDrafts(allPlayersData, managersSnapshot) {
  const drafts = [];
  if (!Array.isArray(draftSummaries) || !Array.isArray(localDrafts)) return drafts;

  const groupedByYear = localDrafts.reduce((acc, pick) => {
    const year = parseInt(pick.draft_id);
    if (!acc[year]) acc[year] = [];
    acc[year].push(pick);
    return acc;
  }, {});

  for (const summary of draftSummaries) {
    const year = parseInt(summary.season);
    const rawPicks = groupedByYear[year];
    if (!rawPicks || rawPicks.length === 0) continue;
    if (!summary.slot_to_roster_id || !summary.settings?.rounds) continue;

    const rosterToManager = getRosterToManagerMap(managersSnapshot, year);

    const picks = rawPicks
      .map((raw) => normalizePick(
        raw,
        summary.slot_to_roster_id,
        rosterToManager,
        year,
        summary.type,
        allPlayersData
      ))
      .filter((p) => p.playerId && p.round && p.pickNo);

    if (picks.length === 0) continue;

    drafts.push({
      year,
      draftId:       String(summary.draft_id),
      draftType:     summary.type,
      rounds:        summary.settings.rounds,
      numTeams:      summary.settings.teams || 12,
      slotToRosterId: summary.slot_to_roster_id,
      rosterToManager,
      picks
    });
  }

  return drafts;
}

/**
 * Fetches live Sleeper drafts for the current and previous seasons
 * by walking the previous_league_id chain.
 */
async function buildLiveDrafts(allPlayersData, managersSnapshot) {
  const drafts = [];
  let curSeason = mainLeagueID;
  let iterations = 0;

  while (curSeason && curSeason !== 0 && iterations < 10) {
    iterations++;

    try {
      const [leagueData, draftsRes] = await Promise.all([
        getLeagueData(curSeason),
        fetchWithTimeout(`https://api.sleeper.app/v1/league/${curSeason}/drafts`)
      ]);

      if (!leagueData || !draftsRes.ok) break;

      const seasonDrafts = await draftsRes.json();
      if (!Array.isArray(seasonDrafts) || seasonDrafts.length === 0) {
        curSeason = leagueData.previous_league_id;
        continue;
      }

      for (const draftInfo of seasonDrafts) {
        if (draftInfo.status !== 'complete') continue;

        const draftId = draftInfo.draft_id;
        const year    = parseInt(draftInfo.season);

        try {
          const [picksRes] = await Promise.all([
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftId}/picks`, { compress: true })
          ]);

          if (!picksRes.ok) continue;
          const rawPicks = await picksRes.json();
          if (!Array.isArray(rawPicks)) continue;

          const rosterToManager = getRosterToManagerMap(managersSnapshot, year);

          const picks = rawPicks
            .map((raw) => normalizePick(
              raw,
              draftInfo.slot_to_roster_id,
              rosterToManager,
              year,
              draftInfo.type,
              allPlayersData
            ))
            .filter((p) => p.playerId && p.round && p.pickNo);

          if (picks.length === 0) continue;

          drafts.push({
            year,
            draftId:        String(draftId),
            draftType:      draftInfo.type,
            rounds:         draftInfo.settings.rounds,
            numTeams:       draftInfo.settings.teams || 12,
            slotToRosterId: draftInfo.slot_to_roster_id,
            rosterToManager,
            picks
          });

        } catch {
          continue;
        }
      }

      curSeason = leagueData.previous_league_id;

    } catch {
      break;
    }
  }

  return drafts;
}

/**
 * Fetches and normalizes all draft data across every season.
 * Merges legacy and live drafts, deduplicates by year, and caches.
 *
 * @param {Object} allPlayersData - from getAllPlayers()
 * @returns {Promise<Array>} sorted newest-first array of draft objects
 */
export async function getAllDrafts(allPlayersData = {}) {
  if (draftCache.drafts) return draftCache.drafts;

  const managersSnapshot = get(teamManagersStore) || {};
  await getLeagueTeamManagers(); // ensure store is populated

  const legacyDrafts = buildLegacyDrafts(allPlayersData, managersSnapshot);
  const liveDrafts   = await buildLiveDrafts(allPlayersData, managersSnapshot);

  // Merge, deduplicating by year (legacy takes precedence for its years)
  const legacyYears = new Set(legacyDrafts.map((d) => d.year));
  const merged = [
    ...legacyDrafts,
    ...liveDrafts.filter((d) => !legacyYears.has(d.year))
  ].sort((a, b) => b.year - a.year);

  draftCache.drafts = merged;
  return merged;
}
