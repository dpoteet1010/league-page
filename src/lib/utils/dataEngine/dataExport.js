// dataExport.js — serializes computed league data into Markdown for Claude Projects.

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
  return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
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

  // Regular season loser: worst record through weeks 1-14
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
  lines.push('# National Liver Failure League — League Context');
  lines.push('');
  lines.push('## League Identity');
  lines.push('This is a 12-team PPR fantasy football league called the **National Liver Failure League (NFLL)**.');
  lines.push('The tone is competitive, trash-talky, and irreverent. Roasting is expected and encouraged.');
  lines.push('');
  lines.push('## League Rules & Structure');
  lines.push('- 12 teams, PPR scoring');
  lines.push('- Regular season: weeks 1-14');
  lines.push('- Playoffs: weeks 15-17, top 6 teams');
  lines.push('- **Champion**: wins the playoff bracket');
  lines.push('- **Last Place Award**: worst record through week 14');
  lines.push('- **Draft Order Bowl**: bottom 6 teams; winner sets next season\'s draft order');
  lines.push('');
  lines.push('## Roster Settings (2024+)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×2, K×1, DEF×1, BN×6 — 17 rounds');
  lines.push('');
  lines.push('## Roster Settings (2023)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×1, K×1, DEF×1, BN×7 — 16 rounds');
  lines.push('');
  lines.push('## Managers');
  const users = managersSnapshot?.users || {};
  Object.entries(users).forEach(([, user]) => { lines.push(`- **${user.display_name}**`); });
  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR**: Points Above Replacement');
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round');
  lines.push('- **Lineup IQ**: actual pts ÷ max possible pts');
  lines.push('- **SOS**: Strength of Schedule');
  lines.push('- **Luck**: actual win% minus expected win% based on weekly score vs all other scores');
  lines.push('- **Manager Grade**: Draft 40% + Trades 20% + Waivers 20% + Lineup IQ 20%, z-score, C = league average');
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

  lines.push(`# ${year} Season — Full Data`);
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
  else                              lines.push('- 🎯 **Draft Order Bowl Winner**: Not available (consolation bracket)');

  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA | Diff | Playoffs? |');
  lines.push('|------|---------|---|---|---|----|----|------|-----------|');

  const sortedStandings = [...(standings || [])].sort((a, b) => {
    const wa = a.regularSeason?.wins || 0;
    const wb = b.regularSeason?.wins || 0;
    if (wb !== wa) return wb - wa;
    return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
  });

  sortedStandings.forEach((team, idx) => {
    const rs   = team.regularSeason || {};
    const diff = (rs.fptsFor || 0) - (rs.fptsAgainst || 0);
    const made = (team.finalPlacement || 99) <= 6 ? '✓ Playoffs' : 'Loser Bowl';
    lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} | ${signedFp(diff)} | ${made} |`);
  });

  lines.push('');
  lines.push('## Manager Grades');
  lines.push('*C = league average. Weights: Draft 40% · Trades 20% · Waivers 20% · Lineup IQ 20%*');
  lines.push('');
  lines.push('| Manager | Overall | Draft | Trades | Waivers | Lineup IQ |');
  lines.push('|---------|---------|-------|--------|---------|-----------|');

  const activeIds = sortedStandings.map(t => t.managerId).filter(Boolean);
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

  lines.push('# NFLL All-Time League History');
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

  lines.push(`# ${year} — Week ${week} Data`);
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
    lines.push(`- **${winner} ${fp(wScore)}** def. ${loser} ${fp(lScore)} (margin: ${fp(Math.abs(wScore-lScore))})`);
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
    lines.push('## Waiver Moves This Week (sorted by value)');
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

  lines.push(`# ${year} NFLL Pre-Draft Package`);
  lines.push('');

  lines.push('## Pre-Draft Power Rankings');
  lines.push('*Formula: 60% all-time manager grade + 20% prior regular season standing + 20% prior post-season standing.*');
  lines.push('*These are pre-computed — use them directly.*');
  lines.push('');

  if (preSeasonRankings?.rankings?.length) {
    lines.push('| Rank | Manager | All-Time | Draft | Trades | Waivers | Lineup IQ | Prior Reg | Prior Post |');
    lines.push('|------|---------|----------|-------|--------|---------|-----------|-----------|------------|');
    preSeasonRankings.rankings.forEach(team => {
      const regRank  = team.isFirstSeason ? '(new)' : team.prevRegRank  != null ? `#${team.prevRegRank}`  : '—';
      const postRank = team.isFirstSeason ? '(new)' : team.prevPostRank != null ? `#${team.prevPostRank}` : '—';
      lines.push(`| #${team.rank} | ${mn(team.managerId)} | ${toLetter(team.mgrGrade)} | ${toLetter(team.avgNormDraft)} | ${toLetter(team.avgNormTrade)} | ${toLetter(team.avgNormWaiver)} | ${toLetter(team.avgNormLineup)} | ${regRank} | ${postRank} |`);
    });
  } else {
    lines.push('*Load Manager Grades and compute Power Rankings before exporting.*');
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

export const PROMPTS = {
  preDraftRecap: `
You are writing the Pre-Draft Preview article for the National Liver Failure League (NFLL) newsletter.

TONE: Raunchy, unhinged, trash-talky fantasy football banter. This is a group of friends who roast each other relentlessly. Think Fantasy Football meets The Roast of Your Worst Enemy. Use profanity sparingly but effectively. Name names, call people out, be specific with data.

LETTER GRADES ONLY — never use numbers like 87.3 or 64.2.

DO NOT repeat season recap content in the storylines section. Storylines must be FORWARD-LOOKING.

The Pre-Draft Power Rankings table is PRE-COMPUTED. Copy it directly — do not recalculate.

ARTICLE STRUCTURE:

**1. Opening** (2-3 sentences — punchy, set the scene)

**2. 2025 Season Recap** (~300 words)
- Who won, who was last, who won the Draft Order Bowl
- 3-4 biggest statistical stories backed by specific numbers
- Brief callbacks to 2024/2023 patterns

**3. All-Time Superlatives** (~200 words)
Using all-time data, award titles: Best Drafter, Trade Shark, Waiver Wizard, Luckiest Schedule, Lineup Idiot, Most Consistent, etc.

**4. Storylines Heading Into the Draft** (~200 words)
3-4 FORWARD-LOOKING storylines ONLY — draft position leverage, redemption arcs, positional runs to watch, historical weaknesses to exploit.

**5. Pre-Draft Power Rankings**
Copy the pre-computed table exactly, then 1-2 sentences of spicy commentary per manager referencing their component grades and prior season finish.
`.trim(),

  draftGrades: `
You are grading the just-completed NFLL draft for the newsletter.

TONE: Opinionated, savage, analytically-backed. Give real letter grades, drag people who deserved it. Reference prior draft grades to identify patterns.

LETTER GRADES ONLY.

For each manager:
- Letter grade (A+ through F)
- 2-3 sentences: key picks, value vs reaches, positional strategy, historical tendencies
- One bold prediction

Finish with: best draft, worst draft, and one sleeper pick that could make everyone look stupid.
`.trim(),

  weeklyRecap: `
You are writing the weekly recap for the NFLL newsletter.

TONE: Fun, specific, trash-talky. Include exact scores — "lost by 0.4 points" is funnier than "lost by a small margin."

STRUCTURE:
1. Funny intro (2-3 sentences)
2. Matchup recaps (2-4 sentences per game — include scores, roast the loser)
3. Best waiver move of the week (use PAR data)
4. Worst waiver move of the week
5. Power rankings (copy table, 1-sentence commentary per team noting movement)
6. Next week previews (1-2 sentences per game)

Trades listed have NO grades until season end — list them factually only.
`.trim(),

  endOfSeasonRecap: `
You are writing the End of Season Recap for the NFLL newsletter.

TONE: Definitive, retrospective, analytically savage. Every claim backed by a number. LETTER GRADES ONLY.

STRUCTURE:
1. Season narrative (~200 words) — arc, turning points, who rose/fell
2. Final outcomes — Champion, runner-up, last place, Draft Order Bowl winner (2-3 sentences each, full roast for last place)
3. Best trades (top 3 by PAR)
4. Worst trades (bottom 3 by PAR)
5. Best waiver pickup of the season
6. Draft report card — whose draft held up? Reference specific busts and steals by name.
7. Season awards: Best Manager, Most Improved, Luckiest Schedule, Lineup Genius, Annual Clown Award

All grades in the data are letter grades.
`.trim()
};
