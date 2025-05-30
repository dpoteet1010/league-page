import { getLeagueData } from './leagueData';
import { leagueID } from '$lib/utils/leagueInfo';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { upcomingDraft, previousDrafts } from '$lib/stores';
import { getLeagueRosters } from './leagueRosters';

import { localDrafts } from './localDrafts.js';       // array of objects like officialDraft
import { draftSummaries } from './draft_summary.js'; // array of player pick data like playersRes

export const getUpcomingDraft = async () => {
    if (get(upcomingDraft).draft) {
        return get(upcomingDraft);
    }
    const [rosterRes, leagueData] = await waitForAll(
        getLeagueRosters(),
        getLeagueData()
    ).catch((err) => { console.error(err); });

    const draftID = leagueData.draft_id;
    const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

    let year = parseInt(leagueData.season);

    const [officialDraftRes, picksRes] = await waitForAll(
        fetch(`https://api.sleeper.app/v1/draft/${draftID}`, { compress: true }),
        fetch(`https://api.sleeper.app/v1/league/${leagueID}/traded_picks`, { compress: true }),
    ).catch((err) => { console.error(err); });

    const [officialDraft, picks] = await waitForAll(
        officialDraftRes.json(),
        picksRes.json(),
    ).catch((err) => { console.error(err); });

    let draft;
    let draftOrder;
    let accuracy;

    const rosters = rosterRes.rosters;

    if (officialDraft.status == "complete") {
        year = year + 1;
        const buildRes = buildFromScratch(rosters, officialDraft.slot_to_roster_id, officialDraft.settings.rounds, picks.filter(pick => parseInt(pick.season) == year), regularSeasonLength);
        draft = buildRes.draft;
        draftOrder = buildRes.draftOrder;
        accuracy = buildRes.accuracy;
    } else {
        const buildRes = buildConfirmed(officialDraft.slot_to_roster_id, officialDraft.settings.rounds, picks.filter(pick => parseInt(pick.season) == year));
        draft = buildRes.draft;
        draftOrder = buildRes.draftOrder;
    }

    const draftData = {
        year,
        draft,
        draftOrder,
        accuracy,
        draftType: officialDraft.type,
        reversalRound: officialDraft.settings.reversal_round,
    }

    upcomingDraft.update(() => draftData);

    return draftData;
}

// Predict draft board
const buildFromScratch = (rosters, previousOrder, rounds, picks, regularSeasonLength) => {
    const draftOrder = [];
    const rosterKeys = Object.keys(rosters);
    const testRoster = rosters[rosterKeys[0]].settings;
    const progression = testRoster.wins + testRoster.ties + testRoster.losses;

    // Build starting order. If the season has started and some games have been played,
    // use win record to predict draft order, otherwise (in preseason) use previous draft order
    if (progression == 0) {
        for (const key in previousOrder) {
            draftOrder.push(previousOrder[key]);
        }
    } else {
        const sortedRosterKeys = rosterKeys.sort((a, b) => {
            const rosterA = rosters[a].settings;
            const rosterB = rosters[b].settings;
            if (rosterA.wins != rosterB.wins) {
                return rosterA.wins - rosterB.wins;
            }
            if (rosterA.ties != rosterB.ties) {
                return rosterA.ties - rosterB.ties;
            }
            return (rosterA.fpts + rosterA.fpts_decimal / 100) - (rosterB.fpts + rosterB.fpts_decimal / 100);
        })
        for (const key of sortedRosterKeys) {
            draftOrder.push(key);
        }
    }

    const row = new Array(rosterKeys.length);
    let draft = [];

    for (let i = 0; i < rounds; i++) {
        draft.push([...row]);
    }

    for (const pick of picks) {
        if (pick.owner_id === pick.roster_id || pick.round > rounds) continue;
        draft[pick.round - 1][draftOrder.indexOf(pick.roster_id.toString())] = pick.owner_id;
    }

    let accuracy = (progression + 1) / (regularSeasonLength + 1);
    // make sure accuracy doesn't exceed 1
    accuracy = accuracy > 1 ? 1 : accuracy;

    return { draft, draftOrder, accuracy };
}

// Build pre-determined draft board
const buildConfirmed = (draftOrderObj, rounds, picks, players = null, type = null) => {
    const draftOrder = [];
    let leagueSize = 0;

    for (const key in draftOrderObj) {
        leagueSize++;
        draftOrder.push(draftOrderObj[key]);
    }

    const row = new Array(leagueSize).fill();
    let draft = [];

    for (let i = 0; i < rounds; i++) {
        draft.push([...row]);
    }

    if (players && type != 'auction') {
        // non-auction leagues
        draft = completedNonAuction({ players, draft, picks, draftOrder, rounds });
    } else if (players) {
        // auction leagues
        draft = completedAuction({ players, draft, draftOrder, draftOrderObj });
    } else {
        for (const pick of picks) {
            if (pick.owner_id == pick.roster_id || pick.round > rounds) continue;
            try {
                draft[pick.round - 1][draftOrder.indexOf(pick.roster_id)] = pick.owner_id;
            } catch (error) {
                console.error(`Possibly invaid roster ID?: ${pick.roster_id}`, error);
            }
        }
    }

    return { draft, draftOrder };
}

const completedNonAuction = ({ players, draft, picks, draftOrder, rounds }) => {
    for (const playerData of players) {
        const player = playerData.player_id;
        const round = playerData.round - 1;
        const slot = playerData.draft_slot - 1;
        if (draft[round][slot] === undefined) {
            draft[round][slot] = { player };
        } else {
            draft[round][slot].player = player;
        }
    }

    for (const pick of picks) {
        if (pick.owner_id == pick.roster_id || pick.round > rounds) continue;

        const round = pick.round - 1;
        const col = draftOrder.indexOf(pick.roster_id);

        if (round >= 0 && round < draft.length && col >= 0 && col < draft[round].length) {
            if (!draft[round][col]) {
                draft[round][col] = {};
            }
            draft[round][col].newOwner = pick.owner_id;
        } else {
            console.warn(`Invalid pick position: round ${round + 1}, roster ${pick.roster_id}`);
        }
    }

    return draft;
};

const completedAuction = ({ players, draft, draftOrder, draftOrderObj }) => {
    const rosters = {};
    for (const key in draftOrderObj) {
        // array to be used for players
        rosters[draftOrderObj[key]] = [];
    }
    for (const playerData of players) {
        const data = { player: playerData.player_id, amount: playerData.metadata.amount };
        rosters[playerData.roster_id].push(data);
    }
    for (const roster in rosters) {
        const col = draftOrder.indexOf(parseInt(roster));
        const sortedRoster = rosters[roster].sort((a, b) => b.amount - a.amount);
        for (let i = 0; i < sortedRoster.length; i++) {
            draft[i][col] = sortedRoster[i];
        }
    }
    return draft;
}

// Helper: fetch with timeout
const fetchWithTimeout = async (url, options = {}, timeout = 10000) => { // 10 sec timeout
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), timeout)
    )
  ]);
};

export const getPreviousDrafts = async () => {
  if (get(previousDrafts).length > 0) {
    console.log('Using cached previousDrafts from store');
    return get(previousDrafts);
  }

  const drafts = [];

  // Add static local drafts (match by draft id)
  if (Array.isArray(draftSummaries) && Array.isArray(localDrafts)) {
    console.log('Adding local drafts...');
    const groupedLocalDrafts = localDrafts.reduce((acc, pick) => {
      const year = parseInt(pick.draft_id);
      if (!acc[year]) acc[year] = [];
      acc[year].push(pick);
      return acc;
    }, {});

    for (const officialDraft of draftSummaries) {
      const year = parseInt(officialDraft.season);
      const players = groupedLocalDrafts[year];

      if (!players || players.length === 0) {
        console.warn(`No matching local draft picks for year ${year}`);
        continue;
      }
      if (!officialDraft.slot_to_roster_id || !officialDraft.settings?.rounds) {
        console.warn(`Missing data for draft summary in year ${year}`);
        continue;
      }

      try {
        const buildRes = buildConfirmed(
          officialDraft.slot_to_roster_id,
          officialDraft.settings.rounds,
          [], // No traded picks
          players,
          officialDraft.type
        );
        if (!Array.isArray(buildRes.draft)) {
          console.warn(`Invalid local draft format for year ${year}`);
          continue;
        }

        drafts.push({
          year,
          draft: buildRes.draft,
          draftOrder: buildRes.draftOrder,
          draftType: officialDraft.type,
          reversalRound: officialDraft.settings.reversal_round || 0,
        });
        console.log(`✅ Added local draft for year ${year}`);
      } catch (err) {
        console.error(`❌ Error building local draft for year ${year}`, err);
      }
    }
  }

  // Fetch historical drafts from Sleeper API
  let curSeason = leagueID;
  let iterationCount = 0;
  const maxIterations = 10;

  console.log('Starting to fetch previous drafts from API...');

  while (curSeason && curSeason !== 0 && iterationCount < maxIterations) {
    iterationCount++;
    console.log(`Iteration ${iterationCount}: Fetching drafts for season ${curSeason}...`);

    try {
      const [leagueData, completedDraftsInfo] = await Promise.all([
        getLeagueData(curSeason),
        fetchWithTimeout(`https://api.sleeper.app/v1/league/${curSeason}/drafts`)
      ]);

      if (!leagueData) {
        console.error('getLeagueData returned invalid data');
        break;
      }
      if (!completedDraftsInfo.ok) {
        console.error(`Fetch drafts failed with status: ${completedDraftsInfo.status}`);
        break;
      }

      const completedDrafts = await completedDraftsInfo.json();

      if (!Array.isArray(completedDrafts) || completedDrafts.length === 0) {
        console.log(`No drafts found for season ${curSeason}`);
        curSeason = leagueData.previous_league_id;
        console.log('Moving to previous league:', curSeason);
        continue;
      }

      for (const completedDraft of completedDrafts) {
        const draftID = completedDraft.draft_id;
        const year = parseInt(completedDraft.season);

        console.log(`Fetching details for draft ${draftID} (year ${year})...`);

        try {
          const [officialDraftRes, picksRes, playersRes] = await Promise.all([
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftID}`, { compress: true }),
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftID}/traded_picks`, { compress: true }),
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftID}/picks`, { compress: true }),
          ]);

          if (!officialDraftRes.ok || !picksRes.ok || !playersRes.ok) {
            console.warn(`One or more draft detail fetches failed for draft ${draftID}`);
            continue;
          }

          const [officialDraft, picks, players] = await Promise.all([
            officialDraftRes.json(),
            picksRes.json(),
            playersRes.json(),
          ]);

          if (officialDraft.status !== "complete") {
            console.log(`Draft ${draftID} is incomplete. Skipping.`);
            continue;
          }

          const buildRes = buildConfirmed(
            officialDraft.slot_to_roster_id,
            officialDraft.settings.rounds,
            picks,
            players,
            officialDraft.type
          );

          drafts.push({
            year,
            draft: buildRes.draft,
            draftOrder: buildRes.draftOrder,
            draftType: officialDraft.type,
            reversalRound: officialDraft.settings.reversal_round || 0,
          });

          console.log(`✅ Added API draft for year ${year}`);

        } catch (detailError) {
          console.error(`Error fetching or processing draft details for draft ${draftID}`, detailError);
          continue; // Skip to next draft
        }
      }

      curSeason = leagueData.previous_league_id;
      console.log('Updated curSeason to:', curSeason);

    } catch (error) {
      console.error('❌ Error during API draft fetching:', error);
      break; // Break loop on critical error to avoid infinite stuck state
    }
  }
  drafts.sort((a, b) => b.year - a.year);
  previousDrafts.set(drafts);

  console.log('✅ Final previousDrafts being returned:');
  console.dir(drafts, { depth: null });
  console.log('✅ Finished retrieving previous drafts.');

  return drafts;
};
