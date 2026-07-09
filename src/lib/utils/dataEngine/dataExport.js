// dataExport.js
//
// Serializes computed league data into Markdown for Claude Projects.
// Always 4 files, always overwrite. Never accumulate.

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Converts a 0-100 z-score normalized grade to a letter grade.
 * Anchored so that 50 (league average) = C.
 * ±1 std dev (25 points) spans roughly two full letter grades.
 *
 *  75+ = A+   (top ~2% of performances)
 *  70+ = A
 *  65+ = A-
 *  62+ = B+
 *  58+ = B    (+1/3 std dev above avg)
 *  55+ = B-
 *  52+ = C+
 *  48+ = C    (league average band)
 *  45+ = C-
 *  42+ = D+
 *  38+ = D    (-1/3 std dev below avg)
 *  35+ = D-
 *  below 35 = F  (significantly below average)
 */
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
 * Derives season outcomes from standings and weeklyResults.
 * Returns { champion, runnerUp, regularSeasonLoser, thirdPlace }
 * with managerId and display name for each.
 *
 * regularSeasonLoser = worst record through week 14 only (not playoff performance).
 * loserBracketWinner = manager with finalPlacement closest to 7 among non-playoff teams
 * (best finish among the bottom 6). This is the Draft Order Bowl winner.
 */
function deriveSeasonOutcomes(standings, weeklyResults, snap) {
  if (!standings || standings.length === 0) return null;

  const mn = (id) => mgrName(id, snap);

  // Final placement from the enriched standings
  const sorted = [...standings].sort((a, b) => (a.finalPlacement || 99) - (b.finalPlacement || 99));

  const champion    = sorted.find(t => t.finalPlacement === 1);
  const runnerUp    = sorted.find(t => t.finalPlacement === 2);
  const thirdPlace  = sorted.find(t => t.finalPlacement === 3);

  // Loser bracket winner: best final placement among teams 7-12
  // (6 playoff teams = places 1-6; loser bracket = 7-12, winner = place 7)
  const loserBracketWinner = sorted.find(t => t.finalPlacement === 7);

  // Regular season loser: worst record through weeks 1-14
  const regularOnly = weeklyResults.filter(r => !r.isPlayoffs && r.week <= 14);
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
        managerId:   mgrId,
        displayName: mn(mgrId),
        wins:   rec.wins,
        losses: rec.losses,
        ties:   rec.ties,
        pf:     rec.pf
      };
    }
  });

  return {
    champion:          champion ? { managerId: champion.managerId, displayName: mn(champion.managerId), finalPlacement: 1 } : null,
    runnerUp:          runnerUp ? { managerId: runnerUp.managerId, displayName: mn(runnerUp.managerId) } : null,
    thirdPlace:        thirdPlace ? { managerId: thirdPlace.managerId, displayName: mn(thirdPlace.managerId) } : null,
    loserBracketWinner: loserBracketWinner ? { managerId: loserBracketWinner.managerId, displayName: mn(loserBracketWinner.managerId) } : null,
    regularSeasonLoser
  };
}

// ── League context (upload once) ──────────────────────────────────────────────

export function exportLeagueContext(managersSnapshot) {
  const lines = [];
  lines.push('# National Liver Failure League — League Context');
  lines.push('');
  lines.push('## League Identity');
  lines.push('This is a 12-team PPR fantasy football league called the **National Liver Failure League (NFLL)**.');
  lines.push('The tone of the league is competitive, trash-talky, and irreverent. Roasting is expected and encouraged.');
  lines.push('');
  lines.push('## League Rules & Structure');
  lines.push('- 12 teams, PPR scoring (1 point per reception)');
  lines.push('- Regular season: weeks 1-14 (used for standings, power rankings, and seeding)');
  lines.push('- Playoffs: weeks 15-17, top 6 teams');
  lines.push('- **Champion**: wins the playoff bracket');
  lines.push('- **Last Place Award**: worst record through week 14 (regular season loser)');
  lines.push('- **Draft Order Bowl**: bottom 6 teams compete in a consolation bracket; winner gets to set next season\'s draft order');
  lines.push('');
  lines.push('## Roster Settings (2024 onward)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×2 (RB/WR/TE), K×1, DEF×1, BN×6 — 17 rounds');
  lines.push('');
  lines.push('## Roster Settings (2023)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×1 (RB/WR/TE), K×1, DEF×1, BN×7 — 16 rounds');
  lines.push('');
  lines.push('## Managers');
  const users = managersSnapshot?.users || {};
  Object.entries(users).forEach(([id, user]) => {
    lines.push(`- **${user.display_name}**`);
  });
  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR**: Points Above Replacement — how much a player/pickup/trade exceeded a freely available alternative');
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round, accounting for positional scarcity and historical round averages');
  lines.push('- **Lineup IQ**: actual pts scored ÷ maximum possible pts. Higher = better lineup decisions each week');
  lines.push('- **SOS**: Strength of Schedule — avg opponent scoring and win % faced');
  lines.push('- **Luck**: actual win% minus expected win% (based on weekly score vs all other scores). Positive = won more than deserved');
  lines.push('- **Manager Grade**: weighted blend of Draft (40%), Trades (20%), Waivers (20%), Lineup IQ (20%)');
  lines.push('  - Normalized as letter grades (A+ through F), where C = league average');
  lines.push('  - Zero activity in a category = C (neutral), not penalized');

  return lines.join('\n');
}

// ── Season stats export ───────────────────────────────────────────────────────

export function exportSeasonStats({
  year,
  standings,
  weeklyResults,
  seasonManagerGrades,
  seasonSOS,
  draftEndOfSeasonGrade,
  managerTradePAR,
  managerWaiverPAR,
  managerLineupIQ,
  rosterStats,
  managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];
  const outcomes = deriveSeasonOutcomes(standings, weeklyResults, managersSnapshot);

  lines.push(`# ${year} Season — Full Data`);
  lines.push('');

  // ── Season outcomes (prominent — LLM needs this to avoid speculation) ──────
  lines.push('## Season Outcomes');
  lines.push('*These are derived from final placements and regular-season records.*');
  lines.push('');
  if (outcomes?.champion) {
    lines.push(`- 🏆 **Champion**: ${outcomes.champion.displayName}`);
  } else {
    lines.push('- 🏆 **Champion**: Not yet determined (season may be in progress)');
  }
  if (outcomes?.runnerUp) {
    lines.push(`- 🥈 **Runner-Up**: ${outcomes.runnerUp.displayName}`);
  }
  if (outcomes?.thirdPlace) {
    lines.push(`- 🥉 **Third Place**: ${outcomes.thirdPlace.displayName}`);
  }
  if (outcomes?.regularSeasonLoser) {
    const l = outcomes.regularSeasonLoser;
    lines.push(`- 💀 **Regular Season Last Place** (worst record wks 1-14): ${l.displayName} (${l.wins}-${l.losses}${l.ties > 0 ? `-${l.ties}` : ''}, ${fp(l.pf)} pts)`);
  }
  if (outcomes?.loserBracketWinner) {
    lines.push(`- 🎯 **Draft Order Bowl Winner** (sets next season's draft order): ${outcomes.loserBracketWinner.displayName}`);
  } else {
    lines.push('- 🎯 **Draft Order Bowl Winner**: Not available in data (consolation bracket result)');
  }

  // ── Final standings ───────────────────────────────────────────────────────
  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA | Diff | Seed |');
  lines.push('|------|---------|---|---|---|----|----|------|------|');

  const sortedStandings = [...(standings || [])].sort((a, b) => {
    const wa = a.regularSeason?.wins || 0;
    const wb = b.regularSeason?.wins || 0;
    if (wb !== wa) return wb - wa;
    return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
  });

  sortedStandings.forEach((team, idx) => {
    const rs   = team.regularSeason || {};
    const diff = (rs.fptsFor || 0) - (rs.fptsAgainst || 0);
    const madePlayoffs = (team.finalPlacement || 99) <= 6 ? '✓ Playoffs' : 'Loser Bowl';
    lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} | ${signedFp(diff)} | ${madePlayoffs} |`);
  });

  // ── Manager grades ────────────────────────────────────────────────────────
  lines.push('');
  lines.push('## Manager Grades');
  lines.push('*Grades are letter grades (C = league average). Weights: Draft 40% · Trades 20% · Waivers 20% · Lineup IQ 20%*');
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
  lines.push('### Raw Component Values (for context)');
  lines.push('');
  lines.push('| Manager | Draft Adj PAR | Trade PAR | Waiver PAR | Lineup IQ% |');
  lines.push('|---------|---------------|-----------|------------|------------|');

  activeIds.forEach(id => {
    const g = seasonManagerGrades?.[id];
    if (!g) return;
    lines.push(`| ${mn(id)} | ${g.rawDraftPAR!=null?signedFp(g.rawDraftPAR):'—'} | ${g.rawTradePAR!=null?signedFp(g.rawTradePAR):'—'} | ${g.rawWaiverPAR!=null?signedFp(g.rawWaiverPAR):'—'} | ${g.rawLineupIQ!=null?pct(g.rawLineupIQ):'—'} |`);
  });

  // ── Strength of schedule ──────────────────────────────────────────────────
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

  // ── Draft grades ──────────────────────────────────────────────────────────
  if (draftEndOfSeasonGrade) {
    lines.push('');
    lines.push('## Post-Season Draft Grades');
    lines.push(`*Baseline seasons: ${draftEndOfSeasonGrade.baselineSeasons?.join(', ')}. Adjusted PAR = how much each manager outperformed/underperformed historical round expectations.*`);
    lines.push('');
    lines.push('| Rank | Manager | Grade | Adj PAR | Best Pick | Worst Pick | Injured Picks |');
    lines.push('|------|---------|-------|---------|-----------|------------|---------------|');

    draftEndOfSeasonGrade.teamRankings?.forEach((team, idx) => {
      const bp = team.bestPick;
      const wp = team.worstPick;
      lines.push(`| #${idx+1} | ${mn(team.managerId)} | **${team.grade}** | ${signedFp(team.totalAdjustedPAR)} | ${bp?`${bp.playerName} R${bp.round} (${signedFp(bp.adjustedPAR)})`:'-'} | ${wp?`${wp.playerName} R${wp.round} (${signedFp(wp.adjustedPAR)})${wp.injuryFlag?' 🤕':''}`:'-'} | ${team.injured.length||0} |`);
    });

    lines.push('');
    lines.push('### Top Draft Steals');
    (draftEndOfSeasonGrade.leagueTopSteals||[]).slice(0,5).forEach((p,i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}, Pick #${p.pickNo}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, scored ${fp(p.actualPts)} pts`);
    });

    lines.push('');
    lines.push('### Biggest Draft Busts');
    (draftEndOfSeasonGrade.leagueTopBusts||[]).slice(0,5).forEach((p,i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}, Pick #${p.pickNo}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}${p.injuryFlag?' [INJURY-AFFECTED]':''}, scored ${fp(p.actualPts)} pts`);
    });
  }

  // ── Lineup IQ ─────────────────────────────────────────────────────────────
  if (rosterStats) {
    lines.push('');
    lines.push('## Lineup IQ (Optimal Lineup Management)');
    lines.push('*How close did each manager get to starting their best possible lineup every week?*');
    lines.push('');
    lines.push('| Manager | Points Scored | Max Possible | Efficiency | Grade |');
    lines.push('|---------|---------------|--------------|------------|-------|');

    activeIds
      .map(id => ({ id, data: rosterStats[id]?.[String(year)] }))
      .filter(({data}) => data)
      .sort((a,b) => (b.data.lineupIQ||0) - (a.data.lineupIQ||0))
      .forEach(({id, data}) => {
        const g = seasonManagerGrades?.[id];
        lines.push(`| ${mn(id)} | ${fp(data.fpts)} | ${fp(data.ppts)} | ${pct(data.lineupIQ)} | ${toLetter(g?.normLineup)} |`);
      });
  }

  return lines.join('\n');
}

// ── All-time history export ───────────────────────────────────────────────────

export function exportAllTimeHistory({
  allTimeManagerGrades,
  allTimeSOS,
  seasonManagerGrades,
  seasonSOSByYear,
  allDrafts,
  draftGradesByYear,
  managerTradePARBySeason,
  managerWaiverPARBySeason,
  managers,
  managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push('# NFLL All-Time League History');
  lines.push('*All grades shown as letter grades (C = league average for that season)*');
  lines.push('');

  // ── All-time manager grades ───────────────────────────────────────────────
  lines.push('## All-Time Manager Grades');
  lines.push('');
  lines.push('| Manager | Overall | Draft | Trades | Waivers | Lineup IQ | Seasons |');
  lines.push('|---------|---------|-------|--------|---------|-----------|---------|');

  Object.entries(allTimeManagerGrades)
    .sort(([,a],[,b]) => (b.allTimeGrade??-1) - (a.allTimeGrade??-1))
    .forEach(([id, data]) => {
      lines.push(`| ${mn(id)} | **${toLetter(data.allTimeGrade)}** | ${toLetter(data.avgNormDraft)} | ${toLetter(data.avgNormTrade)} | ${toLetter(data.avgNormWaiver)} | ${toLetter(data.avgNormLineup)} | ${data.years?.join(', ')} |`);
    });

  // Per-season grade breakdown
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

  // ── All-time SOS ──────────────────────────────────────────────────────────
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

  // ── Career records ────────────────────────────────────────────────────────
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
    .forEach(({id, rs, champs, last, seasons}) => {
      lines.push(`| ${mn(id)} | ${seasons} | ${rs.wins} | ${rs.losses} | ${rs.ties} | ${fp(rs.pf)} | ${fp(rs.pa)} | ${champs||'0'} | ${last||'0'} |`);
    });

  // ── Draft history ─────────────────────────────────────────────────────────
  if (Object.keys(draftGradesByYear).length > 0) {
    lines.push('');
    lines.push('## Draft Performance by Season (Adjusted PAR)');
    lines.push('*Positive = outperformed historical round expectations. Negative = underperformed.*');
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

  // ── Trade/waiver history ──────────────────────────────────────────────────
  const txYears = [...new Set([
    ...Object.keys(managerTradePARBySeason||{}),
    ...Object.keys(managerWaiverPARBySeason||{})
  ])].sort((a,b) => Number(a)-Number(b));

  if (txYears.length > 0) {
    lines.push('');
    lines.push('## Trade PAR by Season');
    lines.push('*Total Points Above Replacement gained through trades each season.*');
    lines.push('');
    const tHeader = ['| Manager', ...txYears, '|'].join(' | ');
    const tSep    = ['|--------', ...txYears.map(()=>'------'), '|'].join('|');
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
    lines.push('*Total Points Above Replacement gained through waiver pickups each season.*');
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

export function exportWeeklyData({
  year,
  week,
  weeklyResults,
  gradedTransactions,
  currentStandings,
  powerRankings,
  previousPowerRankings,
  nextWeekMatchups,
  managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# ${year} — Week ${week} Data`);
  lines.push('');

  // ── Matchup results ───────────────────────────────────────────────────────
  lines.push(`## Week ${week} Results`);
  lines.push('');
  const seen = new Set();
  const matchups = [];
  (weeklyResults||[]).filter(r => !r.isPlayoffs).forEach(r => {
    const key = [r.managerId, r.opponentManagerId].sort().join('-');
    if (!seen.has(key)) { seen.add(key); matchups.push(r); }
  });

  matchups.forEach(r => {
    const winner = r.result === 'W' ? mn(r.managerId)         : mn(r.opponentManagerId);
    const loser  = r.result === 'W' ? mn(r.opponentManagerId) : mn(r.managerId);
    const wScore = r.result === 'W' ? r.pointsFor    : r.pointsAgainst;
    const lScore = r.result === 'W' ? r.pointsAgainst : r.pointsFor;
    const margin = Math.abs(wScore - lScore);
    lines.push(`- **${winner} ${fp(wScore)}** def. ${loser} ${fp(lScore)} (margin: ${fp(margin)})`);
  });

  // ── Waiver moves ──────────────────────────────────────────────────────────
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
      lines.push(`- **${mn(tx.managerIds?.[0])}**: +${g.name} (${g.position})${g.droppedName?` / -${g.droppedName}`:''} — ${signedFp(g.par)} PAR vs replacement (${g.repName}), ${g.gradeLabel}`);
    });

    lines.push('');
    lines.push(`Best pickup: **${mn(sorted[0].managerIds?.[0])}** added ${sorted[0].grade.name} (${signedFp(sorted[0].grade.par)} PAR)`);
    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1];
      lines.push(`Worst pickup: **${mn(worst.managerIds?.[0])}** added ${worst.grade.name} (${signedFp(worst.grade.par)} PAR)`);
    }
  }

  // ── Trades ────────────────────────────────────────────────────────────────
  const weekTrades = (gradedTransactions||[]).filter(tx =>
    tx.type === 'trade' && !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey||tx.season) === String(year)
  );

  if (weekTrades.length > 0) {
    lines.push('');
    lines.push('## Trades This Week');
    lines.push('*(Grades only available end of season)*');
    lines.push('');
    weekTrades.forEach(tx => {
      lines.push(`- **${mn(tx.managerIds?.[0])} ↔ ${mn(tx.managerIds?.[1])}**`);
    });
  }

  // ── Standings ─────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(`## Standings Through Week ${week}`);
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA |');
  lines.push('|------|---------|---|---|---|----|----|');
  (currentStandings||[]).forEach((team, idx) => {
    const rs = team.regularSeason || {};
    lines.push(`| #${idx+1} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} |`);
  });

  // ── Power rankings ────────────────────────────────────────────────────────
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
  }

  // ── Next week matchups ────────────────────────────────────────────────────
  if (nextWeekMatchups?.length) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${week+1})`);
    lines.push('');
    nextWeekMatchups.forEach(m => {
      lines.push(`- **${mn(m.home)}** vs **${mn(m.away)}**`);
    });
  }

  return lines.join('\n');
}

// ── Pre-draft package export ──────────────────────────────────────────────────

export function exportPreDraftPackage({
  year,
  allTimeExport,
  latestSeasonExport,
  preSeasonRankings,
  managersSnapshot
}) {
  const mn    = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# ${year} NFLL Pre-Draft Package`);
  lines.push('');
  lines.push(`*This file contains everything needed to write the ${year} pre-draft preview and post-draft analysis.*`);
  lines.push('');

  // ── Pre-draft power rankings (computed, not empty) ────────────────────────
  lines.push('## Pre-Draft Power Rankings');
  lines.push('*Formula: 60% all-time manager grade + 40% prior season final placement (converted to 0-100 scale).*');
  lines.push('*These are the actual computed rankings — use them directly, do not recalculate.*');
  lines.push('');

  if (preSeasonRankings?.rankings?.length) {
    lines.push('| Rank | Manager | Score | All-Time Grade | Prior Season Finish |');
    lines.push('|------|---------|-------|----------------|---------------------|');
    preSeasonRankings.rankings.forEach(team => {
      const gradeStr  = team.mgrGrade != null ? toLetter(team.mgrGrade) : '—';
      const placement = team.prevPlacement != null ? `#${team.prevPlacement}` : '(first season)';
      lines.push(`| #${team.rank} | ${mn(team.managerId)} | ${fp(team.score)} | ${gradeStr} | ${placement} |`);
    });
  } else {
    lines.push('*Pre-draft rankings not computed. Load Manager Grades and compute Power Rankings before exporting.*');
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
You are writing the Pre-Draft Preview article for the National Liver Failure League (NFLL) newsletter.

TONE: Raunchy, unhinged, trash-talky fantasy football banter. This is a group of friends who roast each other relentlessly. Think Fantasy Football meets The Roast of Your Worst Enemy. Use profanity sparingly but effectively. Name names, call people out, and be specific with the data. "Your team was statistically a disaster" hits harder than "you didn't perform well."

IMPORTANT FORMATTING RULES:
- Use letter grades ONLY (A, B+, C-, F, etc.) — never use numbers like 87.3 or 64.2
- Do NOT repeat the season recap content in the storylines section — storylines going into next season should be FORWARD-LOOKING: draft position, redemption arcs, who needs to prove something, roster construction questions, etc.
- The Pre-Draft Power Rankings table is PRE-COMPUTED and included in the data. Copy it directly — do not recalculate it.

ARTICLE STRUCTURE:

**1. Opening (2-3 sentences)**
Set the scene. The NFLL offseason is here. Make it punchy.

**2. 2025 Season Recap (~300 words)**
- Who won, who lost, who was last place
- Champion gets credit, last place gets roasted
- Draft Order Bowl winner (sets draft order) — contextually important
- 3-4 biggest statistical stories backed by specific numbers from the data
- Brief reference to 2024/2023 patterns where relevant

**3. All-Time Superlatives (~200 words)**
Using the all-time data, award titles like:
- Best Drafter of All Time (highest draft grades)
- The Trade Shark (best trade PAR)
- Waiver Wire Wizard (best waiver PAR)
- Most Delusional (worst grades but confident personality — use data)
- Luckiest Schedule (SOS luck metric)
- The Lineup Idiot (worst lineup IQ)
- Make up 1-2 additional ones based on what's interesting in the data

**4. Storylines Heading Into the Draft (~200 words)**
3-4 FORWARD-LOOKING storylines ONLY — things to watch in the upcoming draft, not rehashes of last season. Examples: who has draft position leverage, who needs to bounce back, positional runs to watch, managers with historical weaknesses to exploit.

**5. Pre-Draft Power Rankings**
Copy the pre-computed table exactly as given, then write 1-2 sentences of spicy commentary per manager. Reference their all-time grade and prior season finish. Be honest — if someone has consistently been mediocre, say it.

Use the attached pre_draft.md (which contains last season's full data and all-time history). All grades in the data are letter grades.
`.trim(),

  draftGrades: `
You are grading the just-completed fantasy draft for the NFLL newsletter.

TONE: Opinionated, savage, analytically-backed. Give real letter grades, drag people who deserved it, hype up anyone who actually looked smart. Reference prior season draft grades to identify patterns (e.g., "This is the third straight year he reached for a QB in round 4").

LETTER GRADES ONLY — never use numbers.

For each manager write:
- Letter grade (A+ through F)
- 2-3 sentences: key picks, value vs reaches, positional strategy, historical tendencies
- One bold prediction based on their specific draft

Finish with:
- Best draft in the room and why
- Worst draft in the room and the specific pick that doomed them
- One sleeper pick that could make a fool of everyone's grade

Use the attached pre_draft.md for draft history context and current draft picks.
`.trim(),

  weeklyRecap: `
You are writing the Week [X] recap for the NFLL newsletter.

TONE: Fun, specific, trash-talky between friends. Include exact scores — "lost by 0.4 points" is funnier and more painful than "lost by a small margin." Reference specific players who blew up or flopped.

STRUCTURE:
1. **Funny Intro** (2-3 sentences — reference something absurd from the week's games)
2. **Matchup Recaps** (2-4 sentences per game — winner gets credit, loser gets roasted, include scores)
3. **Best Waiver Move of the Week** (use the PAR data — who added the most value above replacement? Explain why it matters)
4. **Worst Waiver Move of the Week** (lowest PAR pickup — roast appropriately)
5. **Power Rankings** (copy the table, then 1-sentence commentary per team noting movement — ↑ is good, ↓ is bad)
6. **Next Week Previews** (1-2 sentences per game — who has the edge and why, add trash talk)

Note: trades listed in the data have NO grades available until season end — just list them factually.

Use current_week.md for all data. League context is in league_context.md.
`.trim(),

  endOfSeasonRecap: `
You are writing the End of Season Recap for the NFLL newsletter.

TONE: Definitive, retrospective, analytically savage. This is the permanent record. Every claim should be backed by a number. Letter grades only.

STRUCTURE:
1. **Season Narrative** (~200 words) — How did the season unfold? Who was dominant, who collapsed, what were the turning points?

2. **Final Outcomes** — Champion, runner-up, last place, Draft Order Bowl winner. Each gets 2-3 sentences. Champion gets credit. Last place gets the full roast treatment.

3. **Best Trades of the Season** (top 3 by PAR) — Name the trade, who won it, by how much

4. **Worst Trades of the Season** (bottom 3 by PAR) — Name the trade, who got fleeced, and how badly

5. **Best Waiver Pickup** — Must have been started at least once. Highest PAR above replacement.

6. **Draft Report Card** — Whose draft held up? Whose fell apart? Use the draft grades. Reference specific busts and steals by name.

7. **Season Awards**
- 🏆 Best Manager (data-backed, not just who won)
- 📈 Most Improved
- 🍀 Luckiest Schedule
- 🧠 Lineup Genius (best IQ)
- 🤡 The Annual Clown Award (worst grades, most embarrassing stat line — be specific)
- 🎯 Best Trade of the Year (single transaction)

8. **Final Stats Summary** (standings table as-is)

Use all attached files. All grades are letter grades.
`.trim()
};
