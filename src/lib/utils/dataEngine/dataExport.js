// dataExport.js

import { getRealName } from '$lib/utils/leagueManagers.js';

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

function deriveSeasonOutcomes(standings, weeklyResults, snap) {
  if (!standings || standings.length === 0) return null;
  const mn = (id) => mgrName(id, snap);
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
    if (r.result === 'W') rec.wins++;
    else if (r.result === 'L') rec.losses++;
    else rec.ties++;
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
    loserBracketWinner: loserBracketWinner ? { managerId: loserBracketWinner.managerId, displayName: mn(loserBracketWinner.managerId) } : null,
    regularSeasonLoser
  };
}

export function exportLeagueContext(managersSnapshot) {
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
  lines.push('- 12 teams, PPR scoring');
  lines.push('- Regular season: weeks 1-14');
  lines.push('- Playoffs: weeks 15-17, top 6 teams');
  lines.push('- **Champion**: wins the playoff bracket');
  lines.push('- **Last Place Award**: worst record through week 14');
  lines.push('- **Draft Order Bowl**: bottom 6 teams; winner sets next season\'s draft order');
  lines.push('- **Rivalry Week**: each manager has a designated rival; results carry extra bragging rights');
  lines.push('');
  lines.push('## Roster Settings (2024+)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×2, K×1, DEF×1, BN×6 — 17 rounds');
  lines.push('');
  lines.push('## Roster Settings (2023)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×1, K×1, DEF×1, BN×7 — 16 rounds');
  lines.push('');
  lines.push('## Managers (Real Names)');
  const users = managersSnapshot?.users || {};
  Object.entries(users).forEach(([id, user]) => {
    const realName = getRealName(id, managersSnapshot);
    const sleeperName = user.display_name;
    if (realName !== sleeperName) {
      lines.push(`- **${realName}** (Sleeper: ${sleeperName})`);
    } else {
      lines.push(`- **${realName}**`);
    }
  });
  lines.push('');
  lines.push('## Writing Style Guide');
  lines.push('- Write like you\'re in a group chat with your boys, not a sports column');
  lines.push('- Call people out BY NAME with specific scores ("James lost by 47 points, which is wild because his team was projected to win")');
  lines.push('- Trash talk the losers, hype up the winners, question everyone\'s life choices');
  lines.push('- Profanity is fine and expected — "ass cheeks", "suck my nutz", "dogshit" etc. are appropriate');
  lines.push('- Reference specific players, scores, and stats from the data to back up every claim');
  lines.push('- Inside jokes and callbacks to prior seasons make it hit harder');
  lines.push('- Keep sentences short and punchy. No flowery sports journalism language.');
  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR**: Points Above Replacement');
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round');
  lines.push('- **Lineup IQ**: actual pts ÷ max possible pts');
  lines.push('- **SOS**: Strength of Schedule');
  lines.push('- **Luck**: actual win% minus expected win% based on weekly score vs all other scores');
  lines.push('- **Manager Grade**: Draft 40% + Trades 20% + Waivers 20% + Lineup IQ 20%, C = league average');
  return lines.join('\n');
}

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
  if (outcomes?.champion)           lines.push(`- 🏆 **Champion**: ${outcomes.champion.displayName}`);
  else                              lines.push('- 🏆 **Champion**: Not yet determined');
  if (outcomes?.runnerUp)           lines.push(`- 🥈 **Runner-Up**: ${outcomes.runnerUp.displayName}`);
  if (outcomes?.thirdPlace)         lines.push(`- 🥉 **Third Place**: ${outcomes.thirdPlace.displayName}`);
  if (outcomes?.regularSeasonLoser) {
    const l = outcomes.regularSeasonLoser;
    lines.push(`- 💀 **Regular Season Last Place**: ${l.displayName} (${l.wins}-${l.losses}, ${fp(l.pf)} pts)`);
  }
  if (outcomes?.loserBracketWinner) lines.push(`- 🎯 **Draft Order Bowl Winner**: ${outcomes.loserBracketWinner.displayName}`);
  else                              lines.push('- 🎯 **Draft Order Bowl Winner**: Not available in data');

  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('');
  lines.push('| Reg Rank | Manager | W | L | T | PF | PA | Playoffs? |');
  lines.push('|----------|---------|---|---|---|----|----|-----------|');

  const sortedByRegSeason = [...(standings || [])].sort((a, b) => {
    const wa = a.regularSeason?.wins || 0;
    const wb = b.regularSeason?.wins || 0;
    if (wb !== wa) return wb - wa;
    return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
  });

  sortedByRegSeason.forEach((team, idx) => {
    const rs   = team.regularSeason || {};
    const made = (team.finalPlacement || 99) <= 6
      ? '✓ Playoffs (seed #' + (idx + 1) + ')'
      : 'Loser Bowl';
    lines.push(`| #${idx+1} | **${mn(team.managerId)}** | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} | ${made} |`);
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
    sortedByFinal.forEach((team) => {
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
  lines.push('*C = league average. Weights: Draft 40% · Trades 20% · Waivers 20% · Lineup IQ 20%*');
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
    lines.push('### Top Steals');
    (draftEndOfSeasonGrade.leagueTopSteals||[]).slice(0,5).forEach((p,i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, ${fp(p.actualPts)} pts`);
    });

    lines.push('');
    lines.push('### Biggest Busts');
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
      .filter(({data}) => data)
      .sort((a,b) => (b.data.lineupIQ||0) - (a.data.lineupIQ||0))
      .forEach(({id, data}) => {
        lines.push(`| ${mn(id)} | ${fp(data.fpts)} | ${fp(data.ppts)} | ${pct(data.lineupIQ)} |`);
      });
  }

  return lines.join('\n');
}

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
  lines.push(['| Manager', ...allYears.map(y=>`**${y}**`), '|'].join(' | '));
  lines.push(['|--------', ...allYears.map(()=>'--------'), '|'].join('|'));
  Object.keys(allTimeManagerGrades).forEach(id => {
    const row = [mn(id), ...allYears.map(y => {
      const g = seasonManagerGrades[y]?.[id];
      return g?.overallGrade != null ? toLetter(g.overallGrade) : '—';
    })];
    lines.push('| ' + row.join(' | ') + ' |');
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
  lines.push('| Manager | Seasons | W | L | T | PF | PA | Championships | Last Place |');
  lines.push('|---------|---------|---|---|---|----|----|---------------|------------|');
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
    .forEach(({id, rs, champs, last, seasons}) => {
      lines.push(`| ${mn(id)} | ${seasons} | ${rs.wins} | ${rs.losses} | ${rs.ties} | ${fp(rs.pf)} | ${fp(rs.pa)} | ${champs||'0'} | ${last||'0'} |`);
    });

  if (Object.keys(draftGradesByYear).length > 0) {
    lines.push('');
    lines.push('## Draft Performance by Season (Adjusted PAR)');
    lines.push('');
    const draftYears = Object.keys(draftGradesByYear).sort((a,b) => Number(a)-Number(b));
    lines.push(['| Manager', ...draftYears, '|'].join(' | '));
    lines.push(['|--------', ...draftYears.map(()=>'------'), '|'].join('|'));
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
    const tSep    = ['|--------', ...txYears.map(()=>'------'), '|'].join('|');

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

export function exportWeeklyData({
  year, week, weeklyResults, gradedTransactions, currentStandings,
  powerRankings, previousPowerRankings, nextWeekMatchups, managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# NLFL ${year} — Week ${week} Data`);
  lines.push('');
  lines.push(`## Week ${week} Results`);
  lines.push('');

  const seen = new Set();
  const matchups = [];
  (weeklyResults||[]).filter(r => !r.isPlayoffs).forEach(r => {
    const key = [r.managerId, r.opponentManagerId].sort().join('-');
    if (!seen.has(key)) { seen.add(key); matchups.push(r); }
  });
  matchups.forEach(r => {
    const winner = r.result === 'W' ? mn(r.managerId) : mn(r.opponentManagerId);
    const loser  = r.result === 'W' ? mn(r.opponentManagerId) : mn(r.managerId);
    const wScore = r.result === 'W' ? r.pointsFor : r.pointsAgainst;
    const lScore = r.result === 'W' ? r.pointsAgainst : r.pointsFor;
    const margin = Math.abs(wScore - lScore);
    lines.push(`- **${winner} ${fp(wScore)}** def. ${loser} ${fp(lScore)} (margin: ${fp(margin)})`);
  });

  const weekWaivers = (gradedTransactions||[]).filter(tx =>
    tx.type === 'waiver' && !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year) &&
    tx.grade?.par != null
  );

  if (weekWaivers.length > 0) {
    const sorted = [...weekWaivers].sort((a,b) => (b.grade?.par||0) - (a.grade?.par||0));
    lines.push('');
    lines.push('## Waiver Moves This Week');
    lines.push('');
    sorted.forEach(tx => {
      const g = tx.grade;
      lines.push(`- **${mn(tx.managerIds?.[0])}**: +${g.name} (${g.position})${g.droppedName?` / -${g.droppedName}`:''} — ${signedFp(g.par)} PAR, ${g.gradeLabel}`);
    });
    lines.push('');
    lines.push(`Best pickup: **${mn(sorted[0].managerIds?.[0])}** added ${sorted[0].grade.name} (${signedFp(sorted[0].grade.par)} PAR)`);
    if (sorted.length > 1) {
      const worst = sorted[sorted.length-1];
      lines.push(`Worst pickup: **${mn(worst.managerIds?.[0])}** added ${worst.grade.name} (${signedFp(worst.grade.par)} PAR)`);
    }
  }

  const weekTrades = (gradedTransactions||[]).filter(tx =>
    tx.type === 'trade' && !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year)
  );
  if (weekTrades.length > 0) {
    lines.push('');
    lines.push('## Trades This Week *(grades available end of season)*');
    lines.push('');
    weekTrades.forEach(tx => {
      lines.push(`- **${mn(tx.managerIds?.[0])} ↔ ${mn(tx.managerIds?.[1])}**`);
    });
  }

  lines.push('');
  lines.push(`## Standings Through Week ${week}`);
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA |');
  lines.push('|------|---------|---|---|---|----|----|');
  (currentStandings||[]).forEach((team, idx) => {
    const rs = team.regularSeason || {};
    lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} |`);
  });

  if (powerRankings) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push(`*Phase: ${powerRankings.phase}*`);
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
  }

  if (nextWeekMatchups?.length) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${week+1})`);
    lines.push('');
    nextWeekMatchups.forEach(m => { lines.push(`- **${mn(m.home)}** vs **${mn(m.away)}**`); });
  }

  return lines.join('\n');
}

export function exportPreDraftPackage({
  year, allTimeExport, latestSeasonExport, preSeasonRankings, managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# NLFL ${year} Pre-Draft Package`);
  lines.push('');
  lines.push('## IMPORTANT: Pre-Draft Power Rankings (Pre-Computed)');
  lines.push('Formula: **60% all-time manager grade + 20% prior regular season + 20% prior post-season**.');
  lines.push('These are final — do not recalculate.');
  lines.push('');

  if (preSeasonRankings?.rankings?.length) {
    lines.push('| Rank | Manager | Overall | Draft | Trades | Waivers | Lineup IQ | Prior Reg | Prior Post |');
    lines.push('|------|---------|---------|-------|--------|---------|-----------|-----------|------------|');
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
    lines.push('*Compute Power Rankings for this season before exporting.*');
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

// ── Prompts ───────────────────────────────────────────────────────────────────

export const PROMPTS = {
  preDraftRecap: `
You are writing the Pre-Draft Preview newsletter for the NLFL (National Liver Failure League).

VOICE: You are the league commissioner writing to the group chat. You're one of the guys. You've watched every team all season and you have opinions. Write like you're texting your boys, not publishing an article. Use real names throughout.

TONE EXAMPLES FROM PAST ARTICLES:
- "3 years in, and Berra still can't beat me."
- "Newman's team sucks major ball sacks, how did you win 6 games?"
- "Jesus Jonathan Taylor is so fucking good."
- "Better hope Ashton Jeanty turns into prime Adrian Peterson."
- "Is this the beginning of Alec's collapse that we've been waiting for all season long?"

Match that energy. Specific, personal, trash-talky, backed by data.

RULES:
- Use REAL NAMES from the data (not Sleeper usernames)
- Letter grades ONLY — never numeric scores
- DO NOT repeat season recap content in the storylines section (storylines = forward-looking only)
- The pre-draft power rankings table is pre-computed — copy it exactly, do not recalculate
- Keep paragraphs short. No flowery language.

STRUCTURE:

**Opening** (3-4 sentences — punch them in the mouth right away)

**[YEAR] Season Recap** (~250 words)
Who won, who was last, who won the Draft Order Bowl. Hit the 3-4 most embarrassing/impressive moments with specific numbers. Brief callbacks to prior seasons where someone has a pattern.

**All-Time Hall of Shame / Hall of Fame**
Give specific superlative titles based on the data. Examples: Best Drafter, Waiver Wire Wizard, Most Likely to Choke, Luckiest SOB in the League, etc. Be mean when the data justifies it.

**Storylines Heading Into the Draft** (FORWARD-LOOKING ONLY)
3-4 things to watch. Draft position stakes, redemption arcs, someone who needs to prove something. No rehashing last season.

**Pre-Draft Power Rankings**
Copy the pre-computed table, then give 1-2 sentences of trash talk per manager. Reference their grades and prior finish. Don't be diplomatic.
`.trim(),

  draftGrades: `
You are grading the just-completed NLFL draft for the group newsletter.

VOICE: Same as always — group chat commissioner energy. You watched every pick. You have takes.

TONE: Call out bad picks by name. Hype up value picks. Reference who this manager has drafted in prior years — do they always reach for a QB too early? Do they always load up RBs? The history is in the data.

RULES:
- Use REAL NAMES
- Letter grades ONLY
- Be specific: "Taking [player] in round 5 when he was still available in round 7 according to ADP is either genius or desperation, and with [manager]'s track record I'm leaning desperation"
- Reference prior draft grades when roasting or praising patterns

FOR EACH MANAGER:
- Letter grade (A+ through F)
- 2-3 sentences: key picks, reaches, value grabs, positional strategy, historical pattern
- One prediction for their season based on the draft

FINISH WITH:
- Who had the best draft and why (be specific)
- Who had the worst draft (be mean, be specific, cite the pick)
- One sleeper pick across the whole draft that could make everyone look stupid
`.trim(),

  weeklyRecap: `
You are writing the NLFL weekly recap newsletter.

VOICE: Commissioner to the group chat. You watched every game. You're going to roast the losers and hype the winners and you're going to use their real names.

TONE EXAMPLES:
- "Wow, James pulled off the improbable and potentially clawed his way out of last."
- "Siampos thanking god they changed their bet."
- "Pretty sure Berra is Alec's daddy after the ass whooping he just gave."
- Use scores: "lost by 0.4 points" not "narrowly lost"
- "His team is ass cheeks" is appropriate vocabulary

RULES:
- Use REAL NAMES throughout
- Include exact scores for every game
- Reference specific players who had big weeks or flopped
- Trades have NO grades this week — just list them factually
- Keep it punchy. Short paragraphs.

STRUCTURE:

**Opening** (2-3 sentences — reference something absurd from the week)

**Game Recaps** (2-4 sentences per game — winner gets credit, loser gets roasted, include exact scores and margins)

**Waiver Wire Report**
Best pickup (use PAR data — explain why it matters to their season)
Worst pickup (lowest PAR — give them grief)

**Power Rankings**
Copy the table, then 1 sentence per team. Note movement up/down. Be honest about who's trending bad.

**Next Week Preview**
1-2 sentences per game. Who has the edge. Add appropriate trash talk.
`.trim(),

  endOfSeasonRecap: `
You are writing the NLFL End of Season Recap — the permanent record of what happened.

VOICE: Commissioner energy but with a year's worth of receipts. You have all the data and you're going to use it. Real names, real scores, real grades.

TONE: More analytical than the weekly but still savage. "The data says [manager] had the worst draft in the league and their season showed it" hits different when you back it up with numbers.

RULES:
- Use REAL NAMES
- Letter grades ONLY
- Back every claim with specific numbers from the data
- Be honest about who underperformed, who got lucky, who actually earned it

STRUCTURE:

**Season Narrative** (~200 words)
How did the season unfold? Who started hot and faded? Who came from nowhere? What was the defining storyline?

**Final Outcomes**
Champion, runner-up, last place, Draft Order Bowl winner. Champion gets credit. Last place gets the full autopsy — what went wrong, week by week if you can.

**Best Trades** (top 3 by PAR — name both sides, say who won and by how much)

**Worst Trades** (bottom 3 — name the trade, explain why it was bad)

**Best Waiver Pickup** (highest PAR — explain the impact on their season)

**Draft Report Card**
Whose draft held up when the season ended? Whose looked great on paper and collapsed? Cite specific busts and steals by player name.

**Season Awards**
🏆 Best Manager (data-backed, not just who won — someone can win and still have a mediocre grade)
📈 Most Improved
🍀 Luckiest Schedule (use the SOS luck metric — call them out)
🧠 Lineup Genius (best IQ — the one who actually watched their team)
🤡 The Annual Clown Award (worst grades, most embarrassing moment, specific evidence required)
🎯 Best Single Transaction of the Year
`.trim()
};
