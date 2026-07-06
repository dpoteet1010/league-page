// dataExport.js
//
// Serializes computed league data into Markdown files for upload to
// Claude Projects. Each export function targets a specific article type.
//
// Workflow:
//   1. Load all data in the UI (transactions, drafts, manager grades, SOS, etc.)
//   2. Call the relevant export function
//   3. Copy the Markdown output
//   4. Upload to your Claude Project as a .md file
//   5. Prompt Claude with the article-specific prompt from PROMPTS below

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
function rank(n) { return `#${n}`; }
function mgrName(managerId, snap) {
  return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
}

// ── League context (upload once, rarely changes) ──────────────────────────

/**
 * Generates a static league context file describing the league rules,
 * scoring, roster settings, and manager roster. Upload this once and
 * keep it in every Project.
 */
export function exportLeagueContext(managersSnapshot, leagueSettings = {}) {
  const lines = [];
  lines.push('# Fantasy Football League Context');
  lines.push('');
  lines.push('## League Rules');
  lines.push('- 12 teams, PPR scoring');
  lines.push('- Regular season: weeks 1-14');
  lines.push('- Playoffs: weeks 15-17 (top 6 teams)');
  lines.push('- Loser bracket: bottom 6 teams compete for Draft Order Bowl (winner sets draft order)');
  lines.push('- Loser of regular season (worst record/points through week 14) = last place');
  lines.push('');
  lines.push('## Roster Settings (2024+)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×2 (RB/WR/TE), K×1, DEF×1, BN×6');
  lines.push('Rounds: 17');
  lines.push('');
  lines.push('## Roster Settings (2023)');
  lines.push('QB×1, RB×2, WR×2, TE×1, FLEX×1 (RB/WR/TE), K×1, DEF×1, BN×7');
  lines.push('Rounds: 16');
  lines.push('');
  lines.push('## Managers');

  const users = managersSnapshot?.users || {};
  Object.entries(users).forEach(([id, user]) => {
    lines.push(`- **${user.display_name}** (ID: ${id})`);
  });

  lines.push('');
  lines.push('## Metrics Glossary');
  lines.push('- **PAR (Points Above Replacement)**: how much a player/pickup/trade exceeded what a freely available replacement would have scored');
  lines.push('- **Adjusted PAR (draft)**: actual PAR minus the historical expected PAR for that draft round — accounts for positional scarcity AND round expectations');
  lines.push('- **Lineup IQ**: actual points scored ÷ maximum possible points (ppts). Higher = better lineup decisions');
  lines.push('- **SOS (Strength of Schedule)**: how tough your opponents were, measured by their average scoring and final win %');
  lines.push('- **Luck**: your actual win% minus expected win% based on your score vs all other scores each week. Positive = won more than your scoring deserved');
  lines.push('- **Manager Grade**: weighted blend of draft (40%), trades (20%), waivers (20%), lineup IQ (20%), z-score normalized so 50 = league average');

  return lines.join('\n');
}

// ── Season stats export ───────────────────────────────────────────────────

/**
 * Full season stats export — all metrics for one season.
 * Upload as season_YYYY_stats.md
 */
export function exportSeasonStats({
  year,
  standings,                    // enriched standings with managerId
  weeklyResults,
  seasonManagerGrades,          // { [managerId]: gradeResult }
  seasonSOS,                    // { [managerId]: sosResult }
  draftEndOfSeasonGrade,        // gradeDraftEndOfSeason output
  managerTradePAR,              // { [managerId]: total }
  managerWaiverPAR,
  managerLineupIQ,
  rosterStats,                  // { [managerId]: { fpts, ppts, lineupIQ } }
  playoffResults,               // optional { winner, loserBracketWinner, regularSeasonLoser }
  managersSnapshot
}) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# ${year} Season — Full Stats & Metrics`);
  lines.push('');

  // ── Final standings ────────────────────────────────────────────────────
  lines.push('## Final Standings (Regular Season, Weeks 1-14)');
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA | Diff |');
  lines.push('|------|---------|---|---|---|----|----|------|');

  const sorted = [...(standings || [])].sort((a, b) => {
    const wa = a.regularSeason?.wins || 0;
    const wb = b.regularSeason?.wins || 0;
    if (wb !== wa) return wb - wa;
    return (b.regularSeason?.fptsFor || 0) - (a.regularSeason?.fptsFor || 0);
  });

  sorted.forEach((team, idx) => {
    const rs = team.regularSeason || {};
    const diff = (rs.fptsFor || 0) - (rs.fptsAgainst || 0);
    lines.push(`| ${rank(idx+1)} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} | ${signedFp(diff)} |`);
  });

  // ── Bowl results ───────────────────────────────────────────────────────
  if (playoffResults) {
    lines.push('');
    lines.push('## Season Outcomes');
    if (playoffResults.champion) lines.push(`- 🏆 **Champion**: ${mn(playoffResults.champion)}`);
    if (playoffResults.regularSeasonLoser) lines.push(`- 💀 **Regular Season Loser** (worst record through Wk 14): ${mn(playoffResults.regularSeasonLoser)}`);
    if (playoffResults.loserBracketWinner) lines.push(`- 🎯 **Draft Order Bowl Winner** (sets next season's draft order): ${mn(playoffResults.loserBracketWinner)}`);
  }

  // ── Manager grades ─────────────────────────────────────────────────────
  lines.push('');
  lines.push('## Manager Grades (0-100, league avg = 50)');
  lines.push('');
  lines.push('| Manager | Overall | Draft | Trades | Waivers | Lineup IQ |');
  lines.push('|---------|---------|-------|--------|---------|-----------|');

  const activeIds = sorted.map(t => t.managerId).filter(Boolean);
  activeIds.forEach((id) => {
    const g = seasonManagerGrades?.[id];
    if (!g) return;
    lines.push(`| ${mn(id)} | **${fp(g.overallGrade, 0)}** | ${g.normDraft!=null?fp(g.normDraft,0):'—'} | ${fp(g.normTrade,0)} | ${fp(g.normWaiver,0)} | ${g.normLineup!=null?fp(g.normLineup,0):'—'} |`);
  });

  lines.push('');
  lines.push('### Raw PAR Values (underlying manager grade components)');
  lines.push('');
  lines.push('| Manager | Draft Adj PAR | Trade PAR | Waiver PAR | Lineup IQ% |');
  lines.push('|---------|---------------|-----------|------------|------------|');

  activeIds.forEach((id) => {
    const g = seasonManagerGrades?.[id];
    if (!g) return;
    lines.push(`| ${mn(id)} | ${g.rawDraftPAR!=null?signedFp(g.rawDraftPAR):'—'} | ${g.rawTradePAR!=null?signedFp(g.rawTradePAR):'—'} | ${g.rawWaiverPAR!=null?signedFp(g.rawWaiverPAR):'—'} | ${g.rawLineupIQ!=null?pct(g.rawLineupIQ):'—'} |`);
  });

  // ── Strength of schedule ───────────────────────────────────────────────
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

  // ── Draft grades ───────────────────────────────────────────────────────
  if (draftEndOfSeasonGrade) {
    lines.push('');
    lines.push('## Draft Grades (Post-Season)');
    lines.push(`*Baseline seasons: ${draftEndOfSeasonGrade.baselineSeasons?.join(', ')}*`);
    lines.push('');
    lines.push('| Rank | Manager | Grade | Adj PAR | Best Pick | Worst Pick | Injuries |');
    lines.push('|------|---------|-------|---------|-----------|------------|----------|');

    draftEndOfSeasonGrade.teamRankings?.forEach((team, idx) => {
      const bp = team.bestPick;
      const wp = team.worstPick;
      lines.push(`| ${rank(idx+1)} | ${mn(team.managerId)} | **${team.grade}** | ${signedFp(team.totalAdjustedPAR)} | ${bp?`${bp.playerName} R${bp.round} (${signedFp(bp.adjustedPAR)})`:'-'} | ${wp?`${wp.playerName} R${wp.round} (${signedFp(wp.adjustedPAR)})${wp.injuryFlag?' 🤕':''}`:'-'} | ${team.injured.length||0} |`);
    });

    lines.push('');
    lines.push('### Top Steals');
    (draftEndOfSeasonGrade.leagueTopSteals || []).slice(0,5).forEach((p, i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, R${p.round}, Pick ${p.pickNo}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, Actual: ${fp(p.actualPts)} pts`);
    });

    lines.push('');
    lines.push('### Biggest Busts');
    (draftEndOfSeasonGrade.leagueTopBusts || []).slice(0,5).forEach((p, i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, R${p.round}, Pick ${p.pickNo}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}${p.injuryFlag?' [INJURED]':''}, Actual: ${fp(p.actualPts)} pts`);
    });
  }

  // ── Lineup IQ ──────────────────────────────────────────────────────────
  if (rosterStats) {
    lines.push('');
    lines.push('## Lineup IQ (Points Scored vs Max Possible)');
    lines.push('');
    lines.push('| Manager | Points Scored | Max Possible | Efficiency |');
    lines.push('|---------|---------------|--------------|------------|');

    activeIds
      .map(id => ({ id, data: rosterStats[id]?.[String(year)] }))
      .filter(({ data }) => data)
      .sort((a, b) => (b.data.lineupIQ||0) - (a.data.lineupIQ||0))
      .forEach(({ id, data }) => {
        lines.push(`| ${mn(id)} | ${fp(data.fpts)} | ${fp(data.ppts)} | **${pct(data.lineupIQ)}** |`);
      });
  }

  return lines.join('\n');
}

// ── All-time history export ───────────────────────────────────────────────

/**
 * Multi-season history export covering all computed all-time metrics.
 * Upload as season_history.md — refreshed each year.
 */
export function exportAllTimeHistory({
  allTimeManagerGrades,
  allTimeSOS,
  seasonManagerGrades,        // all years
  seasonSOSByYear,
  allDrafts,
  draftGradesByYear,          // { [year]: { [managerId]: adjPAR } }
  managerTradePARBySeason,
  managerWaiverPARBySeason,
  managers,                   // from allTimeHistory.managers
  managersSnapshot
}) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push('# All-Time League History');
  lines.push('');

  // ── All-time manager grades ────────────────────────────────────────────
  lines.push('## All-Time Manager Grades');
  lines.push('*Z-score normalized per season (50 = league avg). Average of per-season grades.*');
  lines.push('');
  lines.push('| Manager | All-Time Grade | Avg Draft | Avg Trades | Avg Waivers | Avg Lineup IQ | Seasons |');
  lines.push('|---------|---------------|-----------|------------|-------------|---------------|---------|');

  Object.entries(allTimeManagerGrades)
    .sort(([,a],[,b]) => (b.allTimeGrade??-1) - (a.allTimeGrade??-1))
    .forEach(([id, data]) => {
      lines.push(`| ${mn(id)} | **${fp(data.allTimeGrade,0)}** | ${data.avgNormDraft!=null?fp(data.avgNormDraft,0):'—'} | ${data.avgNormTrade!=null?fp(data.avgNormTrade,0):'—'} | ${data.avgNormWaiver!=null?fp(data.avgNormWaiver,0):'—'} | ${data.avgNormLineup!=null?fp(data.avgNormLineup,0):'—'} | ${data.years?.join(', ')} |`);
    });

  // Per-season grade breakdown
  lines.push('');
  lines.push('### Manager Grades by Season');
  const allYears = Object.keys(seasonManagerGrades).sort((a,b) => Number(a)-Number(b));
  const headerRow = ['| Manager', ...allYears.map(y => `**${y}**`), '|'].join(' | ');
  const sepRow    = ['|--------', ...allYears.map(() => '--------'), '|'].join('|');
  lines.push(headerRow);
  lines.push(sepRow);

  Object.keys(allTimeManagerGrades).forEach((id) => {
    const row = [mn(id), ...allYears.map(y => {
      const g = seasonManagerGrades[y]?.[id];
      return g?.overallGrade != null ? fp(g.overallGrade, 0) : '—';
    })];
    lines.push('| ' + row.join(' | ') + ' |');
  });

  // ── All-time SOS ───────────────────────────────────────────────────────
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

  // ── Career records ─────────────────────────────────────────────────────
  lines.push('');
  lines.push('## Career Records');
  lines.push('');
  lines.push('| Manager | Seasons | W | L | T | PF | PA | Championships | Last Place |');
  lines.push('|---------|---------|---|---|---|----|----|---------------|------------|');

  Object.entries(managers || {})
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
      const last   = data.seasons.filter(s => s.finalPlacement === s.numRosters).length;
      return { id, rs, champs, last, seasons: data.seasons.length };
    })
    .sort((a, b) => b.rs.wins - a.rs.wins || b.rs.pf - a.rs.pf)
    .forEach(({ id, rs, champs, last, seasons }) => {
      lines.push(`| ${mn(id)} | ${seasons} | ${rs.wins} | ${rs.losses} | ${rs.ties} | ${fp(rs.pf)} | ${fp(rs.pa)} | ${champs||'—'} | ${last||'—'} |`);
    });

  // ── Draft history summary ──────────────────────────────────────────────
  if (Object.keys(draftGradesByYear).length > 0) {
    lines.push('');
    lines.push('## Draft Performance History (Adjusted PAR by Season)');
    lines.push('*Positive = outperformed historical expectations for each round*');
    lines.push('');

    const draftYears = Object.keys(draftGradesByYear).sort((a,b) => Number(a)-Number(b));
    const dHeader = ['| Manager', ...draftYears, '|'].join(' | ');
    const dSep    = ['|--------', ...draftYears.map(() => '------'), '|'].join('|');
    lines.push(dHeader);
    lines.push(dSep);

    const allMgrIds = new Set(Object.values(draftGradesByYear).flatMap(y => Object.keys(y)));
    [...allMgrIds].forEach((id) => {
      const row = [mn(id), ...draftYears.map(y => {
        const v = draftGradesByYear[y]?.[id];
        return v != null ? signedFp(v) : '—';
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });
  }

  // ── Trade/waiver history ───────────────────────────────────────────────
  lines.push('');
  lines.push('## Transaction PAR by Season');
  lines.push('*PAR = Points Above Replacement. Measures value gained vs freely available players.*');
  lines.push('');

  const txYears = [...new Set([
    ...Object.keys(managerTradePARBySeason||{}),
    ...Object.keys(managerWaiverPARBySeason||{})
  ])].sort((a,b) => Number(a)-Number(b));

  if (txYears.length > 0) {
    lines.push('### Trade PAR by Season');
    const tHeader = ['| Manager', ...txYears, '|'].join(' | ');
    const tSep    = ['|--------', ...txYears.map(() => '------'), '|'].join('|');
    lines.push(tHeader); lines.push(tSep);

    const tradeMgrs = new Set(Object.values(managerTradePARBySeason||{}).flatMap(y => Object.keys(y)));
    [...tradeMgrs].forEach((id) => {
      const row = [mn(id), ...txYears.map(y => {
        const v = managerTradePARBySeason?.[y]?.[id];
        return v != null ? signedFp(v) : '—';
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });

    lines.push('');
    lines.push('### Waiver PAR by Season');
    lines.push(tHeader); lines.push(tSep);

    const waiverMgrs = new Set(Object.values(managerWaiverPARBySeason||{}).flatMap(y => Object.keys(y)));
    [...waiverMgrs].forEach((id) => {
      const row = [mn(id), ...txYears.map(y => {
        const v = managerWaiverPARBySeason?.[y]?.[id];
        return v != null ? signedFp(v) : '—';
      })];
      lines.push('| ' + row.join(' | ') + ' |');
    });
  }

  return lines.join('\n');
}

// ── Weekly recap export ───────────────────────────────────────────────────

/**
 * This week's data: matchup results, waiver moves, standings, power rankings.
 * Upload as current_week.md — replace every week.
 */
export function exportWeeklyData({
  year,
  week,
  weeklyResults,        // all results filtered to this week
  gradedTransactions,   // all transactions — filter to this week's waivers
  currentStandings,     // standings through this week
  powerRankings,        // this week's power rankings
  previousPowerRankings, // last week's for movement
  nextWeekMatchups,     // optional — upcoming matchup pairings
  managersSnapshot
}) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# ${year} Season — Week ${week} Data`);
  lines.push(`*Generated for article use. Week ${week} of the regular season.*`);
  lines.push('');

  // ── Matchup results ────────────────────────────────────────────────────
  lines.push('## Week ${week} Matchup Results');
  lines.push('');

  const thisWeekResults = (weeklyResults || []).filter(r => r.week === week && !r.isPlayoffs);
  const seen = new Set();
  const matchups = [];
  thisWeekResults.forEach(r => {
    const key = [r.managerId, r.opponentManagerId].sort().join('-');
    if (!seen.has(key)) {
      seen.add(key);
      matchups.push(r);
    }
  });

  matchups.forEach(r => {
    const opp = thisWeekResults.find(x => x.managerId === r.opponentManagerId);
    const w = r.result === 'W' ? mn(r.managerId) : mn(r.opponentManagerId);
    const l = r.result === 'W' ? mn(r.opponentManagerId) : mn(r.managerId);
    const wScore = r.result === 'W' ? r.pointsFor : r.pointsAgainst;
    const lScore = r.result === 'W' ? r.pointsAgainst : r.pointsFor;
    lines.push(`- **${w} ${fp(wScore)}** def. ${l} ${fp(lScore)} (margin: ${fp(Math.abs(wScore-lScore))})`);
  });

  // ── Top/worst waiver pickups this week ─────────────────────────────────
  const weekWaivers = (gradedTransactions || []).filter(tx =>
    tx.type === 'waiver' &&
    !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey || tx.season) === String(year) &&
    tx.grade?.par != null
  );

  if (weekWaivers.length > 0) {
    lines.push('');
    lines.push('## Waiver Moves This Week');
    lines.push('');

    const sorted = [...weekWaivers].sort((a,b) => (b.grade?.par||0) - (a.grade?.par||0));
    lines.push('### Best Pickups');
    sorted.slice(0,3).forEach((tx,i) => {
      const g = tx.grade;
      lines.push(`${i+1}. **${g.name}** (${g.position}) picked up by ${mn(tx.managerIds?.[0])} — ${fp(g.totalPts)} pts over ${g.weeksHeld} wk(s), ${signedFp(g.par)} PAR vs replacement (${g.repName})`);
    });

    lines.push('');
    lines.push('### Worst Pickups');
    sorted.slice(-3).reverse().forEach((tx,i) => {
      const g = tx.grade;
      lines.push(`${i+1}. **${g.name}** (${g.position}) picked up by ${mn(tx.managerIds?.[0])} — ${fp(g.totalPts)} pts over ${g.weeksHeld} wk(s), ${signedFp(g.par)} PAR`);
    });

    lines.push('');
    lines.push('### All Waivers');
    weekWaivers.forEach(tx => {
      const g = tx.grade;
      lines.push(`- ${mn(tx.managerIds?.[0])}: +${g.name} (${g.position}) ${g.droppedName?`/ -${g.droppedName}`:''} — ${signedFp(g.par)} PAR, ${g.gradeLabel}`);
    });
  }

  // ── Trades this week ───────────────────────────────────────────────────
  const weekTrades = (gradedTransactions || []).filter(tx =>
    tx.type === 'trade' &&
    !tx.isPartOfComposite &&
    Number(tx.leg) === week &&
    String(tx.seasonKey || tx.season) === String(year)
  );

  if (weekTrades.length > 0) {
    lines.push('');
    lines.push('## Trades This Week');
    lines.push('*(Grades available end of season)*');
    lines.push('');
    weekTrades.forEach(tx => {
      const moves = (tx.moves || []).filter(m => Array.isArray(m));
      const received = {[tx.rosters?.[0]]: [], [tx.rosters?.[1]]: []};
      moves.forEach(move => {
        move.forEach((side, idx) => {
          if (side && typeof side === 'object' && side.type === 'trade' && side.player) {
            const roster = tx.rosters?.[idx];
            if (roster != null) (received[roster] ||= []).push(side.player);
          }
        });
      });
      lines.push(`- **${mn(tx.managerIds?.[0])} ↔ ${mn(tx.managerIds?.[1])}** (Week ${tx.leg})`);
    });
  }

  // ── Standings ──────────────────────────────────────────────────────────
  lines.push('');
  lines.push(`## Standings Through Week ${week}`);
  lines.push('');
  lines.push('| Rank | Manager | W | L | T | PF | PA |');
  lines.push('|------|---------|---|---|---|----|----|');

  (currentStandings || []).forEach((team, idx) => {
    const rs = team.regularSeason || {};
    lines.push(`| ${rank(idx+1)} | ${mn(team.managerId)} | ${rs.wins||0} | ${rs.losses||0} | ${rs.ties||0} | ${fp(rs.fptsFor)} | ${fp(rs.fptsAgainst)} |`);
  });

  // ── Power rankings ─────────────────────────────────────────────────────
  if (powerRankings) {
    lines.push('');
    lines.push(`## Power Rankings — Week ${week}`);
    lines.push(`*Phase: ${powerRankings.phase} | Weights: Record ${(powerRankings.weights.record*100).toFixed(0)}% / Pts ${(powerRankings.weights.points*100).toFixed(0)}% / Form ${(powerRankings.weights.recentForm*100).toFixed(0)}% / Mgr Grade ${(powerRankings.weights.managerGrade*100).toFixed(0)}%*`);
    lines.push('');

    const prevMap = {};
    (previousPowerRankings || []).forEach(t => { prevMap[t.managerId] = t.rank; });

    lines.push('| Rank | Δ | Manager | Record | PF | Score |');
    lines.push('|------|---|---------|--------|----|-------|');

    powerRankings.rankings.forEach(team => {
      const prev = prevMap[team.managerId];
      const mov  = prev != null ? prev - team.rank : null;
      const movStr = mov == null ? 'NEW' : mov > 0 ? `↑${mov}` : mov < 0 ? `↓${Math.abs(mov)}` : '—';
      lines.push(`| ${rank(team.rank)} | ${movStr} | ${mn(team.managerId)} | ${team.wins}-${team.losses} | ${fp(team.pf)} | ${fp(team.compositeScore)} |`);
    });
  }

  // ── Next week matchups ─────────────────────────────────────────────────
  if (nextWeekMatchups && nextWeekMatchups.length > 0) {
    lines.push('');
    lines.push(`## Next Week's Matchups (Week ${week + 1})`);
    lines.push('');
    nextWeekMatchups.forEach(m => {
      lines.push(`- **${mn(m.home)}** vs **${mn(m.away)}**`);
    });
  }

  return lines.join('\n');
}

// ── Pre-draft export ──────────────────────────────────────────────────────

/**
 * Pre-draft package: all-time history + pre-season power rankings.
 * Upload as pre_draft_YYYY.md
 */
export function exportPreDraftPackage({
  year,
  allTimeExport,        // output of exportAllTimeHistory()
  latestSeasonExport,   // output of exportSeasonStats() for most recent season
  preSeasonRankings,    // from computePreSeasonRankings()
  incomingChanges,      // string[] — free-text bullets about rule changes, new managers etc.
  managersSnapshot
}) {
  const mn = (id) => mgrName(id, managersSnapshot);
  const lines = [];

  lines.push(`# ${year} Pre-Draft Package`);
  lines.push('');
  lines.push('## Incoming Season Changes');
  (incomingChanges || ['No changes noted']).forEach(c => lines.push(`- ${c}`));

  lines.push('');
  lines.push('## Pre-Draft Power Rankings');
  lines.push('*60% all-time manager grade + 40% prior season final placement*');
  lines.push('');
  lines.push('| Rank | Manager | Score | All-Time Grade | Prior Placement |');
  lines.push('|------|---------|-------|----------------|-----------------|');

  (preSeasonRankings?.rankings || []).forEach(team => {
    lines.push(`| ${rank(team.rank)} | ${mn(team.managerId)} | ${fp(team.score)} | ${team.mgrGrade!=null?fp(team.mgrGrade,0):'—'} | ${team.prevPlacement!=null?rank(team.prevPlacement):'First season'} |`);
  });

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(latestSeasonExport || '');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(allTimeExport || '');

  return lines.join('\n');
}

// ── Prompts ────────────────────────────────────────────────────────────────

export const PROMPTS = {
  preDraftRecap: `
You are writing the Pre-Draft Preview article for a 12-team PPR fantasy football league newsletter.
Tone: analytical but entertaining, like a sports columnist who knows the data deeply.
Use the attached data files (league_context.md, season_history.md, pre_draft_YYYY.md).

Write:
1. A detailed recap of last season — highlight the champion, the regular season loser, the Draft Order Bowl winner, and 3-4 biggest storylines backed by the metrics
2. Brief callbacks to prior seasons where relevant (patterns, rivalries, improvements)  
3. All-time superlatives: best drafter, best waiver manager, best trade history, luckiest schedule, etc.
4. Top 3 biggest storylines heading into the draft
5. Pre-draft power rankings section with 2-3 sentence commentary per manager
Keep each section tight. Back every claim with specific numbers from the data.
`.trim(),

  draftGrades: `
You are grading the just-completed fantasy draft for the newsletter.
Tone: opinionated sports analyst — give real grades, don't be diplomatic about bad drafts.
Use the attached files: league_context.md, season_history.md, and the draft data provided.

For each manager, write:
- Letter grade (A through F)
- 2-3 sentence analysis: key picks, positional strategy, value/reaches, and how their tendencies compare to prior years
- One "bold prediction" based on their draft

Then write a league-wide summary: which team looks best on paper, which looks worst, biggest positional battles.
`.trim(),

  weeklyRecap: `
You are writing the weekly recap article for a fantasy football league newsletter.
Tone: fun, trash-talky between friends, but backed by real analysis. Include specific scores.
Use current_week.md for this week's data and league_context.md for context.

Write:
1. A funny intro paragraph (2-3 sentences, can reference any storyline from the data)
2. Matchup recaps — 2-4 sentences per game, highlight big performances, close games, blowouts
3. Top waiver pickup of the week (use the PAR data to identify the best value add)
4. Worst waiver pickup or biggest miss (who should have been picked up but wasn't, or a bad pickup)
5. Power rankings with 1-sentence commentary per team (use the rankings table, reference movement)
6. Next week's matchup previews — 1-2 sentences per game, who has the edge

Note: trade grades are NOT available week-to-week — just list trades factually, no grades.
`.trim(),

  endOfSeasonRecap: `
You are writing the end-of-season recap article for a fantasy football league newsletter.
Tone: retrospective and analytical — this is the definitive record of the season.
Use all attached data files.

Write:
1. Season narrative arc — how did the season unfold? Who rose, who fell?
2. Final standings and playoff outcomes
3. Best trades of the season (by PAR — include the specific numbers)
4. Worst trades of the season
5. Best waiver pickup of the season (must have been started at least once)
6. Draft analysis: whose draft performed best when you remove trades/waivers? Whose was worst?
7. Award section: Most Improved, Luckiest Schedule, Best Lineup Manager, Most Active (trades+waivers), and the Fool's Gold award (best record despite bad underlying metrics)
8. Season stats and records
`.trim()
};
