// dataExport.js
//
// Serializes computed NLFL league data into Markdown for Claude Projects.
// Always 4 files, always overwrite. Never accumulate.

import { getRealName, buildManagerRosterSection, getSeasonRivalries } from '$lib/utils/leagueManagers.js';

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
 * Computes standings through a specific week from individual game results.
 * This is the correct approach for both test mode AND live exports — it
 * guarantees standings reflect exactly what happened through that week,
 * regardless of whether the season is complete.
 *
 * Returns sorted array of { managerId, wins, losses, ties, pf, pa }.
 */
function buildStandingsThroughWeek(allWeeklyResults, year, throughWeek) {
  const results = (allWeeklyResults || []).filter(
    r => String(r.year) === String(year) && !r.isPlayoffs && r.week <= throughWeek
  );

  const records = {};
  results.forEach(r => {
    if (!records[r.managerId]) {
      records[r.managerId] = {
        managerId: r.managerId,
        wins: 0, losses: 0, ties: 0,
        pf: 0,   pa: 0
      };
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
 * Extracts matchup pairs for a specific week from weekly results.
 * Used to auto-populate next week's matchup preview.
 * Returns array of { homeId, awayId }.
 */
function extractMatchupsForWeek(allWeeklyResults, year, week) {
  const results = (allWeeklyResults || []).filter(
    r => String(r.year) === String(year) && !r.isPlayoffs && r.week === week
  );
  const seen     = new Set();
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
    if (!regRecords[r.managerId]) regRecords[r.managerId] = { wins: 0, losses: 0, ties: 0, pf: 0 };
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
  lines.push('- **Last Place Award**: worst record/points through week 14 (regular season loser)');
  lines.push('- **Draft Order Bowl**: bottom 6 teams compete in a consolation bracket; winner sets next season\'s draft order');
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
  lines.push('- Profanity is fine and expected — "ass cheeks", "suck my nutz", "dogshit" are all appropriate');
  lines.push('- Reference specific players, scores, and stats from the data to back up every claim');
  lines.push('- Inside jokes and callbacks to prior seasons or bio details make it hit harder');
  lines.push('- Keep sentences short and punchy. No flowery sports journalism language.');
  lines.push('- Use bios to inform personality — if someone is a Cowboys fan and their team sucks, call it out');
  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR**: Points Above Replacement — how much a player/pickup/trade exceeded a freely available alternative');
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round');
  lines.push('- **Lineup IQ**: actual pts scored ÷ maximum possible pts. Higher = better lineup decisions');
  lines.push('- **SOS**: Strength of Schedule — avg opponent scoring and win % faced');
  lines.push('- **Luck**: actual win% minus expected win% based on weekly score vs all other scores');
  lines.push('- **Manager Grade**: Draft 40% + Trades 20% + Waivers 20% + Lineup IQ 20%. C = league average');
  lines.push('');
  lines.push(buildManagerRosterSection(managersSnapshot, mostRecentYear));
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
  lines.push('*Derived from final placements and regular-season records. Use these as ground truth.*');
  lines.push('');
  if (outcomes?.champion)
    lines.push(`- 🏆 **Champion**: ${outcomes.champion.displayName}`);
  else
    lines.push('- 🏆 **Champion**: Not yet determined (season may be in progress)');
  if (outcomes?.runnerUp)
    lines.push(`- 🥈 **Runner-Up**: ${outcomes.runnerUp.displayName}`);
  if (outcomes?.thirdPlace)
    lines.push(`- 🥉 **Third Place**: ${outcomes.thirdPlace.displayName}`);
  if (outcomes?.regularSeasonLoser) {
    const l = outcomes.regularSeasonLoser;
    lines.push(`- 💀 **Regular Season Last Place**: ${l.displayName} (${l.wins}-${l.losses}${l.ties > 0 ? `-${l.ties}` : ''}, ${fp(l.pf)} pts)`);
  }
  if (outcomes?.loserBracketWinner)
    lines.push(`- 🎯 **Draft Order Bowl Winner** (sets next season's draft order): ${outcomes.loserBracketWinner.displayName}`);
  else
    lines.push('- 🎯 **Draft Order Bowl Winner**: Not available in data (consolation bracket result)');

  const rivalries = getSeasonRivalries(year, managersSnapshot);
  if (rivalries.length > 0) {
    lines.push('');
    lines.push('## Rivalry Week Stakes');
    lines.push('*Reference when covering rivalry week results — loser owes the bet.*');
    lines.push('');
    rivalries.forEach(r => {
      lines.push(`- **${r.managerA} vs ${r.managerB}**: ${r.bet}`);
    });
  }

  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('*Sorted by wins then points scored.*');
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
  lines.push('*finalPlacement = overall finish including playoffs and consolation bracket.*');
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
  lines.push('*Letter grades only — C = league average. Weights: Draft 40% · Trades 20% · Waivers 20% · Lineup IQ 20%.*');
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
    lines.push(`*Baseline seasons: ${draftEndOfSeasonGrade.baselineSeasons?.join(', ')}*`);
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
    lines.push('*Positive = outperformed historical round expectations. Negative = underperformed.*');
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
 * This week's data — matchup results, waivers, standings, power rankings.
 * Upload as current_week.md, replace every week.
 *
 * @param {Array}   allSeasonWeeklyResults  All weekly results for this season.
 *   When provided (recommended for both live and test exports):
 *   - Standings are computed from actual game results through `week` — correct for any point in time
 *   - Next week matchups are auto-extracted if not explicitly passed
 *   When omitted: falls back to `currentStandings` (backward compat).
 *
 * @param {boolean} isTestMode  Adds a disclaimer that PAR values are full-season
 *   (since we can't recompute partial-season PAR in test mode).
 */
export function exportWeeklyData({
  year,
  week,
  weeklyResults,
  allSeasonWeeklyResults,
  gradedTransactions,
  currentStandings,
  powerRankings,
  previousPowerRankings,
  nextWeekMatchups,
  isTestMode,
  managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# NLFL ${year} — Week ${week} Data`);
  lines.push('');

  // ── Test mode disclaimer ────────────────────────────────────────────────────
  if (isTestMode) {
    lines.push('> **⚠ TEST MODE — HISTORICAL DATA**');
    lines.push(`> This file simulates what a Week ${week} export would have looked like during the ${year} season.`);
    lines.push('> ');
    lines.push('> **What is accurate:**');
    lines.push(`> - Matchup results are real Week ${week} scores`);
    lines.push(`> - Waiver moves are real Week ${week} transactions`);
    lines.push(`> - Standings reflect records through Week ${week} only`);
    lines.push(`> - Next week matchups are real Week ${week + 1} pairings`);
    lines.push('> ');
    lines.push('> **Known limitation:**');
    lines.push('> - Waiver PAR values reflect the **full-season** value from the pickup date, not just performance through this week.');
    lines.push(`>   Example: a player picked up in Week ${week} and held all season shows their total PAR for the entire hold period.`);
    lines.push('>   This is an inherent constraint of backtesting — partial-season PAR would require recomputing the grading engine at a specific cutoff.');
    lines.push('>   Use the PAR values as relative ranking signals (who added the most vs least value) rather than absolute week-specific numbers.');
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
      const winner = r.result === 'W' ? mn(r.managerId)         : mn(r.opponentManagerId);
      const loser  = r.result === 'W' ? mn(r.opponentManagerId) : mn(r.managerId);
      const wScore = r.result === 'W' ? r.pointsFor    : r.pointsAgainst;
      const lScore = r.result === 'W' ? r.pointsAgainst : r.pointsFor;
      const margin = Math.abs(wScore - lScore);
      lines.push(`- **${winner} ${fp(wScore)}** def. ${loser} ${fp(lScore)} (margin: ${fp(margin)})`);
    });
  }

  // ── Waiver moves ─────────────────────────────────────────────────────────────
  const weekWaivers = (gradedTransactions||[]).filter(tx =>
    tx.type === 'waiver' &&
    !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year) &&
    tx.grade?.par != null
  );

  if (weekWaivers.length > 0) {
    const sorted = [...weekWaivers].sort((a,b) => (b.grade?.par||0) - (a.grade?.par||0));
    lines.push('');
    lines.push('## Waiver Moves This Week (sorted by PAR value)');
    if (isTestMode) {
      lines.push('*Note: PAR values are full-season — see test mode disclaimer above.*');
    }
    lines.push('');
    sorted.forEach(tx => {
      const g = tx.grade;
      lines.push(`- **${mn(tx.managerIds?.[0])}**: +${g.name} (${g.position})${g.droppedName?` / -${g.droppedName}`:''} — ${signedFp(g.par)} PAR vs replacement (${g.repName}), ${g.gradeLabel}`);
    });
    lines.push('');
    lines.push(`**Best pickup**: ${mn(sorted[0].managerIds?.[0])} added ${sorted[0].grade.name} (${signedFp(sorted[0].grade.par)} PAR)`);
    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1];
      lines.push(`**Worst pickup**: ${mn(worst.managerIds?.[0])} added ${worst.grade.name} (${signedFp(worst.grade.par)} PAR)`);
    }
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
    lines.push('*(Grades not available until end of season — list factually only)*');
    lines.push('');
    weekTrades.forEach(tx => {
      lines.push(`- **${mn(tx.managerIds?.[0])} ↔ ${mn(tx.managerIds?.[1])}**`);
    });
  }

  // ── Standings — computed from weekly results through this week ──────────────
  lines.push('');
  lines.push(`## Standings Through Week ${week}`);
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA |');
  lines.push('|------|---------|---|---|---|----|----|');

  // Prefer computed standings from game results (accurate for any point in time)
  // Fall back to currentStandings only if allSeasonWeeklyResults not available
  if (allSeasonWeeklyResults) {
    const computed = buildStandingsThroughWeek(allSeasonWeeklyResults, year, week);
    computed.forEach((rec, idx) => {
      lines.push(`| #${idx+1} | ${mn(rec.managerId)} | ${rec.wins} | ${rec.losses} | ${rec.ties} | ${fp(rec.pf)} | ${fp(rec.pa)} |`);
    });
  } else {
    // Backward compat: use passed-in standings
    // Note: regularSeason totals will be full-season if the season is over
    (currentStandings||[]).forEach((team, idx) => {
      const rs = team.regularSeason || {};
      lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} |`);
    });
  }

  // ── Power rankings ────────────────────────────────────────────────────────────
  if (powerRankings) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push(`*Phase: ${powerRankings.phase} | Weights: Record ${(powerRankings.weights.record*100).toFixed(0)}% / Pts ${(powerRankings.weights.points*100).toFixed(0)}% / Form ${(powerRankings.weights.recentForm*100).toFixed(0)}% / Mgr Grade ${(powerRankings.weights.managerGrade*100).toFixed(0)}%*`);
    lines.push('');
    const prevMap = {};
    (previousPowerRankings||[]).forEach(t => { prevMap[t.managerId] = t.rank; });
    lines.push('| Rank | Δ | Manager | Record | PF | Score |');
    lines.push('|------|---|---------|--------|----|-------|');
    powerRankings.rankings.forEach(team => {
      const prev   = prevMap[team.managerId];
      const mov    = prev != null ? prev - team.rank : null;
      const movStr = mov == null ? 'NEW' : mov > 0 ? `↑${mov}` : mov < 0 ? `↓${Math.abs(mov)}` : '—';
      lines.push(`| #${team.rank} | ${movStr} | ${mn(team.managerId)} | ${team.wins}-${team.losses} | ${fp(team.pf)} | ${fp(team.compositeScore)} |`);
    });
  } else if (isTestMode) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push('*Not available in test mode. Power rankings require real-time computation and are not reconstructed for historical weeks.*');
  }

  // ── Next week matchups ────────────────────────────────────────────────────────
  // Auto-extract from allSeasonWeeklyResults if not explicitly provided
  const nextWeek = week + 1;
  const resolvedNextWeekMatchups = nextWeekMatchups?.length
    ? nextWeekMatchups
    : (allSeasonWeeklyResults
        ? extractMatchupsForWeek(allSeasonWeeklyResults, year, nextWeek)
        : []);

  if (resolvedNextWeekMatchups.length > 0) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${nextWeek})`);
    lines.push('');
    resolvedNextWeekMatchups.forEach(m => {
      // Support both { homeId, awayId } (from extractMatchupsForWeek)
      // and { home, away } (legacy format passed manually)
      const homeId = m.homeId || m.home;
      const awayId = m.awayId || m.away;
      lines.push(`- **${mn(homeId)}** vs **${mn(awayId)}**`);
    });
  } else if (nextWeek <= 14) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${nextWeek})`);
    lines.push('*Matchup data for next week not available.*');
  }

  return lines.join('\n');
}

// ── Pre-draft package ─────────────────────────────────────────────────────────

export function exportPreDraftPackage({
  year, allTimeExport, latestSeasonExport, preSeasonRankings, managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# NLFL ${year} Pre-Draft Package`);
  lines.push(`*Contains everything needed to write the ${year} pre-draft preview and post-draft grade articles.*`);
  lines.push('');
  lines.push('## IMPORTANT: How to Use This File');
  lines.push('- The pre-draft power rankings below are **pre-computed from actual data** — do not recalculate them');
  lines.push('- Formula: 60% all-time manager grade + 20% prior regular season finish + 20% prior post-season finish');
  lines.push('- All grades are **letter grades** (C = league average) — never use numeric scores in articles');
  lines.push('- Use manager bios from league_context.md to personalize commentary');
  lines.push('');

  lines.push('## Pre-Draft Power Rankings');
  lines.push('');
  if (preSeasonRankings?.rankings?.length) {
    lines.push('| Rank | Manager | Overall | Draft | Trades | Waivers | Lineup IQ | Prior Reg Finish | Prior Post Finish |');
    lines.push('|------|---------|---------|-------|--------|---------|-----------|-----------------|-------------------|');
    preSeasonRankings.rankings.forEach(team => {
      const regRank  = team.isFirstSeason ? '(new)' : team.prevRegRank  != null ? `#${team.prevRegRank}`  : '—';
      const postRank = team.isFirstSeason ? '(new)' : team.prevPostRank != null ? `#${team.prevPostRank}` : '—';
      lines.push([
        `#${team.rank}`,
        mn(team.managerId),
        toLetter(team.mgrGrade),
        toLetter(team.avgNormDraft),
        toLetter(team.avgNormTrade),
        toLetter(team.avgNormWaiver),
        toLetter(team.avgNormLineup),
        regRank,
        postRank
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    });
  } else {
    lines.push('*Rankings not computed. Go to Power Rankings tab → select next season → Compute Rankings → re-export this file.*');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Prior Season Full Data');
  lines.push('');
  lines.push(latestSeasonExport || '*(Season stats not available)*');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## All-Time League History');
  lines.push('');
  lines.push(allTimeExport || '*(All-time history not available)*');

  return lines.join('\n');
}

// ── Article prompts ───────────────────────────────────────────────────────────

export const PROMPTS = {

  preDraftRecap: `
You are writing the Pre-Draft Preview newsletter for the NLFL (National Liver Failure League).

VOICE: You are the league commissioner writing to the group chat. You're one of the guys. You watched every game last season and you have opinions. Write like you're texting your boys, not publishing a sports column.

TONE EXAMPLES FROM PAST NLFL ARTICLES:
- "3 years in, and Berra still can't beat me."
- "Newman's team sucks major ball sacks, how did you win 6 games?"
- "Jesus Jonathan Taylor is so fucking good."
- "Better hope Ashton Jeanty turns into prime Adrian Peterson."
- "Is this the beginning of Alec's collapse that we've been waiting for all season long?"
- "hey Newman, remember when you talked shit when I was 0-4, suck my nutz"
Match that energy exactly. Personal, specific, data-backed, filthy when appropriate.

RULES:
- Use REAL NAMES from the bios in league_context.md — never Sleeper usernames
- LETTER GRADES ONLY — never write numeric scores like 87.3 or 64.2
- DO NOT repeat season recap content in the storylines section — storylines = forward-looking only
- The Pre-Draft Power Rankings table is pre-computed — copy it exactly, do not recalculate
- Reference bio details (team allegiances, personality traits, past failures) to personalize roasts
- Keep paragraphs short and punchy. No flowery language.

ARTICLE STRUCTURE:

**Opening** (3-4 sentences — punch them in the mouth immediately)

**[YEAR] Season Recap** (~250 words)
Who won, who was last, who won the Draft Order Bowl. Hit the 3-4 most embarrassing/impressive statistical moments with specific numbers. Brief callbacks to prior season patterns.

**All-Time Hall of Fame / Hall of Shame**
Award specific titles based on the all-time data. Be mean when the data justifies it. Be specific.

**Storylines Heading Into the Draft** (FORWARD-LOOKING ONLY)
3-4 things to watch. Draft position stakes, redemption arcs, who needs to prove something. No rehashing last season.

**Pre-Draft Power Rankings**
Copy the pre-computed table exactly. Then 1-2 sentences of spicy commentary per manager. Reference their component grades and prior season finish. Don't be diplomatic.
`.trim(),

  draftGrades: `
You are grading the just-completed NLFL draft for the group newsletter.

VOICE: Commissioner energy. You watched every single pick. You have takes. Some of them are going to hurt.

RULES:
- Use REAL NAMES from league_context.md — never Sleeper usernames
- LETTER GRADES ONLY
- Reference prior draft grades (from all_time_history.md) when calling out patterns
- Use bio details to add personality

FOR EACH MANAGER:
- Letter grade (A+ through F)
- 2-3 sentences: key picks, reaches vs value, positional strategy, historical pattern
- One bold prediction for their season

FINISH WITH:
- Best draft in the room and the specific pick that made it
- Worst draft and the pick that doomed them
- One sleeper pick that could make everyone look stupid by week 8
`.trim(),

  weeklyRecap: `
You are writing the NLFL weekly recap newsletter.

VOICE: Commissioner to the group chat. You watched every game. Real names, exact scores, trash talk.

TONE EXAMPLES:
- "Wow, James pulled off the improbable and potentially clawed his way out of last."
- "His team is ass cheeks" is appropriate vocabulary
- Always include exact scores — "lost by 0.4 points" not "narrowly lost"
- "Jesus [player name] is so fucking good" is the right register

RULES:
- Use REAL NAMES from league_context.md throughout
- Include exact scores for every game
- Reference specific players who had big weeks or flopped
- If it's rivalry week, reference the bet stakes for each rivalry matchup
- Trades this week have NO grades — list them factually only
- Keep it punchy. Short paragraphs.

STRUCTURE:

**Opening** (2-3 sentences — reference something absurd from the week)

**Game Recaps** (2-4 sentences per game — exact scores, winner gets credit, loser gets roasted)

**Waiver Wire Report**
Best pickup (use PAR data — explain why it matters to their season)
Worst pickup (lowest PAR — give them grief)
List all other moves factually.

**Power Rankings**
Copy the table. 1 sentence per team noting movement and trajectory.

**Next Week Preview**
1-2 sentences per matchup. Who has the edge. Add trash talk.
`.trim(),

  endOfSeasonRecap: `
You are writing the NLFL End of Season Recap — the permanent record.

VOICE: Commissioner with a full season of receipts. Real names, real grades, real numbers.

RULES:
- Use REAL NAMES from league_context.md
- LETTER GRADES ONLY
- Back every claim with specific numbers
- Reference rivalry results and who won/lost their bets

STRUCTURE:

**Season Narrative** (~200 words) — how did it unfold, defining storylines

**Final Outcomes** — Champion, runner-up, last place, Draft Order Bowl winner. Last place gets the full autopsy.

**Rivalry Week Results** — who won each rivalry, what the loser owes

**Best Trades** (top 3 by PAR — name both sides, say who won and by how much)

**Worst Trades** (bottom 3 — name the trade, explain why it was bad)

**Best Waiver Pickup** (highest PAR — explain season impact)

**Draft Report Card** — whose draft held up, whose collapsed, specific busts and steals by name

**Season Awards**
🏆 Best Manager (data-backed, not just who won)
📈 Most Improved
🍀 Luckiest Schedule (use SOS luck metric — call them out)
🧠 Lineup Genius (best IQ)
🤡 Annual Clown Award (worst grades, most embarrassing moment, specific evidence)
🎯 Best Single Transaction
`.trim()

};
