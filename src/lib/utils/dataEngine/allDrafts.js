// allDrafts.js
//
// Fetches and normalizes draft data across all seasons.
// Stores leagueSettings (slot counts per position) from draft metadata
// so draftAnalysis.js can simulate the optimal draft correctly.

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
 * Extracts the league's roster slot settings from draft settings.
 * Used by the optimal draft simulation to know roster construction.
 */
function extractLeagueSettings(settings) {
  return {
    QB:   settings?.slots_qb   || 1,
    RB:   settings?.slots_rb   || 2,
    WR:   settings?.slots_wr   || 2,
    TE:   settings?.slots_te   || 1,
    FLEX: settings?.slots_flex || 1,
    K:    settings?.slots_k    || 1,
    DEF:  settings?.slots_def  || 1,
    BN:   settings?.slots_bn   || 6,
    rounds: settings?.rounds   || 16,
    teams:  settings?.teams    || 12
  };
}

function normalizePick(rawPick, slotToRosterId, rosterToManager, year, draftType, allPlayersData) {
  const playerId  = String(rawPick.player_id || rawPick.metadata?.player_id || '');
  const round     = rawPick.round;
  const slot      = rawPick.draft_slot;
  const pickNo    = rawPick.pick_no;
  const rosterId  = String(slotToRosterId?.[String(slot)] || rawPick.roster_id || '');
  const managerId = rosterToManager?.[rosterId] ?? null;

  const playerInfo = allPlayersData[playerId];
  const meta       = rawPick.metadata || {};

  let playerName = playerInfo?.full_name;
  if (!playerName && meta.first_name) {
    playerName = `${meta.first_name} ${meta.last_name || ''}`.trim();
  }
  if (!playerName) playerName = `Player ${playerId}`;

  const position = playerInfo?.position || meta.position || null;
  const team     = playerInfo?.team     || meta.team     || null;

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
    year:      Number(year),
    draftType: draftType || 'snake'
  };
}

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
    const year     = parseInt(summary.season);
    const rawPicks = groupedByYear[year];
    if (!rawPicks || rawPicks.length === 0) continue;
    if (!summary.slot_to_roster_id || !summary.settings?.rounds) continue;

    const rosterToManager = getRosterToManagerMap(managersSnapshot, year);
    const leagueSettings  = extractLeagueSettings(summary.settings);

    const picks = rawPicks
      .map((raw) => normalizePick(
        raw, summary.slot_to_roster_id, rosterToManager,
        year, summary.type, allPlayersData
      ))
      .filter((p) => p.playerId && p.round && p.pickNo)
      .sort((a, b) => a.pickNo - b.pickNo);

    if (picks.length === 0) continue;

    drafts.push({
      year,
      draftId:        String(summary.draft_id),
      draftType:      summary.type,
      rounds:         summary.settings.rounds,
      numTeams:       summary.settings.teams || 12,
      leagueSettings,
      slotToRosterId: summary.slot_to_roster_id,
      rosterToManager,
      picks
    });
  }

  return drafts;
}

async function buildLiveDrafts(allPlayersData, managersSnapshot) {
  const drafts = [];
  let curSeason  = mainLeagueID;
  let iterations = 0;

  while (curSeason && curSeason !== 0 && curSeason !== '0' && iterations < 10) {
    iterations++;

    let leagueData;
    try {
      leagueData = await getLeagueData(curSeason);
    } catch (err) {
      console.error(`getAllDrafts: failed to load league data for season ${curSeason}`, err);
      break; // without leagueData we have no previous_league_id, so we can't continue
    }

    if (!leagueData) {
      console.warn(`getAllDrafts: no league data returned for season ${curSeason}, stopping walk-back`);
      break;
    }

    // Fetching this season's drafts is NOT allowed to kill the whole chain.
    // A single failed/empty request should only skip this season, not stop
    // us from walking back to earlier ones.
    try {
      const draftsRes = await fetchWithTimeout(`https://api.sleeper.app/v1/league/${curSeason}/drafts`);

      if (!draftsRes.ok) {
        console.warn(`getAllDrafts: drafts fetch for season ${curSeason} returned ${draftsRes.status}`);
      } else {
        const seasonDrafts = await draftsRes.json();

        if (Array.isArray(seasonDrafts)) {
          for (const draftInfo of seasonDrafts) {
            if (draftInfo.status !== 'complete') continue;

            const draftId = draftInfo.draft_id;
            const year    = parseInt(draftInfo.season);

            try {
              const picksRes = await fetchWithTimeout(
                `https://api.sleeper.app/v1/draft/${draftId}/picks`,
                { compress: true }
              );

              if (!picksRes.ok) {
                console.warn(`getAllDrafts: picks fetch for draft ${draftId} (season ${year}) returned ${picksRes.status}`);
                continue;
              }
              const rawPicks = await picksRes.json();
              if (!Array.isArray(rawPicks)) continue;

              const rosterToManager = getRosterToManagerMap(managersSnapshot, year);
              const leagueSettings  = extractLeagueSettings(draftInfo.settings);

              const picks = rawPicks
                .map((raw) => normalizePick(
                  raw, draftInfo.slot_to_roster_id, rosterToManager,
                  year, draftInfo.type, allPlayersData
                ))
                .filter((p) => p.playerId && p.round && p.pickNo)
                .sort((a, b) => a.pickNo - b.pickNo);

              if (picks.length === 0) continue;

              drafts.push({
                year,
                draftId:        String(draftId),
                draftType:      draftInfo.type,
                rounds:         draftInfo.settings.rounds,
                numTeams:       draftInfo.settings.teams || 12,
                leagueSettings,
                slotToRosterId: draftInfo.slot_to_roster_id,
                rosterToManager,
                picks
              });

            } catch (err) {
              console.error(`getAllDrafts: error processing draft ${draftId} (season ${year})`, err);
              continue;
            }
          }
        } else {
          console.warn(`getAllDrafts: drafts response for season ${curSeason} was not an array`);
        }
      }
    } catch (err) {
      console.error(`getAllDrafts: error fetching drafts list for season ${curSeason}`, err);
      // fall through — we still advance to the previous season below
    }

    // Always advance, even if this season's drafts fetch failed above.
    curSeason = leagueData.previous_league_id;
  }

  return drafts;
}

export async function getAllDrafts(allPlayersData = {}) {
  if (draftCache.drafts) return draftCache.drafts;

  await getLeagueTeamManagers();
  const managersSnapshot = get(teamManagersStore) || {};

  const legacyDrafts = buildLegacyDrafts(allPlayersData, managersSnapshot);
  const liveDrafts   = await buildLiveDrafts(allPlayersData, managersSnapshot);

  const legacyYears = new Set(legacyDrafts.map((d) => d.year));
  const merged = [
    ...legacyDrafts,
    ...liveDrafts.filter((d) => !legacyYears.has(d.year))
  ].sort((a, b) => b.year - a.year);

  draftCache.drafts = merged;
  return merged;
}
