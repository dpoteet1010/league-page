import { getLeagueData } from './leagueDataServer.js';
import { getLeagueRosters } from './leagueRostersServer.js';
import { leagueID as defaultLeagueID } from '$lib/utils/leagueInfo';
import { localDrafts } from './helperFunctions/localDrafts.js';
import { draftSummaries } from './helperFunctions/draft_summary.js';

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
    const rosters = rosterRes.rosters;

    let draft, draftOrder, accuracy;

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

    return { year, draft, draftOrder, accuracy, draftType: officialDraft.type, reversalRound: officialDraft.settings.reversal_round };
};

export const getPreviousDrafts = async () => {
    const drafts = [];
    // ... (Keep your existing getPreviousDrafts logic here) ...
    return drafts.sort((a, b) => b.year - a.year);
};

// --- THE MISSING EXPORT THAT WAS CRASHING THE BUILD ---
export const getDrafts = async () => {
    const [upcoming, previous] = await Promise.all([
        getUpcomingDraft(),
        getPreviousDrafts()
    ]);
    return { upcoming, previous };
};

// --- KEEP YOUR HELPER FUNCTIONS (buildFromScratch, etc.) BELOW ---
const buildFromScratch = (rosters, previousOrder, rounds, picks, regularSeasonLength) => { /* ... */ };
const buildConfirmed = (draftOrderObj, rounds, picks, players = null, type = null) => { /* ... */ };
const completedNonAuction = ({ players, draft, picks, draftOrder, rounds }) => { /* ... */ };
const completedAuction = ({ players, draft, draftOrder, draftOrderObj }) => { /* ... */ };
