// dataExport.js

import { getRealName, getSeasonRivalries } from '$lib/utils/leagueManagers.js';

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

/**
 * Builds a plain list of manager names — no bios. Bios were removed from
 * article context on purpose (they got referenced too often and went stale);
 * if you want them back later, reintroduce a call into leagueManagers.js here.
 */
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
 * Always accurate regardless of whether the season is complete.
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
 * Regular season only (no playoffs) — what they actually owe each other.
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
 * Formats a H2H record as: "Manager A vs Manager B: Manager A Leads the
 * series 2-0 All Time" (or "Series Tied X-X All Time" / "First ever matchup").
 * The record shown is always relative to whichever manager is leading.
 */
function formatH2H(h2h, managerAName, managerBName) {
  if (!h2h || h2h.gamesPlayed === 0) {
    return `${managerAName} vs ${managerBName}: First ever matchup`;
  }
  if (h2h.wins > h2h.losses) {
    const recStr = `${h2h.wins}-${h2h.losses}${h2h.ties > 0 ? `-${h2h.ties}` : ''}`;
    return `${managerAName} vs ${managerBName}: ${managerAName} Leads the series ${recStr} All Time`;
  }
  if (h2h.losses > h2h.wins) {
    const recStr = `${h2h.losses}-${h2h.wins}${h2h.ties > 0 ? `-${h2h.ties}` : ''}`;
    return `${managerAName} vs ${managerBName}: ${managerBName} Leads the series ${recStr} All Time`;
  }
  const recStr = `${h2h.wins}-${h2h.losses}${h2h.ties > 0 ? `-${h2h.ties}` : ''}`;
  return `${managerAName} vs ${managerBName}: Series Tied ${recStr} All Time`;
}

/**
 * Pulls a waiver pickup's PAR for one specific week out of the week-by-week
 * breakdown parGrading.js already computes (tx.grade.weekBreakdown). This is
 * what "Best Waiver Pickups This Week" ranks by — how much value that player
 * provided THAT WEEK — instead of full-season PAR from the pickup date
 * onward, which would let one early-season pickup dominate every week.
 */
function getWeekSpecificWaiverPAR(tx, week) {
  const wb = tx.grade?.weekBreakdown;
  if (!Array.isArray(wb) || wb.length === 0) {
    return { weekPAR: tx.grade?.par ?? null, weekPts: null, isFallback: true };
  }
  const entry = wb.find(w => Number(w.week) === Number(week));
  if (!entry) {
    return { weekPAR: tx.grade?.par ?? null, weekPts: null, isFallback: true };
  }
  return { weekPAR: entry.weekPAR, weekPts: entry.playerPts, isFallback: false };
}

/**
 * League-wide standout performances for a given week, for the "Notable
 * Performances" callout in game recaps. Uses the explicit isStarter flag
 * (not pointsStarted, which collapses "benched" and "started but scored 0"
 * into the same value) so a real zero or negative week from a starter shows
 * up correctly.
 */
function getWeekTopAndBottomPerformers(playerResults, year, week, allPlayersData, limit = 3) {
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
      return { name, pos, points: pts };
    })
    .filter(p => typeof p.points === 'number' && !isNaN(p.points));

  const sorted = [...withInfo].sort((a, b) => b.points - a.points);
  const top    = sorted.slice(0, limit);
  const bottom = sorted
    .filter(p => p.points <= 3)
    .sort((a, b) => a.points - b.points)
    .slice(0, limit);

  return { top, bottom };
}

function deriveSeasonOutcomes(standings, weeklyResults, snap) {
  if (!standings || standings.length === 0) return null;
  const mn     = (id) => mgrName(id, snap);
  const sorted = [...standings].sort((a, b) => (a.finalPlacement || 99) - (b.finalPlacement || 99));

  const champion           = sorted.find(t => t.finalPlacement === 1);
  const runnerUp           = sorted.find(t => t.finalPlacement === 2);
  const thirdPlace         = sorted.find(t => t.finalPlacement === 3);
  const loserBracketWinner = sorted.find(t => t.finalPlacement === 7);

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
      regularSeasonLoser = {
        managerId: mgrId, displayName: mn(mgrId),
        wins: rec.wins, losses: rec.losses, ties: rec.ties, pf: rec.pf
      };
    }
  });

  return {
    champion:           champion    ? { managerId: champion.managerId,    displayName: mn(champion.managerId)    } : null,
    runnerUp:           runnerUp    ? { managerId: runnerUp.managerId,    displayName: mn(runnerUp.managerId)    } : null,
    thirdPlace:         thirdPlace  ? { managerId: thirdPlace.managerId,  displayName: mn(thirdPlace.managerId)  } : null,
    loserBracketWinner: loserBracketWinner
      ? { managerId: loserBracketWinner.managerId, displayName: mn(loserBracketWinner.managerId) }
      : null,
    regularSeasonLoser
  };
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
  lines.push('- Playoffs: weeks 15-17, top 6 teams by record/points');
  lines.push('- **Champion**: wins the playoff bracket');
  lines.push('- **Last Place Award**: worst record/points through week 14');
  lines.push('- **Draft Order Bowl**: bottom 6 teams; winner sets next season\'s draft order');
  lines.push('- **Rivalry Week**: each manager has a designated rival set at the draft; results carry extra bragging rights and a bet is placed between rivals');
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
  lines.push('- Do NOT use manager bios or personal background details — they\'re not part of this context anymore. Stick to real names, in-league history, and stats.');
  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR**: Points Above Replacement — how much a player/pickup/trade exceeded a freely available alternative');
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round');
  lines.push('- **Lineup IQ**: actual pts scored ÷ maximum possible pts. Higher = better lineup decisions');
  lines.push('- **SOS**: Strength of Schedule — avg opponent scoring and win % faced');
  lines.push('- **Luck**: actual win% minus expected win% based on weekly score vs all other scores');
  lines.push('- **Manager Grade**: Draft 40% + Trades 20% + Waivers 20% + Lineup IQ 20%. C = league average');
  lines.push('');
  lines.push(buildSimpleManagerList(managersSnapshot));
  return lines.join('\n');
}

// ── Season stats export ───────────────────────────────────────────────────────

export function exportSeasonStats({
  year, standings, weeklyResults, seasonManagerGrades, seasonSOS,
  draftEndOfSeasonGrade, managerTradePAR, managerWaiverPAR,
  managerLineupIQ, rosterStats, managersSnapshot
}) {
  const mn      = (id) => mgrName(id, managersSnapshot);
  const lines   = [];
  const outcomes = deriveSeasonOutcomes(standings, weeklyResults, managersSnapshot);

  lines.push(`# NLFL ${year} Season — Full Data`);
  lines.push('');
  lines.push('## Season Outcomes');
  lines.push('*Derived from final placements and regular-season records. Use as ground truth.*');
  lines.push('');
  if (outcomes?.champion)
    lines.push(`- 🏆 **Champion**: ${outcomes.champion.displayName}`);
  else
    lines.push('- 🏆 **Champion**: Not yet determined');
  if (outcomes?.runnerUp)
    lines.push(`- 🥈 **Runner-Up**: ${outcomes.runnerUp.displayName}`);
  if (outcomes?.thirdPlace)
    lines.push(`- 🥉 **Third Place**: ${outcomes.thirdPlace.displayName}`);
  if (outcomes?.regularSeasonLoser) {
    const l = outcomes.regularSeasonLoser;
    lines.push(`- 💀 **Regular Season Last Place**: ${l.displayName} (${l.wins}-${l.losses}${l.ties > 0 ? `-${l.ties}` : ''}, ${fp(l.pf)} pts)`);
  }
  if (outcomes?.loserBracketWinner)
    lines.push(`- 🎯 **Draft Order Bowl Winner**: ${outcomes.loserBracketWinner.displayName}`);
  else
    lines.push('- 🎯 **Draft Order Bowl Winner**: Not available in data');

  const rivalries = getSeasonRivalries(year, managersSnapshot);
  if (rivalries.length > 0) {
    lines.push('');
    lines.push('## Rivalry Week Stakes');
    lines.push('');
    rivalries.forEach(r => {
      lines.push(`- **${r.managerA} vs ${r.managerB}**: ${r.bet}`);
    });
  }

  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('');
  lines.push('| Reg Rank | Manager | W | L | T | PF | PA | Diff | Made Playoffs? |');
  lines.push('|----------|---------|---|---|---|----|----|------|----------------|');

  const sortedByRegSeason = [...(standings || [])].sort((a, b) => {
    const wa = a.regularSeason?.wins || 0;
    const wb = b.regularSeason?.wins || 0;
    if (wb !== wa) return wb - wa;
    return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
  });

  sortedByRegSeason.forEach((team, idx) => {
    const rs   = team.regularSeason || {};
    const diff = (rs.fptsFor || 0) - (rs.fptsAgainst || 0);
    const made = (team.finalPlacement || 99) <= 6
      ? `✓ Playoffs (seed #${idx + 1})`
      : 'Loser Bowl';
    lines.push(`| #${idx+1} | **${mn(team.managerId)}** | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} | ${signedFp(diff)} | ${made} |`);
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
      const note = team.finalPlacement === 1  ? '🏆 Champion'
                 : team.finalPlacement === 2  ? '🥈 Runner-Up'
                 : team.finalPlacement === 3  ? '🥉 Third Place'
                 : team.finalPlacement === 7  ? '🎯 Draft Order Bowl Winner'
                 : team.finalPlacement === 12 ? '💀 Last Place'
                 : '';
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

  if (seasonSOS) {
    lines.push('');
    lines.push('## Strength of Schedule');
    lines.push('');
    lines.push('| Manager | Avg Opp Pts | Avg Opp Win% | Luck | Label |');
    lines.push('|---------|-------------|--------------|------|-------|');
    Object.entries(seasonSOS)
      .sort(([,a],[,b]) => b.avgOpponentPts - a.avgOpponentPts)
      .forEach(([id, data]) => {
        lines.push(`| ${mn(id)} | ${fp(data.avgOpponentPts)} | ${data.avgOpponentWinPct!=null?pct(data.avgOpponentWinPct):'—'} | ${data.luck!=null?signedFp(data.luck*100,1)+'%':'—'} | ${data.luckLabel||'—'} |`);
      });
  }

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

  return lines.join('\n');
}

// ── All-time history export ───────────────────────────────────────────────────

export function exportAllTimeHistory({
  allTimeManagerGrades, allTimeSOS, seasonManagerGrades, seasonSOSByYear,
  allDrafts, draftGradesByYear, managerTradePARBySeason, managerWaiverPARBySeason,
  managers, managersSnapshot
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
 * @param {Array}   allSeasonWeeklyResults   All game results for this season (for standings + next week extraction)
 * @param {Array}   allTimeWeeklyResults     All game results across ALL seasons (for H2H records)
 * @param {Array}   playerResults            Per-player-per-week stat lines: { year, week, rosterId, playerId, pointsTotal, pointsStarted, isStarter } — used for week-specific waiver PAR and notable performances
 * @param {Object}  allPlayersData           Sleeper player_id -> player info map — used to resolve names for notable performances
 * @param {boolean} isTestMode               Adds PAR disclaimer in test mode
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
  allPlayersData
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# NLFL ${year} — Week ${week} Data`);
  lines.push('');

  // ── Test mode disclaimer ────────────────────────────────────────────────────
  if (isTestMode) {
    lines.push('> **⚠ TEST MODE — HISTORICAL DATA**');
    lines.push(`> Simulates a Week ${week} export from the ${year} season.`);
    lines.push('> ');
    lines.push('> **Accurate**: matchup results, waiver moves, standings through this week, next week matchups, H2H records, week-specific waiver PAR, notable performances.');
    lines.push('');
  }

  // ── Matchup results ─────────────────────────────────────────────────────────
  lines.push(`## Week ${week} Matchup Results`);
  lines.push('');

  const seen = new Set();
  const matchups = [];
  (weeklyResults||[]).filter(r => !r.isPlayoffs).forEach(r => {
    const key = [r.managerId, r.opponentManagerId].sort().join('-');
    if (!seen.has(key)) { seen.add(key); matchups.push(r); }
  });

  if (matchups.length === 0) {
    lines.push('*No matchup data found for this week.*');
  } else {
    matchups.forEach(r => {
      const winner   = r.result === 'W' ? mn(r.managerId)         : mn(r.opponentManagerId);
      const loser    = r.result === 'W' ? mn(r.opponentManagerId) : mn(r.managerId);
      const winnerId = r.result === 'W' ? r.managerId             : r.opponentManagerId;
      const loserId  = r.result === 'W' ? r.opponentManagerId     : r.managerId;
      const wScore   = r.result === 'W' ? r.pointsFor    : r.pointsAgainst;
      const lScore   = r.result === 'W' ? r.pointsAgainst : r.pointsFor;
      const margin   = Math.abs(wScore - lScore);

      // Include H2H if available
      const h2h = allTimeWeeklyResults
        ? computeHeadToHead(allTimeWeeklyResults, winnerId, loserId)
        : null;
      const h2hStr = h2h && h2h.gamesPlayed > 0
        ? ` | ${formatH2H(h2h, winner, loser)}`
        : '';

      lines.push(`- **${winner} ${fp(wScore)}** def. ${loser} ${fp(lScore)} (margin: ${fp(margin)}${h2hStr})`);
    });
  }

  // ── Notable performances this week ─────────────────────────────────────────
  // League-wide standouts, not pre-attributed to a specific manager — the
  // recap writer already has manager/roster context to slot these into the
  // right game if it's a good fit. Not every game needs one.
  if (playerResults) {
    const { top, bottom } = getWeekTopAndBottomPerformers(playerResults, year, week, allPlayersData);
    if (top.length || bottom.length) {
      lines.push('');
      lines.push('### Notable Performances This Week');
      lines.push('*Use these if they fit naturally into a game recap — not required for every game.*');
      lines.push('');
      if (top.length) {
        lines.push('**Went off:**');
        top.forEach(p => lines.push(`- ${p.name}${p.pos ? ` (${p.pos})` : ''} — ${fp(p.points)} pts`));
      }
      if (bottom.length) {
        lines.push('');
        lines.push('**Laid an egg (started, 3 pts or fewer):**');
        bottom.forEach(p => lines.push(`- ${p.name}${p.pos ? ` (${p.pos})` : ''} — ${fp(p.points)} pts`));
      }
    }
  }

  // ── Waiver moves — top 3 pickups from this week ───────────────────────────
  // Ranked by WEEK-SPECIFIC PAR (points scored the week they were added, above
  // that pickup's replacement rate for that week), pulled from parGrading.js's
  // weekBreakdown — not the full-season hold-period PAR. This is what makes
  // this section actually change week to week instead of a single early
  // pickup dominating every week it shows up in.
  const weekWaiverCandidates = (gradedTransactions||[]).filter(tx =>
    tx.type === 'waiver' &&
    !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year) &&
    tx.grade?.par != null
  ).map(tx => {
    const { weekPAR, weekPts, isFallback } = getWeekSpecificWaiverPAR(tx, week);
    return { tx, weekPAR: weekPAR ?? tx.grade.par, weekPts, isFallback };
  }).sort((a, b) => (b.weekPAR||0) - (a.weekPAR||0));

  if (weekWaiverCandidates.length > 0) {
    lines.push('');
    lines.push('## Best Waiver Pickups This Week (Top 3)');
    lines.push('*Ranked by points scored THIS WEEK above replacement level — not season-long value.*');
    lines.push('');

    const top3 = weekWaiverCandidates.slice(0, 3);
    top3.forEach(({ tx, weekPAR, weekPts, isFallback }, i) => {
      const g      = tx.grade;
      const mgr    = mn(tx.managerIds?.[0]);
      const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      const drop   = g.droppedName ? ` (dropped ${g.droppedName})` : '';
      lines.push(`${medal} **${mgr}** — +${g.name} (${g.position})${drop}`);
      if (isFallback) {
        lines.push(`   Week ${week} PAR: ${signedFp(weekPAR)} vs replacement ${g.repName} *(week-specific data unavailable — showing full hold-period PAR)*`);
      } else {
        lines.push(`   Week ${week}: ${fp(weekPts)} pts vs replacement rate ${fp(g.repPerWeek)} = ${signedFp(weekPAR)} PAR`);
      }
      lines.push('');
    });
  }

  // ── Trades ───────────────────────────────────────────────────────────────────
  const weekTrades = (gradedTransactions||[]).filter(tx =>
    tx.type === 'trade' &&
    !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year)
  );
  if (weekTrades.length > 0) {
    lines.push('');
    lines.push('## Trades This Week');
    lines.push('*(Grades not available until end of season)*');
    lines.push('');
    weekTrades.forEach(tx => {
      lines.push(`- **${mn(tx.managerIds?.[0])} ↔ ${mn(tx.managerIds?.[1])}**`);
    });
  }

  // ── Standings — computed from game results through this week ─────────────────
  lines.push('');
  lines.push(`## Standings Through Week ${week}`);
  lines.push('');
  lines.push('| Rank | Manager | W | L | PF | PA |');
  lines.push('|------|---------|---|---|----|----|');

  if (allSeasonWeeklyResults) {
    const computed = buildStandingsThroughWeek(allSeasonWeeklyResults, year, week);
    computed.forEach((rec, idx) => {
      lines.push(`| #${idx+1} | ${mn(rec.managerId)} | ${rec.wins} | ${rec.losses} | ${fp(rec.pf)} | ${fp(rec.pa)} |`);
    });
  } else {
    (currentStandings||[]).forEach((team, idx) => {
      const rs = team.regularSeason || {};
      lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} |`);
    });
  }

  // ── Power rankings ────────────────────────────────────────────────────────────
  if (powerRankings) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push(`*Phase: ${powerRankings.phase} | Record ${(powerRankings.weights.record*100).toFixed(0)}% / Pts ${(powerRankings.weights.points*100).toFixed(0)}% / Form ${(powerRankings.weights.recentForm*100).toFixed(0)}% / Mgr Grade ${(powerRankings.weights.managerGrade*100).toFixed(0)}%*`);
    lines.push('');
    const prevMap = {};
    (previousPowerRankings||[]).forEach(t => { prevMap[t.managerId] = t.rank; });
    const streaks = allSeasonWeeklyResults ? computeStreaks(allSeasonWeeklyResults, year, week) : {};
    lines.push('| Rank | Δ | Manager | Record | Streak | PF | Score |');
    lines.push('|------|---|---------|--------|--------|----|-------|');
    powerRankings.rankings.forEach(team => {
      const prev   = prevMap[team.managerId];
      const mov    = prev != null ? prev - team.rank : null;
      const movStr = mov == null ? 'NEW'
                    : mov > 0     ? `↑${mov} (was #${prev})`
                    : mov < 0     ? `↓${Math.abs(mov)} (was #${prev})`
                    : `— (was #${prev})`;
      const streak = streaks[team.managerId] || '—';
      lines.push(`| #${team.rank} | ${movStr} | ${mn(team.managerId)} | ${team.wins}-${team.losses} | ${streak} | ${fp(team.pf)} | ${fp(team.compositeScore)} |`);
    });
  } else if (isTestMode) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push('*Not reconstructed in test mode.*');
  }

  // ── Next week matchups with H2H records ───────────────────────────────────────
  const nextWeek = week + 1;
  const resolvedNextWeekMatchups = nextWeekMatchups?.length
    ? nextWeekMatchups
    : (allSeasonWeeklyResults
        ? extractMatchupsForWeek(allSeasonWeeklyResults, year, nextWeek)
        : []);

  if (resolvedNextWeekMatchups.length > 0 && nextWeek <= 17) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${nextWeek})`);
    lines.push('');

    resolvedNextWeekMatchups.forEach(m => {
      const homeId   = m.homeId || m.home;
      const awayId   = m.awayId || m.away;
      const homeName = mn(homeId);
      const awayName = mn(awayId);

      const h2h = allTimeWeeklyResults
        ? computeHeadToHead(allTimeWeeklyResults, homeId, awayId)
        : null;
      const h2hLabel = h2h ? formatH2H(h2h, homeName, awayName) : `${homeName} vs ${awayName}`;
      const gamesNote = h2h && h2h.gamesPlayed > 0 ? ` (${h2h.gamesPlayed} all-time meetings)` : '';

      lines.push(`- ${h2hLabel}${gamesNote}`);
    });
  } else if (nextWeek <= 14) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${nextWeek})`);
    lines.push('*Matchup data not available.*');
  }

  return lines.join('\n');
}

// ── Pre-draft package ─────────────────────────────────────────────────────────

export function exportPreDraftPackage({
  year, allTimeExport, latestSeasonExport, preSeasonRankings, managersSnapshot
}) {
  const lines = [];

  lines.push(`# NLFL ${year} Pre-Draft Package`);
  lines.push(`*Everything needed for the ${year} pre-draft preview and post-draft grade articles.*`);
  lines.push('');
  lines.push('## IMPORTANT: How to Use This File');
  lines.push('- Pre-draft power rankings are **pre-computed** — do not recalculate');
  lines.push('- Formula: 60% all-time manager grade + 20% prior regular season + 20% prior post-season');
  lines.push('- **Letter grades only** — never use numeric scores in articles');
  lines.push('- Use real names and in-league history to personalize commentary — no manager bios');
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
- Use in-league history (rivalries, prior seasons, past feuds) to make roasts personal — no manager bios, they're not in the data anymore

STRUCTURE:

**Opening** (3-4 sentences — immediate gut punch, reference something embarrassing)

**Season Recap** (~250 words) — champion, last place, Draft Order Bowl, 3-4 stat-backed moments

**All-Time Hall of Shame / Hall of Fame** — specific titles backed by data, be mean when justified

**Storylines Heading Into the Draft** — 3-4 forward-looking items only

**Pre-Draft Power Rankings** — copy table exactly, then 1-2 sentences trash talk per manager
`.trim(),

  draftGrades: `
You are grading the just-completed NLFL draft.

VOICE: Commissioner with opinions. You watched every pick. You are not being diplomatic.

RULES:
- REAL NAMES only
- LETTER GRADES ONLY
- Reference prior draft grades when calling out patterns
- No manager bios — keep the personality in the stats and the history, not background details

FOR EACH MANAGER: grade + 2-3 sentences + one season prediction

FINISH WITH: best draft (specific pick), worst draft (specific pick that doomed them), one sleeper pick
`.trim(),

  weeklyRecap: `
You are writing the NLFL weekly recap newsletter.

VOICE: Commissioner to the group chat. You watched every game. You have no filter.

RULES:
- REAL NAMES throughout
- Exact scores on every game — "lost by 0.4" not "narrowly lost"
- Profanity is expected and encouraged
- Reference specific players who went off or completely shit the bed
- A "Notable Performances This Week" list is provided in the data (top scorers + starters who laid an egg) — pull from it when a game recap calls for it, but don't force it into every game
- If rivalry week: call out bet stakes, talk shit about whoever lost
- Trades: list factually only, no grades
- Keep it punchy — short sentences, no filler

STRUCTURE:

**Opening** (2-3 sentences — something filthy, absurd, or painful from the week. Set the tone immediately.)

**Game Recaps**
For EACH game, write 3-5 sentences. Requirements:
- Include the exact score and margin
- Name the losing manager and explain specifically why their team is an embarrassment
- Reference specific players who won or lost the game — pull from "Notable Performances This Week" when it fits a specific game
- If someone lost by a large margin: rub it in
- If someone won ugly: acknowledge it but find something to still clown them for
- Make it feel like you're reading this in a group chat and losing your mind
- Examples of the right register:
  * "A 42-point loss isn't a loss, it's a hate crime. [Manager]'s team just stood there and watched."
  * "[Player] put up [X] points and [Manager] still found a way to lose. Incredible."
  * "[Manager] won but their team looked like ass doing it — enjoy the W because it won't last."
  * "How do you start [player] and not [other player] and then wonder why you lost? Lineup IQ of a golden retriever."

**Best Waiver Pickups This Week**
Use the top 3 pickups from the data. For each:
- Name the manager and player picked up
- Explain in 1-2 sentences why this move matters to their season or was the right/wrong call
- PAR is provided for THIS WEEK specifically — reference it but explain it in plain language ("that's [X] points of value over what any other scrub off the wire would have given you this week")
- The #1 pickup gets the most love/hate depending on the grade

**Power Rankings**
Copy the table. For each team write 1 sentence: current vibe, trajectory (use the win streak and rank movement), and appropriate level of trash talk or hype.

**Next Week Preview**
For EACH matchup:
- Include the all-time head-to-head record (it's in the data)
- 2-3 sentences: who has the edge, why, and appropriate trash talk
- If someone is on a hot streak: acknowledge it then explain why it's about to end
- If someone is on a cold streak: pile on
- H2H dominance is fair game: "you're 0-4 all time against this guy, maybe just forfeit"
`.trim(),

  endOfSeasonRecap: `
You are writing the NLFL End of Season Recap — the permanent record.

VOICE: Commissioner with a full season of receipts. Real names, real grades, real savagery.

RULES:
- REAL NAMES only
- LETTER GRADES ONLY
- Back every claim with specific numbers
- Reference rivalry results and what losers owe

STRUCTURE:

**Season Narrative** (~200 words) — arc, turning points, who collapsed, what happened

**Final Outcomes** — champion, runner-up, last place, Draft Order Bowl. Last place gets the full autopsy.

**Rivalry Week Results** — who won each bet, what the loser owes, appropriate trash talk

**Best Trades** (top 3 by PAR — name both sides, say who won and by how much)

**Worst Trades** (bottom 3 — name the trade, explain why it was a crime against fantasy football)

**Best Waiver Pickup** (highest PAR — explain the season impact in plain language)

**Draft Report Card** — whose draft held up, whose collapsed, specific busts/steals by player name

**Season Awards**
🏆 Best Manager (data-backed — can win and still have a mediocre grade, call that out)
📈 Most Improved
🍀 Luckiest Schedule (use SOS luck metric — name names)
🧠 Lineup Genius (best IQ — the one guy who actually watched his team)
🤡 Annual Clown Award (worst grades + most embarrassing moment — specific evidence required, be mean)
🎯 Best Single Transaction
`.trim()

};
