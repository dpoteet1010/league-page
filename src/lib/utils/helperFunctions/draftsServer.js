import { getLeagueData } from './leagueDataServer';
import { getLeagueRosters } from './leagueRostersServer';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { localDrafts } from './helperFunctions/localDrafts.js';
import { draftSummaries } from './helperFunctions/draft_summary.js';

/**
 * Server-side version of getUpcomingDraft.
 * Removed Svelte store dependencies and Svelte-specific wrappers.
 */
export const getUpcomingDraft = async () => {
    const [rosterRes, leagueData] = await Promise.all([
        getLeagueRosters(),
        getLeagueData()
    ]);

    const draftID = leagueData.draft_id;
    const regularSeasonLength = (leagueData.settings?.playoff_week_start || 15) - 1;
    let year = parseInt(leagueData.season);

    const [officialDraftRes, picksRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/draft/${draftID}`),
        fetch(`https://api.sleeper.app/v1/league/${defaultLeagueID}/traded_picks`),
    ]);

    const officialDraft = await officialDraftRes.json();
    const picks = await picksRes.json();

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

    return {
        year,
        draft,
        draftOrder,
        accuracy,
        draftType: officialDraft.type,
        reversalRound: officialDraft.settings.reversal_round,
    };
}

/**
 * Server-side version of getPreviousDrafts.
 * Fetches historical draft data from Sleeper and local files.
 */
export const getPreviousDrafts = async () => {
    const drafts = [];

    // 1. Process Local/Legacy Drafts
    if (Array.isArray(draftSummaries) && Array.isArray(localDrafts)) {
        const groupedLocalDrafts = localDrafts.reduce((acc, pick) => {
            const y = parseInt(pick.draft_id);
            if (!acc[y]) acc[y] = [];
            acc[y].push(pick);
            return acc;
        }, {});

        for (const officialDraft of draftSummaries) {
            const year = parseInt(officialDraft.season);
            const players = groupedLocalDrafts[year];

            if (!players || players.length === 0) continue;
            if (!officialDraft.slot_to_roster_id || !officialDraft.settings?.rounds) continue;

            try {
                const buildRes = buildConfirmed(
                    officialDraft.slot_to_roster_id,
                    officialDraft.settings.rounds,
                    [],
                    players,
                    officialDraft.type
                );
                if (!Array.isArray(buildRes.draft)) continue;

                drafts.push({
                    year,
                    draft: buildRes.draft,
                    draftOrder: buildRes.draftOrder,
                    draftType: officialDraft.type,
                    reversalRound: officialDraft.settings.reversal_round || 0,
                });
            } catch (err) { console.error(`Error processing local draft ${year}:`, err); }
        }
    }

    // 2. Fetch Live Previous Drafts from Sleeper
    let curSeason = defaultLeagueID;
    let iterationCount = 0;
    const maxIterations = 10;

    while (curSeason && curSeason !== "0" && iterationCount < maxIterations) {
        iterationCount++;
        try {
            const leagueData = await getLeagueData(curSeason);
            const completedDraftsInfo = await fetch(`https://api.sleeper.app/v1/league/${curSeason}/drafts`);

            if (!leagueData || !completedDraftsInfo.ok) break;

            const completedDrafts = await completedDraftsInfo.json();

            for (const completedDraft of completedDrafts) {
                const draftID = completedDraft.draft_id;
                const year = parseInt(completedDraft.season);

                const [offRes, pRes, plRes] = await Promise.all([
                    fetch(`https://api.sleeper.app/v1/draft/${draftID}`),
                    fetch(`https://api.sleeper.app/v1/draft/${draftID}/traded_picks`),
                    fetch(`https://api.sleeper.app/v1/draft/${draftID}/picks`),
                ]);

                if (!offRes.ok || !pRes.ok || !plRes.ok) continue;

                const [off, p, pl] = await Promise.all([offRes.json(), pRes.json(), plRes.json()]);

                if (off.status !== "complete") continue;

                const buildRes = buildConfirmed(off.slot_to_roster_id, off.settings.rounds, p, pl, off.type);

                drafts.push({
                    year,
                    draft: buildRes.draft,
                    draftOrder: buildRes.draftOrder,
                    draftType: off.type,
                    reversalRound: off.settings.reversal_round || 0,
                });
            }
            curSeason = leagueData.previous_league_id;
        } catch (err) { break; }
    }

    return drafts.sort((a, b) => b.year - a.year);
};

// --- HELPER LOGIC (No Svelte dependencies) ---

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
            const rA = rosters[a].settings;
            const rB = rosters[b].settings;
            if (rA.wins != rB.wins) return rA.wins - rB.wins;
            return (rA.fpts + rA.fpts_decimal / 100) - (rB.fpts + rB.fpts_decimal / 100);
        });
        for (const key of sortedRosterKeys) {
            draftOrder.push(key);
        }
    }

    const draft = Array.from({ length: rounds }, () => new Array(rosterKeys.length));

    for (const pick of picks) {
        if (pick.owner_id === pick.roster_id || pick.round > rounds) continue;
        draft[pick.round - 1][draftOrder.indexOf(pick.roster_id.toString())] = pick.owner_id;
    }

    let accuracy = Math.min((progression + 1) / (regularSeasonLength + 1), 1);
    return { draft, draftOrder, accuracy };
}

const buildConfirmed = (draftOrderObj, rounds, picks, players = null, type = null) => {
    const draftOrder = Object.values(draftOrderObj);
    const leagueSize = draftOrder.length;
    let draft = Array.from({ length: rounds }, () => new Array(leagueSize).fill());

    if (players && type != 'auction') {
        draft = completedNonAuction({ players, draft, picks, draftOrder, rounds });
    } else if (players) {
        draft = completedAuction({ players, draft, draftOrder, draftOrderObj });
    } else {
        for (const pick of picks) {
            if (pick.owner_id == pick.roster_id || pick.round > rounds) continue;
            const col = draftOrder.indexOf(pick.roster_id);
            if (col > -1) draft[pick.round - 1][col] = pick.owner_id;
        }
    }
    return { draft, draftOrder };
}

const completedNonAuction = ({ players, draft, picks, draftOrder, rounds }) => {
    for (const playerData of players) {
        const round = playerData.round - 1;
        const slot = playerData.draft_slot - 1;
        if (round < draft.length && slot < draft[round].length) {
            draft[round][slot] = { player: playerData.player_id };
        }
    }

    for (const pick of picks) {
        if (pick.owner_id == pick.roster_id || pick.round > rounds) continue;
        const round = pick.round - 1;
        const col = draftOrder.indexOf(pick.roster_id);
        if (round >= 0 && round < draft.length && col >= 0) {
            if (!draft[round][col]) draft[round][col] = {};
            draft[round][col].newOwner = pick.owner_id;
        }
    }
    return draft;
};

const completedAuction = ({ players, draft, draftOrder, draftOrderObj }) => {
    const rosters = {};
    for (const id of Object.values(draftOrderObj)) rosters[id] = [];
    for (const p of players) {
        rosters[p.roster_id]?.push({ player: p.player_id, amount: p.metadata.amount });
    }
    for (const rosterId in rosters) {
        const col = draftOrder.indexOf(parseInt(rosterId));
        if (col === -1) continue;
        const sorted = rosters[rosterId].sort((a, b) => b.amount - a.amount);
        for (let i = 0; i < sorted.length; i++) {
            if (draft[i]) draft[i][col] = sorted[i];
        }
    }
    return draft;
}
