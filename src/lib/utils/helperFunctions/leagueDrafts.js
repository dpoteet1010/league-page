import { getLeagueData } from './leagueData';
import { leagueID } from '$lib/utils/leagueInfo';
import { waitForAll } from './multiPromise';
import { get } from 'svelte/store';
import { upcomingDraft, previousDrafts } from '$lib/stores';
import { getLeagueRosters } from './leagueRosters';

import { localDrafts } from './localDrafts.js';
import { draftSummaries } from './draft_summary.js';

export const getUpcomingDraft = async () => {
    if (get(upcomingDraft).draft) {
        return get(upcomingDraft);
    }
    const [rosterRes, leagueData] = await waitForAll(
        getLeagueRosters(),
        getLeagueData()
    ).catch(() => {});

    const draftID = leagueData.draft_id;
    const regularSeasonLength = leagueData.settings.playoff_week_start - 1;

    let year = parseInt(leagueData.season);

    const [officialDraftRes, picksRes] = await waitForAll(
        fetch(`https://api.sleeper.app/v1/draft/${draftID}`, { compress: true }),
        fetch(`https://api.sleeper.app/v1/league/${leagueID}/traded_picks`, { compress: true }),
    ).catch(() => {});

    const [officialDraft, picks] = await waitForAll(
        officialDraftRes.json(),
        picksRes.json(),
    ).catch(() => {});

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

const buildFromScratch = (rosters, previousOrder, rounds, picks, regularSeasonLength) => {
    const draftOrder = [];
    const rosterKeys = Object.keys(rosters);
    const testRoster = rosters[rosterKeys[0]].settings;
    const progression = testRoster.wins + testRoster.ties + testRoster.losses;

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
    accuracy = accuracy > 1 ? 1 : accuracy;

    return { draft, draftOrder, accuracy };
}

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
        draft = completedNonAuction({ players, draft, picks, draftOrder, rounds });
    } else if (players) {
        draft = completedAuction({ players, draft, draftOrder, draftOrderObj });
    } else {
        for (const pick of picks) {
            if (pick.owner_id == pick.roster_id || pick.round > rounds) continue;
            try {
                draft[pick.round - 1][draftOrder.indexOf(pick.roster_id)] = pick.owner_id;
            } catch {}
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
        }
    }

    return draft;
};

const completedAuction = ({ players, draft, draftOrder, draftOrderObj }) => {
    const rosters = {};
    for (const key in draftOrderObj) {
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

const fetchWithTimeout = async (url, options = {}, timeout = 10000) => {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), timeout)
    )
  ]);
};

export const getPreviousDrafts = async () => {
  if (get(previousDrafts).length > 0) {
    return get(previousDrafts);
  }

  const drafts = [];

  if (Array.isArray(draftSummaries) && Array.isArray(localDrafts)) {
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
        continue;
      }
      if (!officialDraft.slot_to_roster_id || !officialDraft.settings?.rounds) {
        continue;
      }

      try {
        const buildRes = buildConfirmed(
          officialDraft.slot_to_roster_id,
          officialDraft.settings.rounds,
          [],
          players,
          officialDraft.type
        );
        if (!Array.isArray(buildRes.draft)) {
          continue;
        }

        drafts.push({
          year,
          draft: buildRes.draft,
          draftOrder: buildRes.draftOrder,
          draftType: officialDraft.type,
          reversalRound: officialDraft.settings.reversal_round || 0,
        });
      } catch {}
    }
  }

  let curSeason = leagueID;
  let iterationCount = 0;
  const maxIterations = 10;

  while (curSeason && curSeason !== 0 && iterationCount < maxIterations) {
    iterationCount++;

    try {
      const [leagueData, completedDraftsInfo] = await Promise.all([
        getLeagueData(curSeason),
        fetchWithTimeout(`https://api.sleeper.app/v1/league/${curSeason}/drafts`)
      ]);

      if (!leagueData || !completedDraftsInfo.ok) {
        break;
      }

      const completedDrafts = await completedDraftsInfo.json();

      if (!Array.isArray(completedDrafts) || completedDrafts.length === 0) {
        curSeason = leagueData.previous_league_id;
        continue;
      }

      for (const completedDraft of completedDrafts) {
        const draftID = completedDraft.draft_id;
        const year = parseInt(completedDraft.season);

        try {
          const [officialDraftRes, picksRes, playersRes] = await Promise.all([
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftID}`, { compress: true }),
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftID}/traded_picks`, { compress: true }),
            fetchWithTimeout(`https://api.sleeper.app/v1/draft/${draftID}/picks`, { compress: true }),
          ]);

          if (!officialDraftRes.ok || !picksRes.ok || !playersRes.ok) {
            continue;
          }

          const [officialDraft, picks, players] = await Promise.all([
            officialDraftRes.json(),
            picksRes.json(),
            playersRes.json(),
          ]);

          if (officialDraft.status !== "complete") {
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

        } catch {
          continue;
        }
      }

      curSeason = leagueData.previous_league_id;

    } catch {
      break;
    }
  }

  drafts.sort((a, b) => b.year - a.year);
  previousDrafts.set(drafts);

  return drafts;
};
