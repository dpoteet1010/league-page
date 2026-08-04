// dataExport.js

import { getRealName, MANAGERS } from '$lib/utils/leagueManagers.js';

// ── League lore / house rules ──────────────────────────────────────────────

// NOTE: inferred from league context (roster settings referenced 2023 as the
// earliest documented season). Update this map with real years/punishments
// as needed — any year not listed here falls back to a visible placeholder
// instead of silently guessing.
const REGULAR_SEASON_LOSER_PUNISHMENTS = {
  '2023': 'Busked in public playing the recorder until earning $20 in tips',
  '2024': 'Performed stand-up comedy using material written by the rest of the league',
  '2025': 'Did a calendar photo shoot — the league picked the month, outfit, and pose for every shot',
  '2026': "Must eat the Glizzy Gauntlet — the same number of hot dogs as that year's Nathan's Hot Dog Eating Contest winner ate, over the course of one week"
};

// Bowl games by final placement. Applies to ALL seasons.
const BOWL_DEFINITIONS = {
  1:  { name: 'National Liver Failure League Championship', emoji: '🏆', reward: 'Winner gets $1000, the trophy, and eternal glory.' },
  3:  { name: 'Double Barrel Bowl', emoji: '🔫', reward: 'Winner gets 2 additional landmines at the next draft.' },
  5:  { name: 'Boomerang Bowl', emoji: '🪃', reward: "Winner gets to redirect anyone's landmine back to the sender at the next draft." },
  7:  { name: "Dictator's Deputy Bowl", emoji: '🎩', reward: 'Winner gets to decide how the next draft order is determined.' },
  9:  { name: 'Wire Cutter Bowl', emoji: '✂️', reward: 'Winner gets to skip the first landmine they hit at the next draft.' },
  11: { name: "Bartender's Choice Bowl", emoji: '🍸', reward: 'Winner gets to pick the shot the league takes at the next draft.' }
};

const RUNNER_UP_REWARD = 'Winner gets $200.';

// ── Rivalry Week data by year ────────────────────────────────────────────────
// Rivals and their bets change every year — enter each season's matchups here
// once the rivals/bets are set at the draft. "week" is the actual NFL/league
// week the rivalry matchup happens; the winner is derived automatically from
// that week's real game result, never hardcoded.
const RIVALRY_WEEKS = {
  '2023': {
    week: 12,
    defaultBet: "Loser has to cover the winner's bar tab at the end of season banquet.",
    pairs: [
      { a: 'David', b: 'Corzine' },
      { a: 'Berra', b: 'D Kim' },
      { a: 'Lukas', b: 'Harrison' },
      { a: 'Alec', b: 'Haskin' },
      { a: 'Tyler', b: 'James' },
      { a: 'Newman', b: 'Jared' }
    ]
  },
  '2024': {
    week: 13,
    pairs: [
      { a: 'David', b: 'Haskin', bet: 'Loser buys a round of golf + course drinks for the winner.' },
      { a: 'Alec', b: 'James', bet: 'Loser buys a round of golf for the winner.' },
      { a: 'Tyler', b: 'Jared', bet: "Winner chooses banquet outfit for the loser and loser covers winner's banquet bar tab." },
      { a: 'Newman', b: 'Harrison', bet: "Loser covers winner's banquet bar tab." },
      { a: 'Corzine', b: 'DKim', bet: "Winner chooses the loser's team name for next season." },
      { a: 'Lukas', b: 'Berra', bet: 'Winner chooses the banquet outfit for the loser.' }
    ]
  },
  '2025': {
    week: 13,
    pairs: [
      { a: 'Dictator', b: 'Berra', bet: 'Loser buys the winner an NFL jersey of choice and provides a pre-draft anthem next season.' },
      { a: 'Alec', b: 'Mendez', bet: "Loser has to buy and wear the winner's team's jersey (Packers or Chiefs) to the banquet and draft." },
      { a: 'Jared', b: 'Siampos', bet: 'Loser has to take a shot, shotgun, or chug every week of the 2026 NFL Fantasy Regular Season (14 weeks).' },
      { a: 'Lukas', b: 'Stolze', bet: 'Loser has to agree with everything Jared says until the next draft without him realizing.' },
      { a: 'Harrison', b: 'James', bet: 'Loser buys the winner an NFL jersey of choice.' },
      { a: 'Haskin', b: 'Newman', bet: "Loser has to wear the clothes from their college's rival to the banquet." }
    ]
  }
};

// ── Name resolution for rivalry data (uses real MANAGERS IDs, not guessing) ──

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MANAGER_NAME_TO_ID = {};
Object.entries(MANAGERS).forEach(([id, data]) => {
  if (data?.name) MANAGER_NAME_TO_ID[normalizeName(data.name)] = id;
});

// Manual aliases for cases where rivalry data used an older nickname/real name
// than the current MANAGERS entry. "David" -> The Dictator is INFERRED from
// the year-over-year rivalry pattern (same recurring central figure), not
// explicitly confirmed — verify and adjust if wrong.
const MANAGER_NAME_ALIASES = {
  david: '1211171582181912576' // The Dictator
};

function findManagerIdByName(name) {
  const norm = normalizeName(name);
  if (MANAGER_NAME_ALIASES[norm]) return MANAGER_NAME_ALIASES[norm];
  if (MANAGER_NAME_TO_ID[norm]) return MANAGER_NAME_TO_ID[norm];
  // Fallback: partial match, handles e.g. "Dictator" vs "The Dictator".
  for (const [key, id] of Object.entries(MANAGER_NAME_TO_ID)) {
    if (key.includes(norm) || norm.includes(key)) return id;
  }
  return null;
}

// ── Name substitution for freeform bet/reward text ──────────────────────────

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Swaps the generic role-words "winner"/"loser" (and their possessive "'s"
 * forms) in a freeform bet string for the actual manager names, so Rivalry
 * Week results read as a specific sentence rather than "X won. Stakes: ...
 * -> Y owes it." Also cleans up "the Name's" -> "Name's" since "the" reads
 * fine before a role word but not before a proper name.
 */
function substituteBetNames(bet, winnerName, loserName) {
  if (!bet || !winnerName || !loserName) return bet;
  let text = bet;
  text = text.replace(/\bloser\b('s)?/gi, (m, poss) => (poss ? `${loserName}'s` : loserName));
  text = text.replace(/\bwinner\b('s)?/gi, (m, poss) => (poss ? `${winnerName}'s` : winnerName));
  text = text.replace(new RegExp(`\\bthe ${escapeRegExp(winnerName)}'s`, 'gi'), `${winnerName}'s`);
  text = text.replace(new RegExp(`\\bthe ${escapeRegExp(loserName)}'s`, 'gi'), `${loserName}'s`);
  return text;
}

/**
 * Same idea, for the Final Outcomes bowl/championship/runner-up reward
 * strings, which all use "Winner gets/chooses/etc." — swapped for the actual
 * winner's name so "Winner gets $1000..." reads as "Newman gets $1000...".
 */
function substituteWinnerName(text, winnerName) {
  if (!text || !winnerName) return text;
  let out = text.replace(/\bwinner\b('s)?/gi, (m, poss) => (poss ? `${winnerName}'s` : winnerName));
  out = out.replace(new RegExp(`\\bthe ${escapeRegExp(winnerName)}'s`, 'gi'), `${winnerName}'s`);
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fp(val, d = 1) {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return typeof n === 'number' && !isNaN(n) ? n.toFixed(d) : 'N/A';
}
function signedFp(val, d = 1) {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (typeof n !== 'number' || isNaN(n)) return 'N/A';
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}
function pct(val, d = 1) {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return typeof n === 'number' && !isNaN(n) ? (n * 100).toFixed(d) + '%' : 'N/A';
}
function mgrName(managerId, snap) {
  return getRealName(managerId, snap);
}

function toLetter(score) {
  const n = typeof score === 'string' ? parseFloat(score) : score;
  if (typeof n !== 'number' || isNaN(n)) return '—';
  if (n >= 75) return 'A+';
  if (n >= 70) return 'A';
  if (n >= 65) return 'A-';
  if (n >= 62) return 'B+';
  if (n >= 58) return 'B';
  if (n >= 55) return 'B-';
  if (n >= 52) return 'C+';
  if (n >= 48) return 'C';
  if (n >= 45) return 'C-';
  if (n >= 42) return 'D+';
  if (n >= 38) return 'D';
  if (n >= 35) return 'D-';
  return 'F';
}

/** Builds a plain list of manager names. */
function buildSimpleManagerList(managersSnapshot) {
  const users = managersSnapshot?.users || {};
  const ids = Object.keys(users);
  if (!ids.length) return '## Managers\n\n*No manager data available.*';
  const lines = ['## Managers', ''];
  ids.forEach((id) => {
    lines.push(`- ${getRealName(id, managersSnapshot)}`);
  });
  return lines.join('\n');
}

/**
 * Computes standings from individual game results through a specific week.
 * Regular season only. Always accurate regardless of whether the season is complete.
 */
function buildStandingsThroughWeek(allWeeklyResults, year, throughWeek) {
  const results = (allWeeklyResults || []).filter(
    r => String(r.year) === String(year) && !r.isPlayoffs && r.week <= throughWeek
  );
  const records = {};
  results.forEach(r => {
    if (!records[r.managerId]) {
      records[r.managerId] = { managerId: r.managerId, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
    }
    const rec = records[r.managerId];
    if      (r.result === 'W') rec.wins++;
    else if (r.result === 'L') rec.losses++;
    else                       rec.ties++;
    rec.pf += r.pointsFor    || 0;
    rec.pa += r.pointsAgainst || 0;
  });
  return Object.values(records).sort((a, b) => {
    const wa = a.wins + a.ties * 0.5;
    const wb = b.wins + b.ties * 0.5;
    if (Math.abs(wb - wa) > 0.001) return wb - wa;
    return b.pf - a.pf;
  });
}

/**
 * Computes each manager's current win/loss streak through a given week.
 * Returns e.g. "W3" or "L2". A tie breaks the streak.
 */
function computeStreaks(allWeeklyResults, year, throughWeek) {
  const streaks = {};
  const byManager = {};
  (allWeeklyResults || [])
    .filter(r => String(r.year) === String(year) && !r.isPlayoffs && r.week <= throughWeek)
    .forEach(r => {
      if (!byManager[r.managerId]) byManager[r.managerId] = [];
      byManager[r.managerId].push(r);
    });
  Object.entries(byManager).forEach(([managerId, games]) => {
    games.sort((a, b) => a.week - b.week);
    let streakType = null, count = 0;
    for (let i = games.length - 1; i >= 0; i--) {
      const result = games[i].result;
      if (result === 'T') break; // ties break streaks
      if (streakType === null) { streakType = result; count = 1; }
      else if (result === streakType) count++;
      else break;
    }
    streaks[managerId] = streakType ? `${streakType}${count}` : '—';
  });
  return streaks;
}

/**
 * Cumulative "chug" tally: house rule is any STARTER who scores 0 or negative
 * points in a week costs that manager a shotgun/chug. Counts every qualifying
 * starter-week for each manager, summed through a given week.
 */
function computeChugTally(playerResults, year, throughWeek, rosterToManagerId) {
  const tally = {};
  (playerResults || [])
    .filter(r =>
      String(r.year) === String(year) &&
      Number(r.week) <= Number(throughWeek) &&
      r.isStarter === true
    )
    .forEach(r => {
      const pts = typeof r.pointsTotal === 'string' ? parseFloat(r.pointsTotal) : r.pointsTotal;
      if (typeof pts !== 'number' || isNaN(pts) || pts > 0) return;
      const managerId = rosterToManagerId?.[String(r.rosterId)];
      if (!managerId) return;
      tally[managerId] = (tally[managerId] || 0) + 1;
    });
  return tally;
}

/**
 * Extracts matchup pairs for a specific week.
 */
function extractMatchupsForWeek(allWeeklyResults, year, week) {
  const results = (allWeeklyResults || []).filter(
    r => String(r.year) === String(year) && !r.isPlayoffs && r.week === week
  );
  const seen = new Set();
  const matchups = [];
  results.forEach(r => {
    const key = [r.managerId, r.opponentManagerId].sort().join('-');
    if (!seen.has(key)) {
      seen.add(key);
      matchups.push({ homeId: r.managerId, awayId: r.opponentManagerId });
    }
  });
  return matchups;
}

/**
 * Computes all-time head-to-head record between two managers across all seasons.
 * Regular season only (no playoffs). Used ONLY for the Next Week Preview.
 */
function computeHeadToHead(allTimeWeeklyResults, managerAId, managerBId) {
  if (!allTimeWeeklyResults || !managerAId || !managerBId) {
    return { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 };
  }
  const games = allTimeWeeklyResults.filter(
    r => r.managerId === managerAId &&
         r.opponentManagerId === managerBId &&
         !r.isPlayoffs
  );
  const wins   = games.filter(r => r.result === 'W').length;
  const losses = games.filter(r => r.result === 'L').length;
  const ties   = games.filter(r => r.result === 'T').length;
  return { wins, losses, ties, gamesPlayed: wins + losses + ties };
}

/**
 * Short H2H format for the Next Week Preview: "Newman leads 1-0" /
 * "Series tied 1-1" / "First ever matchup".
 */
function formatH2HShort(h2h, managerAName, managerBName) {
  if (!h2h || h2h.gamesPlayed === 0) return 'First ever matchup';
  if (h2h.wins > h2h.losses) {
    const recStr = `${h2h.wins}-${h2h.losses}${h2h.ties > 0 ? `-${h2h.ties}` : ''}`;
    return `${managerAName} leads ${recStr}`;
  }
  if (h2h.losses > h2h.wins) {
    const recStr = `${h2h.losses}-${h2h.wins}${h2h.ties > 0 ? `-${h2h.ties}` : ''}`;
    return `${managerBName} leads ${recStr}`;
  }
  const recStr = `${h2h.wins}-${h2h.losses}${h2h.ties > 0 ? `-${h2h.ties}` : ''}`;
  return `Series tied ${recStr}`;
}

/**
 * Turns one manager's result row for a completed week into a short factual
 * tag ("blowout win", "narrow loss", etc.) plus the raw score, for the
 * "Coming In" line of the Next Week Preview.
 */
function describeResult(row) {
  if (!row) return null;
  const pf = row.pointsFor || 0;
  const pa = row.pointsAgainst || 0;
  const margin = Math.abs(pf - pa);
  let tag;
  if (row.result === 'T') tag = 'tie';
  else if (margin >= 25)   tag = row.result === 'W' ? 'blowout win'  : 'blowout loss';
  else if (margin <= 5)    tag = row.result === 'W' ? 'narrow win'   : 'narrow loss';
  else                      tag = row.result === 'W' ? 'win'          : 'loss';
  return { tag, pointsFor: pf, pointsAgainst: pa, margin };
}

/**
 * Rough win probability from each manager's season PPG to date, converted to
 * American (moneyline) odds. This is a fun/trash-talk tool, not a rigorous
 * projection model — the scale constant (20) just keeps odds in a believable
 * range for typical weekly fantasy scoring margins.
 */
function computeMatchupOdds(homePPG, awayPPG) {
  if (homePPG == null || awayPPG == null) return null;
  const diff = homePPG - awayPPG;
  const homeProb = 1 / (1 + Math.pow(10, -diff / 20));
  const awayProb = 1 - homeProb;
  return { homeOdds: americanOddsFromProb(homeProb), awayOdds: americanOddsFromProb(awayProb) };
}
function americanOddsFromProb(prob) {
  if (prob == null || prob <= 0 || prob >= 1) return null;
  const odds = prob >= 0.5
    ? -100 * (prob / (1 - prob))
    : 100 * ((1 - prob) / prob);
  return Math.round(odds);
}
function formatAmericanOdds(odds) {
  if (odds == null) return null;
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/**
 * League-wide standout performances for a given week, for the "Notable
 * Performances" callout in game recaps. Uses the explicit isStarter flag so
 * a real zero or negative week from a starter shows up correctly, and
 * resolves each performance to the manager who started that player.
 */
function getWeekTopAndBottomPerformers(playerResults, year, week, allPlayersData, rosterToManagerId, topLimit = 3) {
  if (!playerResults?.length) return { top: [], bottom: [] };

  const weekStarters = playerResults.filter(r =>
    String(r.year) === String(year) &&
    Number(r.week) === Number(week) &&
    r.isStarter === true
  );

  const withInfo = weekStarters
    .map(r => {
      const info = allPlayersData?.[String(r.playerId)];
      const name = info
        ? (info.full_name || `${info.first_name || ''} ${info.last_name || ''}`.trim())
        : `Player ${r.playerId}`;
      const pos = info?.position || '';
      const pts = typeof r.pointsTotal === 'string' ? parseFloat(r.pointsTotal) : r.pointsTotal;
      const managerId = rosterToManagerId?.[String(r.rosterId)] || null;
      return { name, pos, points: pts, managerId };
    })
    .filter(p => typeof p.points === 'number' && !isNaN(p.points));

  const sorted = [...withInfo].sort((a, b) => b.points - a.points);
  const top    = sorted.slice(0, topLimit);
  const bottom = sorted
    .filter(p => p.points <= 0)
    .sort((a, b) => a.points - b.points);

  return { top, bottom };
}

/**
 * Pulls a waiver pickup's PAR for one specific week out of the week-by-week
 * breakdown parGrading.js computes (tx.grade.weekBreakdown). Returns null if
 * the player has no boxscore for that manager's roster in that exact week.
 */
function getWeekSpecificWaiverPAR(tx, week) {
  const wb = tx.grade?.weekBreakdown;
  if (!Array.isArray(wb)) return null;
  const entry = wb.find(w => Number(w.week) === Number(week));
  if (!entry) return null;
  return { weekPAR: entry.weekPAR, weekPts: entry.playerPts };
}

/**
 * Sums a player's fantasy points scored so far this season, through a given
 * week — used to give the LLM something concrete to reason from for a
 * trade's "preliminary" reaction, since real PAR grading only happens at
 * end of season once the full hold period is known.
 */
function getSeasonToDatePoints(playerResults, playerId, year, throughWeek) {
  if (!playerResults) return null;
  const total = playerResults
    .filter(r =>
      String(r.year) === String(year) &&
      Number(r.week) <= Number(throughWeek) &&
      String(r.playerId) === String(playerId)
    )
    .reduce((sum, r) => {
      const pts = typeof r.pointsTotal === 'string' ? parseFloat(r.pointsTotal) : r.pointsTotal;
      return sum + (typeof pts === 'number' && !isNaN(pts) ? pts : 0);
    }, 0);
  return total;
}

/**
 * Resolves the players (and draft picks) each side of a completed trade
 * received, from the raw transaction moves — independent of PAR grading, so
 * trade details can be shown for the current week even though formal grading
 * only happens at end of season. Attaches season-to-date points per player.
 */
function extractTradeReceivedPlayers(tx, allPlayersData, playerResults, year, throughWeek) {
  const received = {};
  (tx.rosters || []).forEach(r => { received[r] = []; });

  (tx.moves || []).forEach(move => {
    if (!Array.isArray(move)) return;
    move.forEach((side, idx) => {
      const roster = tx.rosters?.[idx];
      if (!roster || !side || typeof side !== 'object') return;

      if (side.type === 'trade' && side.player) {
        const info = allPlayersData?.[String(side.player)];
        const name = info
          ? (info.full_name || `${info.first_name || ''} ${info.last_name || ''}`.trim())
          : `Player ${side.player}`;
        const pos = info?.position || '';
        const seasonPts = getSeasonToDatePoints(playerResults, side.player, year, throughWeek);
        if (!received[roster]) received[roster] = [];
        received[roster].push({ name, pos, seasonPts, isPick: false });
      } else if (side.type === 'Received Pick' && side.pick) {
        const pick = side.pick;
        const label = `${pick.season || ''} Round ${pick.round || '?'} Pick`.trim();
        if (!received[roster]) received[roster] = [];
        received[roster].push({ name: label, pos: '', seasonPts: null, isPick: true });
      }
    });
  });

  return received;
}

/** Plain "Name (POS)" string for a trade item — no stats, used in headers. */
function tradeItemsPlain(items) {
  if (!items || !items.length) return 'nothing found';
  return items.map(p => p.isPick ? p.name : `${p.name}${p.pos ? ` (${p.pos})` : ''}`).join(', ');
}

/** "Name (POS, X pts this season)" string for a trade item — used in detail bullets. */
function tradeItemsDetailed(items) {
  if (!items || !items.length) return 'nothing found';
  return items.map(p => {
    if (p.isPick) return p.name;
    const ptsStr = p.seasonPts != null ? `, ${fp(p.seasonPts)} pts this season` : '';
    return `${p.name}${p.pos ? ` (${p.pos}${ptsStr})` : ptsStr}`;
  }).join(', ');
}

/**
 * Ranks trades this season by how one-sided they were (PAR gap between the
 * winning and losing side). Handles both standard 2-team trades and
 * multi-team composite trades (using the top-vs-bottom PAR gap for those).
 */
function getMostLopsidedTrades(gradedTransactions, year, managersSnapshot, limit = 5) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const trades = (gradedTransactions || []).filter(tx =>
    tx.type === 'trade' && String(tx.seasonKey || tx.season) === String(year)
  );

  const scored = [];
  trades.forEach(tx => {
    if (tx.isComposite && tx.grade?.ranked?.length >= 2) {
      const ranked = tx.grade.ranked;
      const top = ranked[0];
      const bottom = ranked[ranked.length - 1];
      const disparity = (top?.parTotal || 0) - (bottom?.parTotal || 0);
      scored.push({
        disparity,
        summaryLines: ranked.map(r => `${mn(r.managerId)}: ${signedFp(r.parTotal)} PAR total`)
      });
    } else if (!tx.isPartOfComposite && tx.grade?.side0 && tx.grade?.side1) {
      const g = tx.grade;
      const disparity = Math.abs((g.side0.parTotal || 0) - (g.side1.parTotal || 0));
      const mgr0 = mn(tx.managerIds?.[0]);
      const mgr1 = mn(tx.managerIds?.[1]);
      const items0 = (g.side0.players || []).map(p => `${p.name} (${p.position}, ${signedFp(p.par)} PAR)`).join(', ') || 'nothing';
      const items1 = (g.side1.players || []).map(p => `${p.name} (${p.position}, ${signedFp(p.par)} PAR)`).join(', ') || 'nothing';
      scored.push({
        disparity,
        summaryLines: [
          `${mgr0} received: ${items0} — side total ${signedFp(g.side0.parTotal)} PAR`,
          `${mgr1} received: ${items1} — side total ${signedFp(g.side1.parTotal)} PAR`
        ]
      });
    }
  });

  return scored.sort((a, b) => b.disparity - a.disparity).slice(0, limit);
}

/**
 * Top waiver pickups for the whole season, ranked by full-season PAR from
 * the pickup date onward (this is now appropriate — the season's over, so
 * unlike the weekly export there's no "leaking future info" concern).
 */
function getTopSeasonWaiverPickups(gradedTransactions, year, managersSnapshot, limit = 5) {
  const mn = (id) => mgrName(id, managersSnapshot);
  return (gradedTransactions || [])
    .filter(tx =>
      tx.type === 'waiver' &&
      !tx.isPartOfComposite &&
      String(tx.seasonKey || tx.season) === String(year) &&
      tx.grade?.par != null
    )
    .sort((a, b) => (b.grade.par || 0) - (a.grade.par || 0))
    .slice(0, limit)
    .map(tx => ({
      manager: mn(tx.managerIds?.[0]),
      name: tx.grade.name,
      position: tx.grade.position,
      par: tx.grade.par,
      droppedName: tx.grade.droppedName,
      gradeLabel: tx.grade.gradeLabel
    }));
}

/**
 * Pre-computes the season's superlative award winners so the LLM doesn't
 * have to hunt through raw tables and risk picking wrong. Best Manager was
 * previously left for the LLM to infer from the Manager Grades table and
 * occasionally got it wrong — now it's computed here directly, same as
 * everything else in this section.
 */
function computeSuperlatives({ managerTradePAR, managerWaiverPAR, chugTally, seasonManagerGrades, managersSnapshot }) {
  const mn = (id) => mgrName(id, managersSnapshot);

  const pick = (obj, isBetter) => {
    let bestId = null, bestVal = null;
    Object.entries(obj || {}).forEach(([id, val]) => {
      if (val == null) return;
      if (bestVal === null || isBetter(val, bestVal)) { bestVal = val; bestId = id; }
    });
    return bestId ? { managerId: bestId, displayName: mn(bestId), value: bestVal } : null;
  };

  let bestManager = null;
  Object.entries(seasonManagerGrades || {}).forEach(([id, g]) => {
    if (g?.overallGrade == null) return;
    if (!bestManager || g.overallGrade > bestManager.value) {
      bestManager = { managerId: id, displayName: mn(id), value: g.overallGrade };
    }
  });

  const bestTrader  = pick(managerTradePAR,  (a, b) => a > b);
  const worstTrader = pick(managerTradePAR,  (a, b) => a < b);
  const bestWaiver  = pick(managerWaiverPAR, (a, b) => a > b);
  const worstWaiver = pick(managerWaiverPAR, (a, b) => a < b);
  const chugKing     = pick(chugTally, (a, b) => a > b);

  return { bestManager, bestTrader, worstTrader, bestWaiver, worstWaiver, chugKing };
}

/**
 * Derives the season's headline outcomes: every bowl-game placement winner
 * (1st/3rd/5th/7th/9th/11th), the runner-up, and the regular season's last
 * place team (which is judged purely on regular-season record, independent
 * of how the consolation bracket shakes out — this is "the actual loser of
 * the league" per house rules, and carries its own punishment).
 */
function deriveSeasonOutcomes(standings, weeklyResults, snap, year) {
  if (!standings || standings.length === 0) return null;
  const mn     = (id) => mgrName(id, snap);
  const sorted = [...standings].sort((a, b) => (a.finalPlacement || 99) - (b.finalPlacement || 99));

  const bowlWinners = {};
  Object.keys(BOWL_DEFINITIONS).forEach(placementStr => {
    const placement = Number(placementStr);
    const team = sorted.find(t => t.finalPlacement === placement);
    bowlWinners[placement] = team
      ? { managerId: team.managerId, displayName: mn(team.managerId), ...BOWL_DEFINITIONS[placement] }
      : null;
  });

  const runnerUpTeam = sorted.find(t => t.finalPlacement === 2);
  const runnerUp = runnerUpTeam ? { managerId: runnerUpTeam.managerId, displayName: mn(runnerUpTeam.managerId) } : null;

  const regularOnly = (weeklyResults || []).filter(r => !r.isPlayoffs && r.week <= 14);
  const regRecords  = {};
  regularOnly.forEach(r => {
    if (!regRecords[r.managerId]) regRecords[r.managerId] = { wins:0, losses:0, ties:0, pf:0 };
    const rec = regRecords[r.managerId];
    if      (r.result === 'W') rec.wins++;
    else if (r.result === 'L') rec.losses++;
    else                       rec.ties++;
    rec.pf += r.pointsFor || 0;
  });

  let regularSeasonLoser = null;
  let worstScore = Infinity;
  Object.entries(regRecords).forEach(([mgrId, rec]) => {
    const gp    = rec.wins + rec.losses + rec.ties;
    const score = gp > 0 ? (rec.wins + rec.ties * 0.5) / gp * 1000 + rec.pf / 1000 : 0;
    if (score < worstScore) {
      worstScore = score;
      const ppg = gp > 0 ? rec.pf / gp : null;
      regularSeasonLoser = {
        managerId: mgrId, displayName: mn(mgrId),
        wins: rec.wins, losses: rec.losses, ties: rec.ties, pf: rec.pf, ppg,
        punishment: REGULAR_SEASON_LOSER_PUNISHMENTS[String(year)]
          || `Punishment for ${year} not yet recorded — update REGULAR_SEASON_LOSER_PUNISHMENTS in dataExport.js`
      };
    }
  });

  return { bowlWinners, runnerUp, regularSeasonLoser };
}

/**
 * Resolves this season's Rivalry Week results from RIVALRY_WEEKS: matches
 * each named pair to real manager IDs (via MANAGERS, not guesswork), finds
 * that week's actual game result between them, and reports the winner with
 * the bet text rewritten to use their actual names instead of "winner"/
 * "loser". Any pair that couldn't be matched or resolved gets a visible note
 * instead of silently guessing.
 */
function getRivalryResultsForYear(year, weeklyResults, managersSnapshot) {
  const cfg = RIVALRY_WEEKS[String(year)];
  if (!cfg) return null;

  const results = cfg.pairs.map(pairRaw => {
    const nameA = pairRaw.a;
    const nameB = pairRaw.b;
    const bet = pairRaw.bet || cfg.defaultBet || 'Stakes not recorded.';
    const idA = findManagerIdByName(nameA);
    const idB = findManagerIdByName(nameB);
    const displayA = idA ? mgrName(idA, managersSnapshot) : nameA;
    const displayB = idB ? mgrName(idB, managersSnapshot) : nameB;

    let resolvedBetText = null, resolved = false, note = null;

    if (idA && idB) {
      const game = (weeklyResults || []).find(r =>
        String(r.year) === String(year) && r.week === cfg.week && !r.isPlayoffs &&
        ((r.managerId === idA && r.opponentManagerId === idB) ||
         (r.managerId === idB && r.opponentManagerId === idA))
      );
      if (game) {
        let winnerId = null;
        if (game.managerId === idA) winnerId = game.result === 'W' ? idA : game.result === 'L' ? idB : null;
        else                        winnerId = game.result === 'W' ? idB : game.result === 'L' ? idA : null;
        if (winnerId) {
          resolved = true;
          const winnerName = mgrName(winnerId, managersSnapshot);
          const loserName  = winnerId === idA ? displayB : displayA;
          resolvedBetText  = substituteBetNames(bet, winnerName, loserName);
        } else {
          note = `Week ${cfg.week} ${year} matchup ended in a tie — no clear winner.`;
        }
      } else {
        note = `Could not find a Week ${cfg.week} ${year} matchup between these two managers — verify manually.`;
      }
    } else {
      note = `Could not confidently match "${!idA ? nameA : nameB}" to a manager — verify manually.`;
    }

    return { displayA, displayB, bet, resolvedBetText, resolved, note };
  });

  return { week: cfg.week, results };
}

/**
 * Best/worst win for a manager this regular season. This is a heuristic, not
 * an objective calculation — "best win" and "worst loss" are inherently
 * judgment calls. Score = points scored, with a bonus for beating (or losing
 * to) an opponent whose season record was notably better (or worse) —
 * approximating "upset win" / "should never have lost that" framing.
 */
function getManagerBestWinWorstLoss(weeklyResults, standings, year, managerId, managersSnapshot) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const games = (weeklyResults || []).filter(r =>
    String(r.year) === String(year) && !r.isPlayoffs && r.managerId === managerId
  );
  const standingByMgr = {};
  (standings || []).forEach(s => { standingByMgr[s.managerId] = s; });

  const winPctFor = (mgrId) => {
    const s = standingByMgr[mgrId]?.regularSeason;
    if (!s) return null;
    const gp = (s.wins || 0) + (s.losses || 0) + (s.ties || 0);
    return gp > 0 ? (s.wins + 0.5 * s.ties) / gp : null;
  };

  const own = winPctFor(managerId);
  let bestWin = null, bestScore = -Infinity;
  let worstLoss = null, worstScore = -Infinity;

  games.forEach(r => {
    const opp = winPctFor(r.opponentManagerId);
    if (r.result === 'W') {
      const upsetBonus = (opp != null && own != null) ? Math.max(0, (opp - own) * 100) : 0;
      const score = (r.pointsFor || 0) + upsetBonus;
      if (score > bestScore) {
        bestScore = score;
        bestWin = {
          week: r.week, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst,
          opponent: mn(r.opponentManagerId), isUpset: upsetBonus > 15
        };
      }
    } else if (r.result === 'L') {
      const downsetBonus = (own != null && opp != null) ? Math.max(0, (own - opp) * 100) : 0;
      const score = -(r.pointsFor || 0) + downsetBonus * 2;
      if (score > worstScore) {
        worstScore = score;
        worstLoss = {
          week: r.week, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst,
          opponent: mn(r.opponentManagerId), isUpset: downsetBonus > 15
        };
      }
    }
  });

  return { bestWin, worstLoss };
}

function getManagerBestWaiver(gradedTransactions, year, managerId) {
  const waivers = (gradedTransactions || []).filter(tx =>
    tx.type === 'waiver' && !tx.isPartOfComposite &&
    String(tx.seasonKey || tx.season) === String(year) &&
    tx.managerIds?.[0] === managerId && tx.grade?.par != null
  );
  if (!waivers.length) return null;
  const best = waivers.reduce((a, b) => (b.grade.par > a.grade.par ? b : a));
  return { name: best.grade.name, position: best.grade.position, par: best.grade.par, droppedName: best.grade.droppedName };
}

function getManagerBestTrade(gradedTransactions, year, managerId, managersSnapshot) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const trades = (gradedTransactions || []).filter(tx =>
    tx.type === 'trade' && String(tx.seasonKey || tx.season) === String(year)
  );
  let best = null;
  trades.forEach(tx => {
    if (tx.isComposite && tx.grade?.teamGrades) {
      const entry = tx.grade.teamGrades.find(t => t.managerId === managerId);
      if (entry && (!best || (entry.parTotal || 0) > best.parTotal)) {
        best = { parTotal: entry.parTotal || 0, description: `Multi-team trade — ${signedFp(entry.parTotal)} PAR` };
      }
    } else if (!tx.isPartOfComposite && tx.grade?.side0 && tx.grade?.side1) {
      const idx = tx.managerIds?.indexOf(managerId);
      if (idx === 0 || idx === 1) {
        const side = idx === 0 ? tx.grade.side0 : tx.grade.side1;
        const otherMgr = mn(tx.managerIds?.[idx === 0 ? 1 : 0]);
        const received = (side.players || []).map(p => `${p.name} (${p.position})`).join(', ') || 'nothing';
        if (!best || (side.parTotal || 0) > best.parTotal) {
          best = { parTotal: side.parTotal || 0, description: `Acquired ${received} from ${otherMgr} — ${signedFp(side.parTotal)} PAR` };
        }
      }
    }
  });
  return best;
}

/**
 * Converts a manager's expected win rate (from strengthOfSchedule.js) into
 * an expected W-L record over the same number of games they actually played,
 * so it can be shown alongside their real record ("8-6 (Should be 10-4)").
 * Expected wins is rounded to the nearest whole win; there's no concept of
 * an "expected tie" in the underlying win-probability math, so only the
 * actual record (shown alongside) can include a real tie.
 */
function computeExpectedRecord(sos, wins, losses, ties) {
  if (!sos || sos.expectedWinRate == null) return null;
  const gp = (wins || 0) + (losses || 0) + (ties || 0);
  if (gp <= 0) return null;
  const expectedWins = Math.round(sos.expectedWinRate * gp);
  const expectedLosses = gp - expectedWins;
  return { expectedWins, expectedLosses, gamesPlayed: gp };
}

/**
 * Builds the per-manager season recap table: everyone's manager grades
 * (overall + components), best/worst draft pick, best waiver add, best
 * trade, best win, worst loss, and expected record — a scannable "here's
 * your year" reference, ranked by final placement.
 */
function computeManagerSeasonCards({ standings, weeklyResults, gradedTransactions, draftEndOfSeasonGrade, seasonSOS, seasonManagerGrades, managersSnapshot, year }) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const draftByManager = {};
  (draftEndOfSeasonGrade?.teamRankings || []).forEach(t => { draftByManager[t.managerId] = t; });

  const sorted = [...(standings || [])].sort((a, b) => (a.finalPlacement || 99) - (b.finalPlacement || 99));

  return sorted.map(team => {
    const managerId = team.managerId;
    const draftTeam = draftByManager[managerId];
    const waiver = getManagerBestWaiver(gradedTransactions, year, managerId);
    const trade  = getManagerBestTrade(gradedTransactions, year, managerId, managersSnapshot);
    const { bestWin, worstLoss } = getManagerBestWinWorstLoss(weeklyResults, standings, year, managerId, managersSnapshot);
    const sos = seasonSOS?.[managerId];
    const rs = team.regularSeason || {};
    const grades = seasonManagerGrades?.[managerId] || null;

    return {
      managerId,
      displayName: mn(managerId),
      finalPlacement: team.finalPlacement,
      overallGrade: grades?.overallGrade ?? null,
      draftGrade: grades?.normDraft ?? null,
      tradeGrade: grades?.normTrade ?? null,
      waiverGrade: grades?.normWaiver ?? null,
      lineupGrade: grades?.normLineup ?? null,
      bestDraftPick: draftTeam?.bestPick || null,
      worstDraftPick: draftTeam?.worstPick || null,
      bestWaiver: waiver,
      bestTrade: trade,
      bestWin, worstLoss,
      actualRecord: { wins: rs.wins || 0, losses: rs.losses || 0, ties: rs.ties || 0 },
      expectedRecord: computeExpectedRecord(sos, rs.wins, rs.losses, rs.ties)
    };
  });
}

/**
 * Converts a manager's ALL-TIME actual record vs an all-time expected record
 * (aggregated from each season's expected win rate × games played that
 * season) into a career-spanning luck signal. Summed in win-units rather
 * than percentages, so it stays comparable across managers who've played
 * different numbers of seasons/games.
 */
function computeAllTimeExpectedRecord(managers, seasonSOSByYear) {
  const result = {};
  Object.entries(managers || {}).forEach(([id, data]) => {
    const rs = (data.seasons || []).reduce((acc, s) => {
      acc.wins   += s.regularSeason?.wins   || 0;
      acc.losses += s.regularSeason?.losses || 0;
      acc.ties   += s.regularSeason?.ties   || 0;
      return acc;
    }, { wins: 0, losses: 0, ties: 0 });
    const gp = rs.wins + rs.losses + rs.ties;
    if (gp <= 0) return;

    let totalExpectedWins = 0;
    let hasData = false;
    Object.values(seasonSOSByYear || {}).forEach((yearSOS) => {
      const d = yearSOS[id];
      if (d?.expectedWinRate != null && d?.gamesPlayed) {
        totalExpectedWins += d.expectedWinRate * d.gamesPlayed;
        hasData = true;
      }
    });
    if (!hasData) return;

    const expectedWins   = Math.round(totalExpectedWins);
    const expectedLosses = gp - expectedWins;
    const luckDiff        = (rs.wins + 0.5 * rs.ties) - totalExpectedWins;

    result[id] = {
      actual:   { wins: rs.wins, losses: rs.losses, ties: rs.ties, gp },
      expected: { wins: expectedWins, losses: expectedLosses },
      luckDiff
    };
  });
  return result;
}

/**
 * Sums the season-by-season chug tally across every season a manager has
 * played, using that season's own roster→manager mapping — needed because
 * roster IDs can be reused by different managers across seasons.
 */
function computeAllTimeChugTally(playerResults, seasons) {
  const tally = {};
  (seasons || []).forEach((s) => {
    const yearTally = computeChugTally(playerResults, s.year, 99, s.rosterToManagerId || {});
    Object.entries(yearTally).forEach(([id, count]) => {
      tally[id] = (tally[id] || 0) + count;
    });
  });
  return tally;
}

/**
 * One entry per season: whoever had the worst regular-season record that
 * year (same scoring formula as deriveSeasonOutcomes' regularSeasonLoser),
 * with that year's specific punishment attached. Powers the Hall of Shame
 * section in exportAllTimeHistory.
 */
function computeAllTimeRegularSeasonLosers(managers, managersSnapshot) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const byYear = {};
  Object.entries(managers || {}).forEach(([id, data]) => {
    (data.seasons || []).forEach((s) => {
      const year = String(s.year);
      const rs = s.regularSeason || {};
      const gp = (rs.wins || 0) + (rs.losses || 0) + (rs.ties || 0);
      if (gp === 0) return;
      const score = (rs.wins + 0.5 * (rs.ties || 0)) / gp * 1000 + (rs.fptsFor || 0) / 1000;
      if (!byYear[year] || score < byYear[year].score) {
        byYear[year] = {
          year,
          managerId: id,
          displayName: mn(id),
          wins: rs.wins || 0,
          losses: rs.losses || 0,
          ties: rs.ties || 0,
          ppg: gp > 0 ? (rs.fptsFor || 0) / gp : null,
          score,
          punishment: REGULAR_SEASON_LOSER_PUNISHMENTS[year]
            || `Punishment for ${year} not yet recorded`
        };
      }
    });
  });
  return Object.values(byYear).sort((a, b) => Number(a.year) - Number(b.year));
}

/**
 * Best waiver pickup OR best trade return for one manager in one specific
 * season, whichever had the higher PAR — powers the Hall of Fame's "Best
 * Transaction" column for that year's champion.
 */
function getManagerBestTransactionForYear(gradedTransactions, year, managerId, managersSnapshot) {
  const waiver = getManagerBestWaiver(gradedTransactions, year, managerId);
  const trade  = getManagerBestTrade(gradedTransactions, year, managerId, managersSnapshot);
  const waiverVal = waiver?.par ?? -Infinity;
  const tradeVal  = trade?.parTotal ?? -Infinity;
  if (waiver && waiverVal >= tradeVal) {
    return { description: `+${waiver.name} (${waiver.position}) waiver pickup — ${signedFp(waiver.par)} PAR` };
  }
  if (trade) {
    return { description: trade.description };
  }
  return null;
}

/**
 * One entry per season: that year's champion, their regular-season record
 * and PPG, best draft pick (from that year's post-season draft grades), and
 * best transaction (waiver or trade). Powers the Hall of Fame section in
 * exportAllTimeHistory. Includes every champion in league history, not just
 * current members — this is a historical record, unlike the superlatives.
 */
function computeHallOfFame(managers, gradedTransactions, draftGradesFullByYear, managersSnapshot) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const byYear = {};
  Object.entries(managers || {}).forEach(([id, data]) => {
    (data.seasons || []).forEach((s) => {
      if (s.finalPlacement !== 1) return;
      const year = String(s.year);
      const rs = s.regularSeason || {};
      const gp = (rs.wins || 0) + (rs.losses || 0) + (rs.ties || 0);
      const ppg = gp > 0 ? (rs.fptsFor || 0) / gp : null;

      const draftGrade = draftGradesFullByYear?.[year];
      const teamEntry = draftGrade?.teamRankings?.find((t) => t.managerId === id);
      const bestPick = teamEntry?.bestPick || null;

      const bestTransaction = getManagerBestTransactionForYear(gradedTransactions, year, id, managersSnapshot);

      byYear[year] = {
        year, managerId: id, displayName: mn(id),
        wins: rs.wins || 0, losses: rs.losses || 0, ties: rs.ties || 0, ppg,
        bestPick, bestTransaction
      };
    });
  });
  return Object.values(byYear).sort((a, b) => Number(a.year) - Number(b.year));
}

/**
 * "Current league member" = played in the most recent season present in the
 * data. Derived entirely from the managers object itself, NOT from the live
 * Sleeper roster snapshot — that snapshot can be stale, scoped differently,
 * or otherwise mismatched, which was the actual cause of departed managers
 * still showing up in the All-Time Superlatives. This is self-contained and
 * always consistent with the rest of what's being exported.
 */
function getCurrentMemberIds(managers) {
  const allYears = new Set();
  Object.values(managers || {}).forEach((m) => (m.seasons || []).forEach((s) => allYears.add(Number(s.year))));
  const currentIds = new Set();
  if (!allYears.size) return currentIds;
  const mostRecentYear = Math.max(...allYears);
  Object.entries(managers || {}).forEach(([id, data]) => {
    if ((data.seasons || []).some((s) => Number(s.year) === mostRecentYear)) {
      currentIds.add(id);
    }
  });
  return currentIds;
}

/**
 * Finds the single highest-PAR transaction across every season — either a
 * waiver pickup or one side of a trade (including composite multi-team
 * trades). Requires the FULL unfiltered gradedTransactions array (not
 * scoped to one season), unlike the season-level trade/waiver helpers.
 * Only considers CURRENT league members (see All-Time Superlatives).
 */
function computeAllTimeBestSingleTransaction(gradedTransactions, currentMemberIds, managersSnapshot) {
  const mn = (id) => mgrName(id, managersSnapshot);
  let best = null;

  (gradedTransactions || []).forEach((tx) => {
    const season = tx.seasonKey || tx.season;

    if (tx.type === 'waiver' && !tx.isPartOfComposite && tx.grade?.par != null) {
      const mgrId = tx.managerIds?.[0];
      if (!currentMemberIds.has(mgrId)) return;
      if (!best || tx.grade.par > best.value) {
        best = {
          value: tx.grade.par,
          description: `${mn(mgrId)} — waiver pickup of ${tx.grade.name} (${tx.grade.position}), ${season} — ${signedFp(tx.grade.par)} PAR`
        };
      }
    } else if (tx.isComposite && tx.grade?.teamGrades) {
      tx.grade.teamGrades.forEach((t) => {
        if (!currentMemberIds.has(t.managerId)) return;
        if (t.parTotal != null && (!best || t.parTotal > best.value)) {
          best = {
            value: t.parTotal,
            description: `${mn(t.managerId)} — multi-team trade return, ${season} — ${signedFp(t.parTotal)} PAR`
          };
        }
      });
    } else if (tx.type === 'trade' && !tx.isPartOfComposite && tx.grade?.side0 && tx.grade?.side1) {
      [tx.grade.side0, tx.grade.side1].forEach((side, idx) => {
        const mgrId = tx.managerIds?.[idx];
        if (!currentMemberIds.has(mgrId)) return;
        if (side?.parTotal != null && (!best || side.parTotal > best.value)) {
          best = {
            value: side.parTotal,
            description: `${mn(mgrId)} — trade return, ${season} — ${signedFp(side.parTotal)} PAR`
          };
        }
      });
    }
  });

  return best;
}

/**
 * All-time equivalent of computeSuperlatives — career-spanning instead of
 * one season. Excludes "Most Improved" (doesn't make sense career-wide) and
 * adds Luckiest/Unluckiest as an actual-vs-expected record comparison.
 */
function computeAllTimeSuperlatives({ allTimeManagerGrades, managers, seasonSOSByYear, playerResults, seasons, gradedTransactions, managersSnapshot }) {
  const mn = (id) => mgrName(id, managersSnapshot);
  // Derived from the managers data itself, not the live Sleeper snapshot —
  // see getCurrentMemberIds for why.
  const currentMemberIds = getCurrentMemberIds(managers);
  const isCurrentMember = (id) => currentMemberIds.has(id);

  const pickFromAllTime = (field, isBetter) => {
    let bestId = null, bestVal = null;
    Object.entries(allTimeManagerGrades || {}).forEach(([id, data]) => {
      if (!isCurrentMember(id)) return; // current league members only
      const val = data[field];
      if (val == null) return;
      if (bestVal === null || isBetter(val, bestVal)) { bestVal = val; bestId = id; }
    });
    return bestId ? { managerId: bestId, displayName: mn(bestId), value: bestVal } : null;
  };

  const bestManager  = pickFromAllTime('allTimeGrade', (a, b) => a > b);
  const worstManager = pickFromAllTime('allTimeGrade', (a, b) => a < b);
  const bestTrader     = pickFromAllTime('avgRawTradePAR',  (a, b) => a > b);
  const worstTrader    = pickFromAllTime('avgRawTradePAR',  (a, b) => a < b);
  const bestWaiver      = pickFromAllTime('avgRawWaiverPAR', (a, b) => a > b);
  const worstWaiver     = pickFromAllTime('avgRawWaiverPAR', (a, b) => a < b);
  const lineupGenius    = pickFromAllTime('avgRawLineupIQ',  (a, b) => a > b);

  const chugTallyAllTime = (playerResults && seasons) ? computeAllTimeChugTally(playerResults, seasons) : {};
  let chugKing = null;
  Object.entries(chugTallyAllTime).forEach(([id, val]) => {
    if (!isCurrentMember(id)) return; // current league members only
    if (!chugKing || val > chugKing.value) chugKing = { managerId: id, displayName: mn(id), value: val };
  });

  const expectedRecords = computeAllTimeExpectedRecord(managers, seasonSOSByYear);
  let luckiest = null, unluckiest = null;
  Object.entries(expectedRecords).forEach(([id, rec]) => {
    if (!isCurrentMember(id)) return; // current league members only
    if (rec.luckDiff == null) return;
    if (!luckiest || rec.luckDiff > luckiest.rec.luckDiff) luckiest = { managerId: id, displayName: mn(id), rec };
    if (!unluckiest || rec.luckDiff < unluckiest.rec.luckDiff) unluckiest = { managerId: id, displayName: mn(id), rec };
  });

  const bestSingleTransaction = computeAllTimeBestSingleTransaction(gradedTransactions, currentMemberIds, managersSnapshot);

  return { bestManager, worstManager, bestTrader, worstTrader, bestWaiver, worstWaiver, lineupGenius, chugKing, luckiest, unluckiest, bestSingleTransaction };
}

// ── League context ────────────────────────────────────────────────────────────

export function exportLeagueContext(managersSnapshot, mostRecentYear = null) {
  const lines = [];
  lines.push('# National Liver Failure League (NLFL) — League Context');
  lines.push('');
  lines.push('## League Identity');
  lines.push('This is a 12-team PPR fantasy football league called the **National Liver Failure League (NLFL)**.');
  lines.push('The tone is extremely trash-talky, irreverent, and filthy. Managers roast each other relentlessly.');
  lines.push('Articles are written from an insider perspective — like a group chat that got out of hand.');
  lines.push('Use real names (provided below), specific scores, and call people out by name.');
  lines.push('');
  lines.push('## League Rules & Structure');
  lines.push('- 12 teams, PPR scoring (1 point per reception)');
  lines.push('- Regular season: weeks 1-14 (standings, power rankings, seeding)');
  lines.push('- Playoffs: weeks 15-17. Championship bracket = top 6 regular-season teams, playing for final placements #1-6. Consolation bracket = bottom 6 teams, playing for final placements #7-12');
  lines.push('- **Bowl Games** — every odd-numbered final placement from 1st through 11th has its own named bowl with its own reward. Use these names/rewards exactly, they are league canon:');
  Object.entries(BOWL_DEFINITIONS).forEach(([placement, b]) => {
    const suffix = placement === '1' ? 'st' : placement === '3' ? 'rd' : 'th';
    lines.push(`  - ${b.emoji} **${b.name}** (${placement}${suffix} Place): ${b.reward}`);
  });
  lines.push(`- **Runner-Up** (2nd Place): ${RUNNER_UP_REWARD}`);
  lines.push('- **Regular Season Last Place** ("the actual loser of the league" — judged on regular-season record only, independent of how they finish in the consolation bracket): buys the champion\'s name bracket for the trophy, is beer bitch at the next draft, and performs that year\'s specific punishment (varies year to year — see the Regular Season Loser Punishments list below)');
  lines.push('- **Landmines** (a draft-night game, occurs at the NEXT draft after this season ends): before the draft, whoever holds the 1st overall pick secretly writes down one player ranked 1-10 (by ADP/consensus rank) on an index card; the 2nd pick writes down a player ranked 11-20; the 3rd pick a player ranked 21-30; and so on in bands of 10 for later pick slots (this pattern for picks 4+ is inferred, not explicitly confirmed). If the written-down player gets drafted by anyone during the draft, the landmine holder announces it, and whoever drafted that player must finish their beer or take a shot on the spot. Several bowl rewards modify landmines for their winner (extra landmines, redirect, skip, etc. — see Bowl Games above)');
  lines.push('- **Rivalry Week**: rivals and the stakes they bet are set fresh each year — see the Rivalry Week Results section in the season data for who faced whom, what they bet, and who won');
  lines.push('- **House Rule — The Chug Rule**: any manager who STARTS a player who scores 0 or negative points that week owes a shotgun/chug before the next week starts. Multiple qualifying starters in the same week = multiple chugs. A running season tally is included in the standings and power rankings tables.');
  lines.push('');
  lines.push('## Regular Season Loser Punishments By Year');
  lines.push('*For callbacks — reference past years\' punishments when writing about the current one.*');
  lines.push('');
  Object.entries(REGULAR_SEASON_LOSER_PUNISHMENTS)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([yr, punishment]) => {
      lines.push(`- **${yr}**: ${punishment}`);
    });
  lines.push('');
  lines.push('## Roster Settings (2024 onward)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×2 (RB/WR/TE), K×1, DEF×1, BN×6 — 17 rounds');
  lines.push('');
  lines.push('## Roster Settings (2023)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×1 (RB/WR/TE), K×1, DEF×1, BN×7 — 16 rounds');
  lines.push('');
  lines.push('## Writing Style Guide');
  lines.push('- Write like you\'re in a group chat with your boys, not a sports column');
  lines.push('- Call people out BY REAL NAME with specific scores and stats');
  lines.push('- Trash talk the losers, hype up the winners, question everyone\'s life choices');
  lines.push('- Profanity is fine and expected — "ass cheeks", "suck my nutz", "dogshit", "what the fuck" are all appropriate');
  lines.push('- Reference specific players, scores, and stats from the data to back up every claim');
  lines.push('- Inside jokes and callbacks to prior seasons or past games make it hit harder');
  lines.push('- Keep sentences short and punchy. No flowery sports journalism language.');
  lines.push('- Stick to real names, in-league history, and stats to make it hit hard.');
  lines.push('- **Formatting**: bold is reserved for section headers/subheaders, per-game header lines, trade header lines, and matchup title lines/labels in the Next Week Preview. Never bold a player name, manager name, score, or stat inside a sentence or paragraph — plain text throughout the prose. Never use HTML tags like <u> — they don\'t render reliably in most viewers.');
  lines.push('- Never include internal methodology, weighting formulas, or calculation notes anywhere in the article — those are for internal computation only, never narrative content.');
  lines.push('- Where the data hands you pre-built bolded lines (game headers, matchup preview blocks), reproduce them EXACTLY as given, each on its own line, preserving any blank lines between them — do not merge them into a paragraph or run them together with spaces.');
  lines.push('- **Bulleted data blocks (Season Outcomes, Rivalry Week Results, and similar) MUST stay as separate bullet points, each with its given icon and bold label — never collapse them into flowing paragraph prose.** This has been a recurring compliance issue; be careful here specifically.');
  lines.push('- Bowl names/rewards, the regular season loser\'s punishment, and Rivalry Week results are league canon — use them exactly as given in the data, never invent your own.');
  lines.push('- Don\'t repeat the same specific facts (a stat, a result, an award winner) across multiple sections of the same article. Each section covers its own ground — if something is covered in a dedicated section later, don\'t pre-empt it earlier in vaguer form.');
  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR**: Points Above Replacement — how much a player/pickup/trade exceeded a freely available alternative');
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round');
  lines.push('- **Lineup IQ**: actual pts scored ÷ maximum possible pts. Higher = better lineup decisions');
  lines.push('- **Expected Record**: what a manager\'s win-loss record "should" have been based on how their weekly score stacked up against the whole league each week, shown alongside their actual record (e.g. "8-6 (Should be 10-4)") — a way of showing luck as a record instead of a percentage. Shown per season in the Manager Season Recap Cards table, and career-wide in the All-Time Superlatives Luckiest/Unluckiest entries');
  lines.push('- **Manager Grade**: Draft 40% + Trades 20% + Waivers 20% + Lineup IQ 20%. C = league average. Both the overall grade and each component grade are shown per manager in the Manager Season Recap Cards table');
  lines.push('- **PPG**: Points Per Game — regular season total points ÷ regular season games played, through the most recent completed week');
  lines.push('- **Odds**: American/moneyline format (e.g. -150 favorite, +130 underdog) derived from each team\'s season PPG — a fun estimate, not a real projection model');
  lines.push('');
  lines.push(buildSimpleManagerList(managersSnapshot));
  return lines.join('\n');
}

// ── Season stats export ───────────────────────────────────────────────────────

export function exportSeasonStats({
  year, standings, weeklyResults, seasonManagerGrades, seasonSOS,
  draftEndOfSeasonGrade, managerTradePAR, managerWaiverPAR,
  managerLineupIQ, rosterStats, managersSnapshot,
  gradedTransactions, playerResults, rosterToManagerId
}) {
  const mn      = (id) => mgrName(id, managersSnapshot);
  const lines   = [];
  const outcomes = deriveSeasonOutcomes(standings, weeklyResults, managersSnapshot, year);
  const seasonChugTally = (playerResults && rosterToManagerId)
    ? computeChugTally(playerResults, year, 99, rosterToManagerId)
    : {};

  lines.push(`# NLFL ${year} Season — Full Data`);
  lines.push('');
  lines.push('## Season Outcomes');
  lines.push('*Derived from final placements and regular-season records. Bowl names/rewards and the regular season loser\'s punishment are league canon — use them exactly, don\'t invent your own. EACH LINE BELOW IS ITS OWN BULLET (icon + bold label) — reproduce as separate bullet points, never merge into paragraph prose. Use as ground truth.*');
  lines.push('');

  const bw = outcomes?.bowlWinners || {};
  if (bw[1]) {
    lines.push(`- ${bw[1].emoji} **${bw[1].name}**: ${substituteWinnerName(bw[1].reward, bw[1].displayName)}`);
  } else {
    lines.push('- 🏆 **National Liver Failure League Championship**: Not yet determined');
  }
  if (outcomes?.runnerUp) {
    lines.push(`- 🥈 **Runner-Up**: ${substituteWinnerName(RUNNER_UP_REWARD, outcomes.runnerUp.displayName)}`);
  }
  [3, 5, 7, 9, 11].forEach(placement => {
    const b = bw[placement];
    if (b) lines.push(`- ${b.emoji} **${b.name}** (${placement}th Place): ${substituteWinnerName(b.reward, b.displayName)}`);
  });
  if (outcomes?.regularSeasonLoser) {
    const l = outcomes.regularSeasonLoser;
    const championName = bw[1]?.displayName || null;
    const championPossessive = championName ? `${championName}'s` : "the champion's";
    lines.push(`- 💀 **Regular Season Last Place** (the actual loser of the league — based on regular season record, not final bracket placement): ${l.displayName} (${l.wins}-${l.losses}${l.ties > 0 ? `-${l.ties}` : ''}, ${l.ppg!=null?fp(l.ppg):'—'} ppg). Consequences: buys ${championPossessive} name bracket for the trophy, is beer bitch at the next draft, and this year's specific punishment — ${l.punishment}`);
  } else {
    lines.push('- 💀 **Regular Season Last Place**: Not available in data');
  }

  const rivalryInfo = getRivalryResultsForYear(year, weeklyResults, managersSnapshot);
  if (rivalryInfo) {
    lines.push('');
    lines.push(`## Rivalry Week Results (Week ${rivalryInfo.week})`);
    lines.push('*Names are already substituted into the bet text below — reproduce as-is, as separate bullet points. A note means the name-matching or result lookup was uncertain — double check manually.*');
    lines.push('');
    rivalryInfo.results.forEach(r => {
      if (r.resolved) {
        lines.push(`- **${r.displayA} vs ${r.displayB}**: ${r.resolvedBetText}`);
      } else {
        lines.push(`- **${r.displayA} vs ${r.displayB}**: ${r.bet}${r.note ? ` (${r.note})` : ''}`);
      }
    });
  }

  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('');
  lines.push('| Reg Rank | Manager | W | L | T | PPG | Opp PPG | Diff | 🍺 Chugs | Made Playoffs? |');
  lines.push('|----------|---------|---|---|---|-----|---------|------|----------|----------------|');

  const sortedByRegSeason = [...(standings || [])].sort((a, b) => {
    const wa = a.regularSeason?.wins || 0;
    const wb = b.regularSeason?.wins || 0;
    if (wb !== wa) return wb - wa;
    return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
  });

  sortedByRegSeason.forEach((team, idx) => {
    const rs = team.regularSeason || {};
    const gp = (rs.wins || 0) + (rs.losses || 0) + (rs.ties || 0);
    const ppgFor     = gp > 0 ? (rs.fptsFor || 0) / gp : null;
    const ppgAgainst = gp > 0 ? (rs.fptsAgainst || 0) / gp : null;
    const diffPpg    = (ppgFor != null && ppgAgainst != null) ? ppgFor - ppgAgainst : null;
    const made = (team.finalPlacement || 99) <= 6
      ? `✓ Playoffs (seed #${idx + 1})`
      : 'Loser Bowl';
    const chugs = seasonChugTally[team.managerId] || 0;
    lines.push(`| #${idx+1} | **${mn(team.managerId)}** | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${ppgFor!=null?fp(ppgFor):'—'} | ${ppgAgainst!=null?fp(ppgAgainst):'—'} | ${diffPpg!=null?signedFp(diffPpg):'—'} | ${chugs} | ${made} |`);
  });

  lines.push('');
  lines.push('## Final Post-Season Standings');
  lines.push('');
  const sortedByFinal = [...(standings || [])]
    .filter(t => t.finalPlacement != null)
    .sort((a, b) => (a.finalPlacement || 99) - (b.finalPlacement || 99));

  if (sortedByFinal.length > 0) {
    lines.push('| Final Place | Manager | Notes |');
    lines.push('|-------------|---------|-------|');
    sortedByFinal.forEach(team => {
      const b = BOWL_DEFINITIONS[team.finalPlacement];
      const note = b ? `${b.emoji} ${b.name}` : (team.finalPlacement === 2 ? '🥈 Runner-Up' : '');
      lines.push(`| #${team.finalPlacement} | **${mn(team.managerId)}** | ${note} |`);
    });
  } else {
    lines.push('*Post-season placements not available — use regular season standings as proxy.*');
  }

  lines.push('');
  lines.push('## Manager Grades');
  lines.push('*Letter grades only — C = league average.*');
  lines.push('');
  lines.push('| Manager | Overall | Draft | Trades | Waivers | Lineup IQ |');
  lines.push('|---------|---------|-------|--------|---------|-----------|');

  const activeIds = sortedByRegSeason.map(t => t.managerId).filter(Boolean);
  activeIds.forEach(id => {
    const g = seasonManagerGrades?.[id];
    if (!g) return;
    lines.push(`| ${mn(id)} | **${toLetter(g.overallGrade)}** | ${toLetter(g.normDraft)} | ${toLetter(g.normTrade)} | ${toLetter(g.normWaiver)} | ${toLetter(g.normLineup)} |`);
  });

  lines.push('');
  lines.push('### Raw Component Values');
  lines.push('');
  lines.push('| Manager | Draft Adj PAR | Trade PAR | Waiver PAR | Lineup IQ% |');
  lines.push('|---------|---------------|-----------|------------|------------|');
  activeIds.forEach(id => {
    const g = seasonManagerGrades?.[id];
    if (!g) return;
    lines.push(`| ${mn(id)} | ${g.rawDraftPAR!=null?signedFp(g.rawDraftPAR):'—'} | ${g.rawTradePAR!=null?signedFp(g.rawTradePAR):'—'} | ${g.rawWaiverPAR!=null?signedFp(g.rawWaiverPAR):'—'} | ${g.rawLineupIQ!=null?pct(g.rawLineupIQ):'—'} |`);
  });

  const lopsided = getMostLopsidedTrades(gradedTransactions, year, managersSnapshot, 5);
  if (lopsided.length > 0) {
    lines.push('');
    lines.push('## Most Lopsided Trades This Season');
    lines.push('*Ranked by PAR gap between the two sides — the biggest heists and fleecings of the year.*');
    lines.push('');
    lopsided.forEach((entry, i) => {
      lines.push(`${i+1}. PAR gap: ${signedFp(entry.disparity)}`);
      entry.summaryLines.forEach(l => lines.push(`   - ${l}`));
      lines.push('');
    });
  }

  const topWaivers = getTopSeasonWaiverPickups(gradedTransactions, year, managersSnapshot, 5);
  if (topWaivers.length > 0) {
    lines.push('');
    lines.push('## Top Waiver Pickups This Season');
    lines.push('*Ranked by full-season PAR from the pickup date onward.*');
    lines.push('');
    topWaivers.forEach((p, i) => {
      const drop = p.droppedName ? ` (dropped ${p.droppedName})` : '';
      lines.push(`${i+1}. **${p.manager}** — +${p.name} (${p.position})${drop} — ${signedFp(p.par)} PAR, grade: ${p.gradeLabel}`);
    });
  }

  lines.push('');
  lines.push('## Season Superlatives (Pre-computed — use these, don\'t recompute)');
  lines.push('');
  const sup = computeSuperlatives({ managerTradePAR, managerWaiverPAR, chugTally: seasonChugTally, seasonManagerGrades, managersSnapshot });
  if (sup.bestManager) lines.push(`- 🏆 **Best Manager**: ${sup.bestManager.displayName} (Grade: ${toLetter(sup.bestManager.value)})`);
  if (sup.bestTrader)  lines.push(`- 🤝 **Best Trader**: ${sup.bestTrader.displayName} (${signedFp(sup.bestTrader.value)} total trade PAR)`);
  if (sup.worstTrader) lines.push(`- 🐟 **Worst Trader**: ${sup.worstTrader.displayName} (${signedFp(sup.worstTrader.value)} total trade PAR)`);
  if (sup.bestWaiver)  lines.push(`- 🎣 **Best Waiver Manager**: ${sup.bestWaiver.displayName} (${signedFp(sup.bestWaiver.value)} total waiver PAR)`);
  if (sup.worstWaiver) lines.push(`- 🗑️ **Worst Waiver Manager**: ${sup.worstWaiver.displayName} (${signedFp(sup.worstWaiver.value)} total waiver PAR)`);
  if (sup.chugKing)    lines.push(`- 🍺 **Chug King**: ${sup.chugKing.displayName} (${sup.chugKing.value} chugs this season)`);

  if (draftEndOfSeasonGrade) {
    lines.push('');
    lines.push('## Post-Season Draft Grades');
    lines.push(`*Baseline: ${draftEndOfSeasonGrade.baselineSeasons?.join(', ')}*`);
    lines.push('');
    lines.push('| Rank | Manager | Grade | Adj PAR | Best Pick | Worst Pick |');
    lines.push('|------|---------|-------|---------|-----------|------------|');
    draftEndOfSeasonGrade.teamRankings?.forEach((team, idx) => {
      const bp = team.bestPick;
      const wp = team.worstPick;
      lines.push(`| #${idx+1} | ${mn(team.managerId)} | **${team.grade}** | ${signedFp(team.totalAdjustedPAR)} | ${bp?`${bp.playerName} R${bp.round} (${signedFp(bp.adjustedPAR)})`:'-'} | ${wp?`${wp.playerName} R${wp.round} (${signedFp(wp.adjustedPAR)})`:'-'} |`);
    });

    lines.push('');
    lines.push('### Top Draft Steals');
    (draftEndOfSeasonGrade.leagueTopSteals||[]).slice(0,5).forEach((p,i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, ${fp(p.actualPts)} pts`);
    });

    lines.push('');
    lines.push('### Biggest Draft Busts');
    (draftEndOfSeasonGrade.leagueTopBusts||[]).slice(0,5).forEach((p,i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, ${fp(p.actualPts)} pts`);
    });
  }

  if (rosterStats) {
    lines.push('');
    lines.push('## Lineup IQ');
    lines.push('');
    lines.push('| Manager | Points Scored | Max Possible | Efficiency |');
    lines.push('|---------|---------------|--------------|------------|');
    activeIds
      .map(id => ({ id, data: rosterStats[id]?.[String(year)] }))
      .filter(({ data }) => data)
      .sort((a, b) => (b.data.lineupIQ||0) - (a.data.lineupIQ||0))
      .forEach(({ id, data }) => {
        lines.push(`| ${mn(id)} | ${fp(data.fpts)} | ${fp(data.ppts)} | ${pct(data.lineupIQ)} |`);
      });
  }

  const cards = computeManagerSeasonCards({ standings, weeklyResults, gradedTransactions, draftEndOfSeasonGrade, seasonSOS, seasonManagerGrades, managersSnapshot, year });
  if (cards.length > 0) {
    lines.push('');
    lines.push('## Manager Season Recap Cards');
    lines.push('*Ranked by final placement. This is a scannable reference so every manager can see their own year at a glance — reproduce as a table, don\'t narrate every row.*');
    lines.push('');
    lines.push('| Place | Manager | Overall Grade | Draft Grade | Trade Grade | Waiver Grade | Lineup IQ Grade | Record (Expected) | Best Draft Pick | Worst Draft Pick | Best Waiver Add | Best Trade | Best Win | Worst Loss |');
    lines.push('|-------|---------|----------------|--------------|--------------|---------------|------------------|--------------------|------------------|-------------------|------------------|------------|----------|-------------|');
    cards.forEach(c => {
      const place = c.finalPlacement != null ? `#${c.finalPlacement}` : '—';
      const bestPick = c.bestDraftPick ? `${c.bestDraftPick.playerName} (Rd ${c.bestDraftPick.round}, ${signedFp(c.bestDraftPick.adjustedPAR)} PAR)` : '—';
      const worstPick = c.worstDraftPick ? `${c.worstDraftPick.playerName} (Rd ${c.worstDraftPick.round}, ${signedFp(c.worstDraftPick.adjustedPAR)} PAR)` : '—';
      const bestWaiver = c.bestWaiver ? `${c.bestWaiver.name} (${c.bestWaiver.position}, ${signedFp(c.bestWaiver.par)} PAR)` : '—';
      const bestTrade = c.bestTrade ? c.bestTrade.description : 'Refused To Trade With Anyone';
      const bestWin = c.bestWin ? `Wk${c.bestWin.week}: ${fp(c.bestWin.pointsFor)}-${fp(c.bestWin.pointsAgainst)} vs ${c.bestWin.opponent}${c.bestWin.isUpset?' (upset!)':''}` : '—';
      const worstLoss = c.worstLoss ? `Wk${c.worstLoss.week}: ${fp(c.worstLoss.pointsFor)}-${fp(c.worstLoss.pointsAgainst)} vs ${c.worstLoss.opponent}${c.worstLoss.isUpset?' (bad loss)':''}` : '—';
      const ar = c.actualRecord;
      const actualStr = `${ar.wins}-${ar.losses}${ar.ties>0?`-${ar.ties}`:''}`;
      let recordCell = actualStr;
      if (c.expectedRecord) {
        const expectedStr = `${c.expectedRecord.expectedWins}-${c.expectedRecord.expectedLosses}`;
        recordCell = expectedStr === `${ar.wins}-${ar.losses}`
          ? `${actualStr} (as expected)`
          : `${actualStr} (Should be ${expectedStr})`;
      }
      lines.push(`| ${place} | ${c.displayName} | ${toLetter(c.overallGrade)} | ${toLetter(c.draftGrade)} | ${toLetter(c.tradeGrade)} | ${toLetter(c.waiverGrade)} | ${toLetter(c.lineupGrade)} | ${recordCell} | ${bestPick} | ${worstPick} | ${bestWaiver} | ${bestTrade} | ${bestWin} | ${worstLoss} |`);
    });
  }

  return lines.join('\n');
}

// ── All-time history export ───────────────────────────────────────────────────

export function exportAllTimeHistory({
  allTimeManagerGrades, allTimeSOS, seasonManagerGrades, seasonSOSByYear,
  allDrafts, draftGradesByYear, managerTradePARBySeason, managerWaiverPARBySeason,
  managers, managersSnapshot,
  playerResults, seasons, gradedTransactions, draftGradesFullByYear
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push('# NLFL All-Time League History');
  lines.push('*All grades are letter grades (C = league average for that season)*');
  lines.push('');

  lines.push('## All-Time Manager Grades');
  lines.push('');
  lines.push('| Manager | Overall | Draft | Trades | Waivers | Lineup IQ | Seasons |');
  lines.push('|---------|---------|-------|--------|---------|-----------|---------|');
  Object.entries(allTimeManagerGrades)
    .sort(([,a],[,b]) => (b.allTimeGrade??-1) - (a.allTimeGrade??-1))
    .forEach(([id, data]) => {
      lines.push(`| ${mn(id)} | **${toLetter(data.allTimeGrade)}** | ${toLetter(data.avgNormDraft)} | ${toLetter(data.avgNormTrade)} | ${toLetter(data.avgNormWaiver)} | ${toLetter(data.avgNormLineup)} | ${data.years?.join(', ')} |`);
    });

  lines.push('');
  lines.push('### Manager Grades by Season');
  const allYears = Object.keys(seasonManagerGrades).sort((a,b) => Number(a)-Number(b));
  lines.push(['| Manager', ...allYears.map(y => `**${y}**`), '|'].join(' | '));
  lines.push(['|--------', ...allYears.map(() => '--------'), '|'].join('|'));
  Object.keys(allTimeManagerGrades).forEach(id => {
    const row = [mn(id), ...allYears.map(y => {
      const g = seasonManagerGrades[y]?.[id];
      return g?.overallGrade != null ? toLetter(g.overallGrade) : '—';
    })];
    lines.push('| ' + row.join(' | ') + ' |');
  });

  lines.push('');
  lines.push('### Final Placement by Season');
  lines.push('*Exact final standing each manager finished each season — this is ground truth for any claim about past placements. Never state a manager repeated a finish (e.g. "runner-up two years running") unless this table confirms it for each year individually.*');
  lines.push('');
  const placementYearsSet = new Set();
  Object.values(managers || {}).forEach((m) => (m.seasons || []).forEach((s) => placementYearsSet.add(String(s.year))));
  const placementYears = [...placementYearsSet].sort((a, b) => Number(a) - Number(b));
  if (placementYears.length > 0) {
    lines.push(['| Manager', ...placementYears.map((y) => `**${y}**`), '|'].join(' | '));
    lines.push(['|--------', ...placementYears.map(() => '------'), '|'].join('|'));
    Object.entries(managers || {}).forEach(([id, data]) => {
      const seasonByYear = {};
      (data.seasons || []).forEach((s) => { seasonByYear[String(s.year)] = s; });
      const row = [mn(id), ...placementYears.map((y) => {
        const s = seasonByYear[y];
        if (!s || s.finalPlacement == null) return '—';
        const b = BOWL_DEFINITIONS[s.finalPlacement];
        if (s.finalPlacement === 1) return '#1 🏆';
        if (s.finalPlacement === 2) return '#2 🥈';
        if (b) return `#${s.finalPlacement} ${b.emoji}`;
        return `#${s.finalPlacement}`;
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });
  } else {
    lines.push('*No season placement data available.*');
  }

  lines.push('');
  lines.push('### All-Time Raw Component Averages');
  lines.push('');
  lines.push('| Manager | Avg Draft Adj PAR | Avg Trade PAR | Avg Waiver PAR | Avg Lineup IQ% |');
  lines.push('|---------|-------------------|---------------|----------------|----------------|');
  Object.entries(allTimeManagerGrades)
    .sort(([,a],[,b]) => (b.allTimeGrade??-1) - (a.allTimeGrade??-1))
    .forEach(([id, data]) => {
      lines.push(`| ${mn(id)} | ${data.avgRawDraftPAR!=null?signedFp(data.avgRawDraftPAR):'—'} | ${data.avgRawTradePAR!=null?signedFp(data.avgRawTradePAR):'—'} | ${data.avgRawWaiverPAR!=null?signedFp(data.avgRawWaiverPAR):'—'} | ${data.avgRawLineupIQ!=null?pct(data.avgRawLineupIQ):'—'} |`);
    });

  lines.push('');
  lines.push('## All-Time Strength of Schedule');
  lines.push('');
  lines.push('| Manager | Avg Opp Pts | Avg Opp Win% | Avg Luck | Label | Seasons |');
  lines.push('|---------|-------------|--------------|----------|-------|---------|');
  Object.entries(allTimeSOS)
    .sort(([,a],[,b]) => b.avgOpponentPts - a.avgOpponentPts)
    .forEach(([id, data]) => {
      lines.push(`| ${mn(id)} | ${fp(data.avgOpponentPts)} | ${data.avgOpponentWinPct!=null?pct(data.avgOpponentWinPct):'—'} | ${data.avgLuck!=null?signedFp(data.avgLuck*100,1)+'%':'—'} | ${data.luckLabel||'—'} | ${data.seasons} |`);
    });

  lines.push('');
lines.push('## All-Time Superlatives (Pre-computed — use these, don\'t recompute)');
  lines.push('*Career-spanning stats, limited to CURRENT league members only (departed managers are excluded from these picks, but still appear in Hall of Fame/Shame below since those are historical records). Use exactly as given — don\'t recalculate or guess.*');
  lines.push('');
  const allTimeSup = computeAllTimeSuperlatives({ allTimeManagerGrades, managers, seasonSOSByYear, playerResults, seasons, gradedTransactions, managersSnapshot });
  if (allTimeSup.bestManager)  lines.push(`- 🏆 **Best Manager All-Time**: ${allTimeSup.bestManager.displayName} (Grade: ${toLetter(allTimeSup.bestManager.value)})`);
  if (allTimeSup.worstManager) lines.push(`- 🤡 **Worst Manager All-Time**: ${allTimeSup.worstManager.displayName} (Grade: ${toLetter(allTimeSup.worstManager.value)})`);
  if (allTimeSup.bestTrader)   lines.push(`- 🤝 **Best Trader All-Time**: ${allTimeSup.bestTrader.displayName} (${signedFp(allTimeSup.bestTrader.value)} avg PAR/season)`);
  if (allTimeSup.worstTrader)  lines.push(`- 🐟 **Worst Trader All-Time**: ${allTimeSup.worstTrader.displayName} (${signedFp(allTimeSup.worstTrader.value)} avg PAR/season)`);
  if (allTimeSup.bestWaiver)   lines.push(`- 🎣 **Best Waiver Manager All-Time**: ${allTimeSup.bestWaiver.displayName} (${signedFp(allTimeSup.bestWaiver.value)} avg PAR/season)`);
  if (allTimeSup.worstWaiver)  lines.push(`- 🗑️ **Worst Waiver Manager All-Time**: ${allTimeSup.worstWaiver.displayName} (${signedFp(allTimeSup.worstWaiver.value)} avg PAR/season)`);
  if (allTimeSup.lineupGenius) lines.push(`- 🧠 **Lineup Genius All-Time**: ${allTimeSup.lineupGenius.displayName} (${pct(allTimeSup.lineupGenius.value)} avg lineup efficiency)`);
  if (allTimeSup.chugKing)     lines.push(`- 🍺 **All-Time Chug King**: ${allTimeSup.chugKing.displayName} (${allTimeSup.chugKing.value} career chugs)`);
  if (allTimeSup.luckiest) {
    const r = allTimeSup.luckiest.rec;
    const actualStr = `${r.actual.wins}-${r.actual.losses}${r.actual.ties>0?`-${r.actual.ties}`:''}`;
    lines.push(`- 🍀 **Luckiest Manager All-Time**: ${allTimeSup.luckiest.displayName} — ${actualStr} actual record, expected ${r.expected.wins}-${r.expected.losses} based on weekly scoring (${fp(r.luckDiff)} wins luckier than deserved)`);
  }
  if (allTimeSup.unluckiest) {
    const r = allTimeSup.unluckiest.rec;
    const actualStr = `${r.actual.wins}-${r.actual.losses}${r.actual.ties>0?`-${r.actual.ties}`:''}`;
    lines.push(`- 🐍 **Unluckiest Manager All-Time**: ${allTimeSup.unluckiest.displayName} — ${actualStr} actual record, expected ${r.expected.wins}-${r.expected.losses} based on weekly scoring (${fp(Math.abs(r.luckDiff))} wins unluckier than deserved)`);
  }
  if (allTimeSup.bestSingleTransaction) lines.push(`- 🎯 **Best Single Transaction All-Time**: ${allTimeSup.bestSingleTransaction.description}`);

const hallOfFame = computeHallOfFame(managers, gradedTransactions, draftGradesFullByYear, managersSnapshot);
  if (hallOfFame.length > 0) {
    lines.push('');
    lines.push('## Hall of Fame — Champions By Year');
    lines.push('*One bullet per season — that year\'s champion, their regular season record/PPG, best draft pick, and best transaction. League canon, use exactly as given, don\'t invent details not in the data.*');
    lines.push('');
    hallOfFame.forEach((h) => {
      const record = `${h.wins}-${h.losses}${h.ties>0?`-${h.ties}`:''}`;
      const pickStr = h.bestPick ? `${h.bestPick.playerName} (Rd ${h.bestPick.round}, ${signedFp(h.bestPick.adjustedPAR)} PAR)` : 'not available';
      const transStr = h.bestTransaction ? h.bestTransaction.description : 'none recorded';
      lines.push(`- **${h.year}**: ${h.displayName} (${record}, ${h.ppg!=null?fp(h.ppg):'—'} ppg) — Best draft pick: ${pickStr}. Best transaction: ${transStr}.`);
    });
  }

  const allTimeLosers = computeAllTimeRegularSeasonLosers(managers, managersSnapshot);
  if (allTimeLosers.length > 0) {
    lines.push('');
    lines.push('## Hall of Shame — Regular Season Last Place By Year');
    lines.push('*One bullet per season — the actual loser of the league that year (regular season record only) and what they had to do about it. League canon, use exactly as given, don\'t invent details not in the data.*');
    lines.push('');
    allTimeLosers.forEach((l) => {
      lines.push(`- **${l.year}**: ${l.displayName} (${l.wins}-${l.losses}${l.ties>0?`-${l.ties}`:''}, ${l.ppg!=null?fp(l.ppg):'—'} ppg) — ${l.punishment}`);
    });
  }

  lines.push('');
  lines.push('## Career Records');
  lines.push('');
  lines.push('| Manager | Seasons | W | L | T | PF | PA | Championships | Last Place Finishes |');
  lines.push('|---------|---------|---|---|---|----|----|---------------|---------------------|');
  Object.entries(managers||{})
    .map(([id, data]) => {
      const rs = data.seasons.reduce((acc, s) => {
        acc.wins   += s.regularSeason?.wins   || 0;
        acc.losses += s.regularSeason?.losses || 0;
        acc.ties   += s.regularSeason?.ties   || 0;
        acc.pf     += s.regularSeason?.fptsFor     || 0;
        acc.pa     += s.regularSeason?.fptsAgainst || 0;
        return acc;
      }, { wins:0, losses:0, ties:0, pf:0, pa:0 });
      const champs = data.seasons.filter(s => s.finalPlacement === 1).length;
      const last   = data.seasons.filter(s => s.finalPlacement != null && s.finalPlacement === s.numRosters).length;
      return { id, rs, champs, last, seasons: data.seasons.length };
    })
    .sort((a,b) => b.rs.wins - a.rs.wins || b.rs.pf - a.rs.pf)
    .forEach(({ id, rs, champs, last, seasons }) => {
      lines.push(`| ${mn(id)} | ${seasons} | ${rs.wins} | ${rs.losses} | ${rs.ties} | ${fp(rs.pf)} | ${fp(rs.pa)} | ${champs||'0'} | ${last||'0'} |`);
    });

  if (Object.keys(draftGradesByYear).length > 0) {
    lines.push('');
    lines.push('## Draft Performance by Season (Adjusted PAR)');
    lines.push('');
    const draftYears = Object.keys(draftGradesByYear).sort((a,b) => Number(a)-Number(b));
    lines.push(['| Manager', ...draftYears, '|'].join(' | '));
    lines.push(['|--------', ...draftYears.map(() => '------'), '|'].join('|'));
    const allMgrIds = new Set(Object.values(draftGradesByYear).flatMap(y => Object.keys(y)));
    [...allMgrIds].forEach(id => {
      const row = [mn(id), ...draftYears.map(y => {
        const v = draftGradesByYear[y]?.[id];
        return v != null ? signedFp(v) : '—';
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });
  }

  const txYears = [...new Set([
    ...Object.keys(managerTradePARBySeason||{}),
    ...Object.keys(managerWaiverPARBySeason||{})
  ])].sort((a,b) => Number(a)-Number(b));

  if (txYears.length > 0) {
    const tHeader = ['| Manager', ...txYears, '|'].join(' | ');
    const tSep    = ['|--------', ...txYears.map(() => '------'), '|'].join('|');

    lines.push('');
    lines.push('## Trade PAR by Season');
    lines.push('');
    lines.push(tHeader); lines.push(tSep);
    const tradeMgrs = new Set(Object.values(managerTradePARBySeason||{}).flatMap(y => Object.keys(y)));
    [...tradeMgrs].forEach(id => {
      const row = [mn(id), ...txYears.map(y => {
        const v = managerTradePARBySeason?.[y]?.[id];
        return v != null ? signedFp(v) : '—';
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });

    lines.push('');
    lines.push('## Waiver PAR by Season');
    lines.push('');
    lines.push(tHeader); lines.push(tSep);
    const waiverMgrs = new Set(Object.values(managerWaiverPARBySeason||{}).flatMap(y => Object.keys(y)));
    [...waiverMgrs].forEach(id => {
      const row = [mn(id), ...txYears.map(y => {
        const v = managerWaiverPARBySeason?.[y]?.[id];
        return v != null ? signedFp(v) : '—';
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });
  }

  return lines.join('\n');
}

// ── Weekly data export ────────────────────────────────────────────────────────

/**
 * @param {Array}   allSeasonWeeklyResults   All game results for this season
 * @param {Array}   allTimeWeeklyResults     All game results across ALL seasons (used only for the Next Week Preview's all-time H2H)
 * @param {Array}   playerResults            Per-player-per-week stat lines: { year, week, rosterId, playerId, pointsTotal, pointsStarted, isStarter }
 * @param {Object}  allPlayersData           Sleeper player_id -> player info map
 * @param {Object}  rosterToManagerId        rosterId -> managerId map for THIS season
 * @param {boolean} isTestMode               Adds a disclaimer banner in test mode
 */
export function exportWeeklyData({
  year,
  week,
  weeklyResults,
  allSeasonWeeklyResults,
  allTimeWeeklyResults,
  gradedTransactions,
  currentStandings,
  powerRankings,
  previousPowerRankings,
  nextWeekMatchups,
  isTestMode,
  managersSnapshot,
  playerResults,
  allPlayersData,
  rosterToManagerId
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# NLFL ${year} — Week ${week} Data`);
  lines.push('');

  if (isTestMode) {
    lines.push('> **⚠ TEST MODE — HISTORICAL DATA**');
    lines.push(`> Simulates a Week ${week} export from the ${year} season.`);
    lines.push('> ');
    lines.push('> **Accurate**: matchup results, waiver moves, trade details, standings through this week, next week matchups, week-specific waiver PAR, notable performances, chug tally.');
    lines.push('');
  }

  lines.push(`## Week ${week} Matchup Results`);
  lines.push('*Use these exact bolded lines as your Game Recap headers, verbatim — do not reformat them.*');
  lines.push('');

  const seen = new Set();
  const matchups = [];
  (weeklyResults||[]).filter(r => !r.isPlayoffs).forEach(r => {
    const key = [r.managerId, r.opponentManagerId].sort().join('-');
    if (!seen.has(key)) { seen.add(key); matchups.push(r); }
  });

  const thisWeekByManager = {};
  (weeklyResults || []).filter(r => !r.isPlayoffs).forEach(r => {
    thisWeekByManager[r.managerId] = r;
  });

  if (matchups.length === 0) {
    lines.push('*No matchup data found for this week.*');
  } else {
    matchups.forEach(r => {
      const winner = r.result === 'W' ? mn(r.managerId)         : mn(r.opponentManagerId);
      const loser  = r.result === 'W' ? mn(r.opponentManagerId) : mn(r.managerId);
      const wScore = r.result === 'W' ? r.pointsFor    : r.pointsAgainst;
      const lScore = r.result === 'W' ? r.pointsAgainst : r.pointsFor;
      lines.push(`**${winner} (${fp(wScore)}) vs ${loser} (${fp(lScore)})**`);
    });
  }

  let computedStandings = null;
  let ppgByManager = {};
  let chugTally = {};
  if (allSeasonWeeklyResults) {
    computedStandings = buildStandingsThroughWeek(allSeasonWeeklyResults, year, week);
    computedStandings.forEach(rec => {
      const gp = rec.wins + rec.losses + rec.ties;
      ppgByManager[rec.managerId] = gp > 0 ? rec.pf / gp : null;
    });
  }
  if (playerResults && rosterToManagerId) {
    chugTally = computeChugTally(playerResults, year, week, rosterToManagerId);
  }

  if (playerResults) {
    const { top, bottom } = getWeekTopAndBottomPerformers(playerResults, year, week, allPlayersData, rosterToManagerId);
    if (top.length || bottom.length) {
      lines.push('');
      lines.push('### Notable Performances This Week');
      lines.push('*Each performance is tied to the manager who started that player — use these if they fit naturally into a game recap, not required for every game.*');
      lines.push('');
      if (top.length) {
        lines.push('**Went off:**');
        top.forEach(p => lines.push(`- ${p.name}${p.pos ? ` (${p.pos})` : ''}${p.managerId ? ` — started by ${mn(p.managerId)}` : ''} — ${fp(p.points)} pts`));
      }
      if (bottom.length) {
        lines.push('');
        lines.push('**🍺 Chug Alert (started, 0 or negative pts) — house rule: that manager owes a shotgun/chug before next week:**');
        bottom.forEach(p => lines.push(`- ${p.name}${p.pos ? ` (${p.pos})` : ''}${p.managerId ? ` — started by ${mn(p.managerId)}` : ''} — ${fp(p.points)} pts`));
      }
    }
  }

  const allWeekWaiverTx = (gradedTransactions||[]).filter(tx =>
    tx.type === 'waiver' &&
    !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year) &&
    tx.grade?.par != null
  );

  const weekWaiverCandidates = allWeekWaiverTx
    .map(tx => ({ tx, weekData: getWeekSpecificWaiverPAR(tx, week) }))
    .filter(({ weekData }) => weekData != null)
    .sort((a, b) => (b.weekData.weekPAR||0) - (a.weekData.weekPAR||0));

  if (weekWaiverCandidates.length > 0) {
    lines.push('');
    lines.push('## Best Waiver Pickups This Week (Top 3)');
    lines.push('*Ranked by points scored THIS WEEK above replacement level — not season-long value.*');
    lines.push('');

    const top3 = weekWaiverCandidates.slice(0, 3);
    top3.forEach(({ tx, weekData }, i) => {
      const g      = tx.grade;
      const mgr    = mn(tx.managerIds?.[0]);
      const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      const droppedInfo = g.droppedId ? allPlayersData?.[String(g.droppedId)] : null;
      const droppedPos  = droppedInfo?.position;
      const drop   = g.droppedName ? ` (dropped ${g.droppedName}${droppedPos ? `, ${droppedPos}` : ''})` : '';
      lines.push(`${medal} ${mgr} — +${g.name} (${g.position})${drop}`);
      lines.push(`   Week ${week}: ${fp(weekData.weekPts)} pts vs replacement rate ${fp(g.repPerWeek)} = ${signedFp(weekData.weekPAR)} PAR`);
      lines.push('');
    });

    const excludedCount = allWeekWaiverTx.length - weekWaiverCandidates.length;
    if (excludedCount > 0) {
      lines.push(`*${excludedCount} other waiver add(s) this week had no boxscore yet for the new roster (claimed too late to play) and were excluded from this ranking.*`);
      lines.push('');
    }
  } else if (allWeekWaiverTx.length > 0) {
    lines.push('');
    lines.push('## Best Waiver Pickups This Week');
    lines.push(`*${allWeekWaiverTx.length} waiver add(s) were made this week, but none have a graded performance yet for their new roster this week.*`);
  }

  const weekTrades = (gradedTransactions||[]).filter(tx =>
    tx.type === 'trade' &&
    !tx.isPartOfComposite &&
    !tx.isComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year)
  );
  if (weekTrades.length > 0) {
    lines.push('');
    lines.push('## Trades This Week');
    lines.push('*No formal PAR grade until end of season — season-to-date points shown per player so a preliminary reaction can be reasoned out.*');
    lines.push('');
    weekTrades.forEach(tx => {
      const received = extractTradeReceivedPlayers(tx, allPlayersData, playerResults, year, week);
      const rosterA = tx.rosters?.[0];
      const rosterB = tx.rosters?.[1];
      const mgrA = mn(tx.managerIds?.[0]);
      const mgrB = mn(tx.managerIds?.[1]);
      const itemsA = received[rosterA] || [];
      const itemsB = received[rosterB] || [];

      lines.push(`**${mgrA} sends ${tradeItemsPlain(itemsB)} to ${mgrB} in exchange for ${tradeItemsPlain(itemsA)}**`);
      lines.push(`- ${mgrA} receives: ${tradeItemsDetailed(itemsA)}`);
      lines.push(`- ${mgrB} receives: ${tradeItemsDetailed(itemsB)}`);
      lines.push('');
    });
  }

  lines.push('');
  lines.push(`## Standings Through Week ${week}`);
  lines.push('');
  lines.push('| Rank | Manager | W | L | PF | PA | 🍺 Chugs |');
  lines.push('|------|---------|---|---|----|----|----------|');

  if (computedStandings) {
    computedStandings.forEach((rec, idx) => {
      lines.push(`| #${idx+1} | ${mn(rec.managerId)} | ${rec.wins} | ${rec.losses} | ${fp(rec.pf)} | ${fp(rec.pa)} | ${chugTally[rec.managerId] || 0} |`);
    });
  } else {
    (currentStandings||[]).forEach((team, idx) => {
      const rs = team.regularSeason || {};
      lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} | — |`);
    });
  }

  if (powerRankings) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push('');
    const prevMap = {};
    (previousPowerRankings||[]).forEach(t => { prevMap[t.managerId] = t.rank; });
    const streaks = allSeasonWeeklyResults ? computeStreaks(allSeasonWeeklyResults, year, week) : {};
    lines.push('| Rank | Δ | Manager | Record | Streak | PPG | 🍺 Chugs |');
    lines.push('|------|---|---------|--------|--------|-----|----------|');
    powerRankings.rankings.forEach(team => {
      const prev   = prevMap[team.managerId];
      const mov    = prev != null ? prev - team.rank : null;
      const movStr = mov == null ? 'NEW' : mov > 0 ? `↑${mov}` : mov < 0 ? `↓${Math.abs(mov)}` : '—';
      const streak = streaks[team.managerId] || '—';
      const ppg    = ppgByManager[team.managerId];
      const chugs  = chugTally[team.managerId] || 0;
      lines.push(`| #${team.rank} | ${movStr} | ${mn(team.managerId)} | ${team.wins}-${team.losses} | ${streak} | ${ppg!=null?fp(ppg):'—'} | ${chugs} |`);
    });
  } else if (isTestMode) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push('*Not reconstructed for this test — Power Rankings for this season/week combination haven\'t been computed yet. Go to the Power Rankings tab, select this season, and click Compute Rankings, then regenerate the test bundle.*');
  }

  const nextWeek = week + 1;
  const resolvedNextWeekMatchups = nextWeekMatchups?.length
    ? nextWeekMatchups
    : (allSeasonWeeklyResults
        ? extractMatchupsForWeek(allSeasonWeeklyResults, year, nextWeek)
        : []);

  if (resolvedNextWeekMatchups.length > 0 && nextWeek <= 17) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${nextWeek})`);
    lines.push('*PPG is regular-season-to-date through this week. The odds shown alongside each PPG are a rough estimate from that PPG gap, American/moneyline format — for fun, not a real projection model. "Coming in" reflects each manager\'s result THIS week. Head-to-Head is all-time. Each matchup block below has a blank line between its title/Head-to-Head/Coming In lines on purpose — preserve those blank lines exactly, then add your own Storyline line after, also separated by a blank line.*');
    lines.push('');

    resolvedNextWeekMatchups.forEach(m => {
      const homeId   = m.homeId || m.home;
      const awayId   = m.awayId || m.away;
      const homeName = mn(homeId);
      const awayName = mn(awayId);
      const homePPG  = ppgByManager[homeId];
      const awayPPG  = ppgByManager[awayId];
      const odds     = computeMatchupOdds(homePPG, awayPPG);

      const homeOddsStr = odds ? formatAmericanOdds(odds.homeOdds) : null;
      const awayOddsStr = odds ? formatAmericanOdds(odds.awayOdds) : null;
      const homeLabel = homePPG != null
        ? `${fp(homePPG)} ppg${homeOddsStr ? `, ${homeOddsStr}` : ''}`
        : null;
      const awayLabel = awayPPG != null
        ? `${fp(awayPPG)} ppg${awayOddsStr ? `, ${awayOddsStr}` : ''}`
        : null;

      lines.push(`**${homeName}${homeLabel ? ` (${homeLabel})` : ''} vs. ${awayName}${awayLabel ? ` (${awayLabel})` : ''}**`);
      lines.push('');

      const h2h = allTimeWeeklyResults
        ? computeHeadToHead(allTimeWeeklyResults, homeId, awayId)
        : null;
      lines.push(`**Head-to-Head:** ${h2h ? formatH2HShort(h2h, homeName, awayName) : 'unknown'}`);
      lines.push('');

      const homeResult = describeResult(thisWeekByManager[homeId]);
      const awayResult = describeResult(thisWeekByManager[awayId]);
      const cominInBits = [];
      if (homeResult) cominInBits.push(`${homeName}: ${homeResult.tag} (${fp(homeResult.pointsFor)}-${fp(homeResult.pointsAgainst)})`);
      if (awayResult) cominInBits.push(`${awayName}: ${awayResult.tag} (${fp(awayResult.pointsFor)}-${fp(awayResult.pointsAgainst)})`);
      if (cominInBits.length) {
        lines.push(`**Coming In:** ${cominInBits.join(' | ')}`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    });
  } else if (nextWeek <= 14) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${nextWeek})`);
    lines.push('*Matchup data not available.*');
  }

  return lines.join('\n');
}

// ── Draft results export (for vibes-based Draft Grades article) ──────────────

/**
 * Dumps the actual draft board for one draft — every pick in order, grouped
 * by round, with manager/player/position/team. This is the ONLY data source
 * the Draft Grades prompt needs: no PAR, no season stats exist yet (the
 * draft just happened), so grading is necessarily vibes-based off real
 * picks + the model's own knowledge of ADP/expert consensus at draft time.
 */
export function exportDraftResults({ draft, managersSnapshot }) {
  const mn = (id) => mgrName(id, managersSnapshot);
  if (!draft || !draft.picks?.length) {
    return `# NLFL ${draft?.year || ''} Draft Results\n\n*No draft data available for this year.*`;
  }

  const lines = [];
  lines.push(`# NLFL ${draft.year} Draft Results`);
  lines.push('');
  lines.push(`${draft.numTeams}-team, ${draft.rounds}-round ${draft.draftType || 'snake'} draft.`);
  lines.push('*This is the complete, real draft board — no performance data exists yet since the season hasn\'t started. Grade using industry ADP/expert consensus knowledge for these specific players at the time of this draft.*');
  lines.push('');

  const byRound = {};
  draft.picks.forEach((p) => {
    if (!byRound[p.round]) byRound[p.round] = [];
    byRound[p.round].push(p);
  });

  Object.keys(byRound)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((round) => {
      lines.push(`## Round ${round}`);
      lines.push('');
      lines.push('| Pick | Manager | Player | Pos | Team |');
      lines.push('|------|---------|--------|-----|------|');
      byRound[round]
        .sort((a, b) => a.pickNo - b.pickNo)
        .forEach((p) => {
          lines.push(`| #${p.pickNo} | ${mn(p.managerId)} | ${p.playerName} | ${p.position || '—'} | ${p.team || '—'} |`);
        });
      lines.push('');
    });

  lines.push('## Full Roster By Manager (draft order)');
  lines.push('');
  const byManager = {};
  draft.picks.forEach((p) => {
    if (!byManager[p.managerId]) byManager[p.managerId] = [];
    byManager[p.managerId].push(p);
  });
  Object.entries(byManager).forEach(([mgrId, picks]) => {
    lines.push(`**${mn(mgrId)}**`);
    picks
      .sort((a, b) => a.pickNo - b.pickNo)
      .forEach((p) => {
        lines.push(`- R${p.round} (#${p.pickNo}): ${p.playerName} (${p.position || '—'}, ${p.team || '—'})`);
      });
    lines.push('');
  });

  return lines.join('\n');
}

// ── Vibes-grade calibration export ────────────────────────────────────────────

/**
 * Reports on how past vibes-based draft grades (issued right after each
 * draft) compared to that same draft's actual data-based end-of-season
 * grade. This is fed into the Draft Grades prompt as a bias check — not as
 * ground truth for grading the current draft, since this year's draft
 * genuinely has no performance data yet.
 */
export function exportDraftCalibration({ overallSummary, yearlyComparisons, managersSnapshot }) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const lines = [];
  lines.push('# Vibes-Grade Calibration History');
  lines.push('*Compares past pre-draft vibes-based grades (issued right after each draft) against that same draft\'s actual end-of-season data-based grade. Use this ONLY to calibrate how generous or harsh to be in general — it is NOT ground truth for grading THIS draft, and individual manager tendencies here should not be assumed to repeat.*');
  lines.push('');

  if (!overallSummary) {
    lines.push('*No calibration history yet — no past vibes grades have been recorded against end-of-season results.*');
    return lines.join('\n');
  }

  lines.push(`**Overall pattern (${overallSummary.totalDraftsCompared} team-drafts across ${overallSummary.yearsIncluded.join(', ')}):** ${overallSummary.bias}`);
  lines.push(`- Average bias: ${overallSummary.avgDelta > 0 ? '+' : ''}${overallSummary.avgDelta} GPA points (positive = grades issued at draft time run higher than how the draft actually performed; negative = run lower)`);
  lines.push(`- Average absolute error: ${overallSummary.avgAbsError} GPA points`);
  lines.push('');
  lines.push('## By Year');
  lines.push('');
  lines.push('| Year | Avg Bias | Avg Abs Error |');
  lines.push('|------|----------|----------------|');
  overallSummary.byYear.forEach((y) => {
    lines.push(`| ${y.year} | ${y.avgDelta > 0 ? '+' : ''}${y.avgDelta} | ${y.avgAbsError} |`);
  });

  (yearlyComparisons || []).filter(Boolean).forEach((cmp) => {
    lines.push('');
    lines.push(`### ${cmp.year} Detail`);
    lines.push('');
    lines.push('| Manager | Vibes Grade (at draft) | Actual EOS Grade | Bias |');
    lines.push('|---------|--------------------------|-------------------|------|');
    cmp.rows.forEach((r) => {
      lines.push(`| ${mn(r.managerId)} | ${r.vibesGrade} | ${r.eosGrade} | ${r.delta > 0 ? '+' : ''}${r.delta} (${r.label}) |`);
    });
  });

  return lines.join('\n');
}

export function exportPreDraftPackage({
  year, allTimeExport, latestSeasonExport, preSeasonRankings, managersSnapshot, draftCalibrationText
}) {
  const lines = [];

  lines.push(`# NLFL ${year} Pre-Draft Package`);
  lines.push(`*Everything needed for the ${year} pre-draft preview and post-draft grade articles.*`);
  lines.push('');
  lines.push('## IMPORTANT: How to Use This File');
  lines.push('- Pre-draft power rankings are **pre-computed** — do not recalculate');
  lines.push('- Formula: 60% all-time manager grade + 20% prior regular season + 20% prior post-season');
  lines.push('- **Letter grades only** — never use numeric scores in articles');
  lines.push('- Use real names and in-league history to personalize commentary');
  lines.push('');

  lines.push('## Pre-Draft Power Rankings');
  lines.push('');
  if (preSeasonRankings?.rankings?.length) {
    lines.push('| Rank | Manager | Overall | Draft | Trades | Waivers | Lineup IQ | Prior Reg | Prior Post |');
    lines.push('|------|---------|---------|-------|--------|---------|-----------|-----------|------------|');
    preSeasonRankings.rankings.forEach(team => {
      const regRank  = team.isFirstSeason ? '(new)' : team.prevRegRank  != null ? `#${team.prevRegRank}`  : '—';
      const postRank = team.isFirstSeason ? '(new)' : team.prevPostRank != null ? `#${team.prevPostRank}` : '—';
      lines.push([
        `#${team.rank}`, mgrName(team.managerId, managersSnapshot),
        toLetter(team.mgrGrade), toLetter(team.avgNormDraft),
        toLetter(team.avgNormTrade), toLetter(team.avgNormWaiver),
        toLetter(team.avgNormLineup), regRank, postRank
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    });
  } else {
    lines.push('*Compute Power Rankings for next season before exporting this file.*');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(latestSeasonExport || '*(Season stats not available)*');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(allTimeExport || '*(All-time history not available)*');

  if (draftCalibrationText) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(draftCalibrationText);
  }

  return lines.join('\n');
}

// ── Article prompts ───────────────────────────────────────────────────────────

export const PROMPTS = {

  preDraftRecap: `
You are writing the Pre-Draft Preview newsletter for the NLFL (National Liver Failure League).

VOICE: League commissioner writing to the group chat. You're one of the guys. You watched every game and you have opinions that are going to hurt feelings.

TONE EXAMPLES FROM ACTUAL NLFL ARTICLES:
- "3 years in, and Berra still can't beat me."
- "Newman's team sucks major ball sacks, how did you win 6 games?"
- "Better hope Ashton Jeanty turns into prime Adrian Peterson."
- "hey Newman, remember when you talked shit when I was 0-4, suck my nutz"
- "Is this the beginning of Alec's collapse that we've been waiting for all season long?"

RULES:
- REAL NAMES only — never Sleeper usernames
- LETTER GRADES ONLY — no numeric scores
- Storylines section = FORWARD-LOOKING only, no season recap repeats
- Pre-draft power rankings table = copy exactly as given, never recalculate
- Use in-league history (rivalries, prior seasons, past feuds) to make roasts personal
- CRITICAL — verify historical claims: any claim about a manager's placement, grade, or record in a specific past season MUST be checked against the "Final Placement by Season" and "Manager Grades by Season" tables in all_time_history.md. Never state a manager repeated an outcome across multiple years (e.g. "runner-up two years running", "third straight losing season") unless those tables confirm it for EACH year individually. If you're not sure, don't make the multi-year claim — describe just the most recent season instead.

STRUCTURE:

**Opening** (3-4 sentences — immediate gut punch, reference something embarrassing)

**Season Recap** (~250 words) — champion, last place, Draft Order Bowl, 3-4 stat-backed moments

**All-Time Superlatives** — pull directly from the "All-Time Superlatives (Pre-computed)" data in all_time_history.md, don't recompute or guess any of them. Only current league members are eligible for these — don't second-guess it or wonder aloud why a departed manager isn't listed. One sentence of trash talk/context per superlative.

**Hall of Fame — Champions By Year** — use the "Hall of Fame — Champions By Year" list from the data directly, one bullet per year as given (this includes every champion in league history, even managers who've since left the league). A short punchy aside per year is fine, but don't invent details not in the data.

**Hall of Shame — Regular Season Losers By Year** — use the "Hall of Shame — Regular Season Last Place By Year" list from the data directly, one bullet per year as given. A short punchy aside per year is fine, but don't invent details not in the data.**Storylines Heading Into the Draft** — 3-4 forward-looking items only

**Pre-Draft Power Rankings** — copy the table exactly as given. Then, for EACH manager, write 2-4 sentences of forward-looking narrative commentary. Do NOT just restate their letter grades from the table — that's boring and it's already right there. Instead, use the "Manager Grades by Season" and "Final Placement by Season" tables in the data to find and describe real patterns across their years (boom-bust cycles, a specific great or disastrous season, a consistent strength or weakness, an "every other year" pattern, etc.), and end with a specific forward-looking question or expectation for this draft/season. Grades can be mentioned in passing if it helps, but they should never be the core of what you're saying — the pattern and the narrative are the point. For example, instead of "Haskin (#1) — Defending champ, best all-time trader, F on waivers and still nobody can touch him. Terrifying," write something like "Haskin (#1) — The defending champ and the best all-time trader in the league. He's generationally awful at waivers, but that didn't stop a dominant run last season. Year 1 and 3 were stellar, but Year 2 was a catastrophic collapse to a 9th place finish. Can Haskin defend his title, or does the every-other-year pattern catch up with him?"
`.trim(),

draftGrades: `
You are grading the just-completed NLFL draft, using the draft board provided (current_draft.md) plus league history for context.

VOICE: Commissioner with opinions. You watched every pick. You are not being diplomatic.

CRITICAL CONTEXT: No season has been played yet — there is no PAR or performance data for this draft. This grade is 100% vibes-based: your own knowledge of where these specific players were being drafted around the league (ADP) and what experts/rankings thought of them at the time, compared to where each manager actually took them. Do not pretend this is data-driven. Reaches = took a player notably earlier than typical ADP or grabbed a player with real red flags experts were down on. Steals = took a player notably later than typical ADP.

If a "Vibes-Grade Calibration History" section is present in the data, silently use its overall bias finding to adjust your grading instinct this year (e.g. if the pattern shows grades historically run too generous, be tougher; if too harsh, ease up). Never mention the calibration data, its existence, or its mechanics anywhere in the article — it's an internal input, not narrative content.

RULES:
- REAL NAMES only
- LETTER GRADES ONLY, and use the FULL range with +/- (A+ through F) — spread managers across the scale based on genuine differences in their draft. Do NOT cluster everyone into B/B-/C+. If a draft was genuinely mediocre across the board, still differentiate — someone has the best team, someone has the most question marks, grade accordingly.
- Every manager's grade must be justified by at least one SPECIFIC pick (round + player), not just vibes about "their team." Cite good picks AND bad/risky picks — most managers should have both.
- Reference prior draft grades / manager tendencies from all_time_history.md when it adds color (e.g. "same guy who reached for a QB in round 3 last year")
- Keep the personality in the stats and history, not background details

FOR EACH MANAGER (in draft order or grade order, your call): grade + 2-3 sentences citing specific picks by round + one season prediction

FINISH WITH:
- 🏆 Best Draft — specific team, with the 2-3 picks that make the case
- 💀 Worst Draft — specific team, with the pick(s) that doomed them
- 💎 Sleeper Pick of the Draft — one specific late-round pick you'd bet on
- 🎯 Reach of the Draft — one specific pick taken well ahead of ADP
`.trim(),

  weeklyRecap: `
You are writing the NLFL weekly recap newsletter.

VOICE: Commissioner to the group chat. You watched every game. You have no filter.

RULES:
- REAL NAMES throughout
- Profanity is expected and encouraged
- Reference specific players who went off or completely shit the bed
- A "Notable Performances This Week" list is provided in the data (top scorers + starters who bombed), each one already tied to the manager who started them — pull from it when a game recap calls for it, but don't force it into every game
- Any player in the "🍺 Chug Alert" list means that manager owes a shotgun/chug before next week per house rules — call this out explicitly by name and mock them for it. The standings and power rankings tables also carry a running season Chug tally per manager — reference it when it's funny
- Do NOT reference all-time head-to-head history in the Game Recaps — that only belongs in the Next Week Preview section. If a game recap wants a stat, pull from this week or this season's data (standings, streaks, PPG)
- NEVER mention how Power Rankings are calculated (weights, phase, formulas) anywhere in the article — that's internal-only, not narrative content
- If rivalry week: call out bet stakes, talk shit about whoever lost
- Keep it punchy — short sentences, no filler
- **Formatting**: bold is ONLY for section headers/subheaders, each game's header line (given to you pre-built in the data), trade header lines, and the matchup title + labels in the Next Week Preview (Head-to-Head:, Coming In:, Storyline:). Never bold a player name, manager name, score, or stat inside a sentence — plain text throughout the prose. Never use HTML tags like <u> — they don't render reliably.
- CRITICAL: wherever the data hands you multiple pre-built bolded lines meant to stack (game headers, matchup preview blocks), reproduce them EXACTLY as given, each on its own line, WITH the blank lines between them preserved. Do not run them together into one paragraph — that has been a recurring bug, be careful here.

STRUCTURE:

**Opening** (2-3 sentences — something filthy, absurd, or painful from the week. Set the tone immediately.)

**Game Recaps**
The data gives you a pre-built bolded header line for every matchup, in the exact format "**Manager A (Score) vs Manager B (Score)**" (no colon) — under the "Week X Matchup Results" section. Use that line EXACTLY as given, verbatim, as the header for that game's section, on its own line. Then write 3-5 sentences of plain prose below it (no bold in the paragraph itself). Requirements:
- Name the losing manager and explain specifically why their team is an embarrassment
- Reference specific players who won or lost the game — pull from "Notable Performances This Week" when it fits a specific game, and always call out any Chug Alert players by name
- Weave in each manager's current Power Ranking context where it fits naturally — their rank, movement, streak, PPG, and season chug count (never the methodology behind the ranking). This replaces any separate per-team Power Rankings summary; don't write that summary anywhere else in the article
- If someone lost by a large margin: rub it in (describe it as a blowout, no need to state a margin number)
- If someone won ugly: acknowledge it but find something to still clown them for
- Make it feel like you're reading this in a group chat and losing your mind
- Examples of the right register:
  * "A blowout like that isn't a loss, it's a hate crime. Manager's team just stood there and watched."
  * "Player put up 38 points and Manager still found a way to lose. Incredible."
  * "Manager won but their team looked like ass doing it — enjoy the W because it won't last."
  * "How do you start one guy and not the other and then wonder why you lost? Lineup IQ of a golden retriever."
  * "Player laid a straight-up egg and Manager owes the group a chug for it. No exceptions."

**Trades This Week**
Only include this section if trade data is present in the data file — if there's no "Trades This Week" section in the data, skip this section entirely in the article, don't write "no trades happened."

Format EVERY trade using this exact minimalist layout — follow it precisely, it's non-negotiable:

1. Header line, one per team involved in the trade, formatted EXACTLY like this (grade goes right after the colon, then a pipe, then Acquired/Sent):
**[Manager Name]: [Grade]** | Acquired: [Player Name] ([Position]) / Sent: [Player Name] ([Position])
If a side received or sent more than one asset, separate them with commas within the same Acquired/Sent list (e.g. "Acquired: Player A (RB), Player B (WR)").

2. Directly below that manager's header line, write ONE analysis paragraph for that manager — plain prose, no bullet points, no blockquotes, no bold inside the paragraph. Base the reasoning on the season-to-date points and roster context given in the data (this is a preliminary, vibes-based reaction, not a final verdict — but don't write out a disclaimer phrase like "way too early to know" every time, the grade in the header already signals that).

3. Repeat step 1-2 for the other manager in the same trade, directly below the first manager's paragraph — no blank section between the two, just header-paragraph-header-paragraph.

4. If there is more than one trade this week, separate each complete trade (both managers' header+paragraph pairs) with a markdown horizontal rule (---) on its own line, with a blank line above and below it.

**Best Waiver Pickups This Week**
Use the top 3 pickups from the data, in rank order. For each one:
- Lead with the medal emoji, manager name, and player picked up, plain text, no bold — e.g. "🥇 Berra — Kenny Gainwell (RB), dropped Will Shipley (RB)"
- Underneath, write 1-2 sentences of plain prose explaining why the move matters — reference the week's PAR in plain language (no bold on the number)
- The #1 pickup gets the most love/hate depending on the grade

**Power Rankings**
Copy the table exactly as given — Rank, movement, Manager, Record, Streak, PPG, and season Chug count. Do NOT write a separate sentence-per-team summary underneath the table, and do NOT mention how the rankings are calculated — that context belongs woven into the Game Recap paragraphs instead.

**Next Week Preview**
For EACH matchup, the data gives you a pre-built block with blank lines already inserted between the title, Head-to-Head, and Coming In lines (PPG and odds are already embedded in the title's parentheses). Reproduce that block EXACTLY as given — same three lines, same order, same blank lines between them, do not reformat, reword, or move the odds. Then add one more line, separated from Coming In by a blank line:

**Storyline:** one forward-looking, trash-talky question or angle about the matchup — this one's yours to invent, it's not in the data

Leave a blank line after Storyline before the next matchup's block begins. Nothing else goes inside a matchup's block — no extra commentary outside these four bolded lines.
`.trim(),

  endOfSeasonRecap: `
You are writing the NLFL End of Season Recap — the permanent record.

VOICE: Commissioner with a full season of receipts. Real names, real grades, real savagery.

RULES:
- REAL NAMES only
- LETTER GRADES ONLY
- Back every claim with specific numbers
- Bowl names/rewards, the regular season loser's punishment, and Rivalry Week results are league canon — pull them from the data exactly, never invent your own. Names are already substituted into the reward/bet text in the data (e.g. "Newman gets $1000..." not "Winner gets $1000...") — reproduce that phrasing, don't revert to generic role-words
- **Bulleted data sections (Season Outcomes, Rivalry Week Results) MUST stay as separate bullet points — each its own line, with its icon and bold label, exactly as given in the data. Do NOT merge them into a flowing paragraph. This has happened before; be deliberate about preserving the bullet structure.**
- CRITICAL — avoid repetition: this article has dedicated sections for outcomes, trades, waivers, draft, and awards. Once a specific fact (a stat, a result, a specific player/trade/pickup) has its own section below, don't also plant it earlier in vaguer form. Say each specific thing ONCE, in its proper section.

STRUCTURE:

**Season Narrative** (~150 words) — big-picture arc and tone ONLY: was it a runaway, a dogfight, a rebuild, total chaos? Describe turning points in general narrative terms (e.g. "everything changed around week 8") WITHOUT naming the specific champion, bowl winners, specific trades, specific waiver pickups, or specific award winners — all of those get their own sections below, and naming them here is redundant. Think "previously on..." teaser, not the full recap.

**Final Outcomes** — reproduce each line from the data's "Season Outcomes" section AS ITS OWN BULLET POINT (icon + bold label, exactly as given — the names are already substituted into the reward text for you): the championship winner, the runner-up, every bowl winner (3rd/5th/7th/9th/11th), and the regular season's last place team (the actual loser of the league) with their record and PPG. For the last place bullet specifically, you can extend it with a sentence or two of mockery immediately after — but keep it anchored to that one bullet, don't turn the whole section into a paragraph.

**Rivalry Week Results** — reproduce each line from the "Rivalry Week Results" section AS ITS OWN BULLET POINT — the bet text already has the actual winner/loser names substituted in (e.g. "Mendez has to buy and wear Alec's jersey..."), just reproduce it as-is per pair. Don't guess at winners yourself — if the data flags a pair as unresolved, just note the stakes without declaring a winner.

**Most Lopsided Trades** — use the "Most Lopsided Trades This Season" list from the data directly. For each, name both sides, what they gave up, and who clearly won the trade and by how much (PAR gap)

**Top Waiver Pickups (Season)** — use the "Top Waiver Pickups This Season" list from the data. Call out the #1 pickup specifically and explain the season-long impact in plain language

**Draft Report Card** — use the league-wide "Top Draft Steals" and "Biggest Draft Busts" data for standout call-outs. Don't restate every single manager's individual best/worst pick here — that's covered in the Manager Season Recap Cards table below, this section is for the league-wide extremes only.

**Season Awards** — pull these directly from the "Season Superlatives (Pre-computed)" data, don't recompute or guess. Best Manager specifically is the manager with the highest overall Manager Grade for the season, given to you directly in the data — do not infer or recalculate it yourself:
🏆 Best Manager (data-backed — can win and still have a mediocre grade, call that out)
📈 Most Improved
🧠 Lineup Genius (best IQ — the one guy who actually watched his team)
🤝 Trade Shark (best trader all season)
🐟 Sold For Parts (worst trader all season)
🎣 Waiver Wire Wizard (best waiver manager all season)
🗑️ Waiver Wire Whiff (worst waiver manager all season)
🍺 Chug King (most cumulative chugs on the season)
🤡 Annual Clown Award (worst grades + most embarrassing moment — specific evidence required, be mean)
🎯 Best Single Transaction

**Manager Season Recap Cards** — reproduce the "Manager Season Recap Cards" table from the data EXACTLY as given, including all five grade columns (Overall, Draft, Trade, Waiver, Lineup IQ) and the Record (Expected) column showing each manager's actual record against what their record "should" have been. Add at most one dry, one-line caption above the table — no per-row commentary or narration. This section is a scannable per-manager reference, not additional storytelling.
`.trim()

};
