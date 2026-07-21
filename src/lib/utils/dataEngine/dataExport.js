// dataExport.js
//
// Serializes computed NLFL league data into Markdown for Claude Projects.
// Always 4 files, always overwrite. Never accumulate.
//
// Workflow:
//   1. Load all data in the UI (Transactions → Draft Data → Manager Grades → Power Rankings)
//   2. Go to Export tab → Download & Copy each file
//   3. Upload to your Claude Project (overwrite existing files)
//   4. Paste the article prompt as your first message

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

/**
 * Converts a 0-100 z-score normalized grade to a letter grade.
 * 50 = C (league average). ±25 points = ±1 std dev.
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
 * Champion = finalPlacement 1, loserBracketWinner = finalPlacement 7,
 * regularSeasonLoser = worst record through week 14.
 */
function deriveSeasonOutcomes(standings, weeklyResults, snap) {
  if (!standings || standings.length === 0) return null;
  const mn     = (id) => mgrName(id, snap);
  const sorted = [...standings].sort((a, b) => (a.finalPlacement || 99) - (b.finalPlacement || 99));

  const champion           = sorted.find(t => t.finalPlacement === 1);
  const runnerUp           = sorted.find(t => t.finalPlacement === 2);
  const thirdPlace         = sorted.find(t => t.finalPlacement === 3);
  const loserBracketWinner = sorted.find(t => t.finalPlacement === 7);

  // Regular season loser: worst record through weeks 1-14 only
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
        managerId:   mgrId,
        displayName: mn(mgrId),
        wins:        rec.wins,
        losses:      rec.losses,
        ties:        rec.ties,
        pf:          rec.pf
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

// ── League context (upload once, rarely changes) ──────────────────────────────

/**
 * Static league context — rules, roster settings, manager bios, rivalries.
 * Pass mostRecentYear so the current season's rivalries are included.
 */
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
  lines.push('- **Adjusted Draft PAR**: draft PAR minus expected PAR for that round, accounting for positional scarcity and historical round expectations');
  lines.push('- **Lineup IQ**: actual pts scored ÷ maximum possible pts each week. Higher = better lineup decisions');
  lines.push('- **SOS**: Strength of Schedule — avg opponent scoring and win % faced');
  lines.push('- **Luck**: actual win% minus expected win% based on your weekly score vs all other scores. Positive = won more than your points deserved');
  lines.push('- **Manager Grade**: weighted blend of Draft (40%), Trades (20%), Waivers (20%), Lineup IQ (20%). Z-score normalized so C = league average, A = genuinely elite');
  lines.push('');

  // Manager bios + rivalry data
  lines.push(buildManagerRosterSection(managersSnapshot, mostRecentYear));

  return lines.join('\n');
}

// ── Season stats export ───────────────────────────────────────────────────────

/**
 * Full season stats — standings, grades, SOS, draft analysis, lineup IQ.
 * Upload as current_season.md, replace weekly.
 */
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
  const mn      = (id) => mgrName(id, managersSnapshot);
  const lines   = [];
  const outcomes = deriveSeasonOutcomes(standings, weeklyResults, managersSnapshot);

  lines.push(`# NLFL ${year} Season — Full Data`);
  lines.push('');

  // ── Season outcomes (top of file so LLM sees it first) ────────────────────
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

  // ── Rivalry week stakes ───────────────────────────────────────────────────
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

  // ── Regular season standings ──────────────────────────────────────────────
  lines.push('');
  lines.push('## Final Regular Season Standings (Weeks 1-14)');
  lines.push('*Definitive regular season order — sorted by wins then points scored.*');
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

  // ── Post-season standings ─────────────────────────────────────────────────
  lines.push('');
  lines.push('## Final Post-Season Standings');
  lines.push('*finalPlacement = overall finish for the entire season including playoffs and consolation bracket.*');
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
    lines.push('*Post-season placements not available — playoffs may still be in progress or bracket data is missing from Sleeper.*');
    lines.push('In the absence of playoff data, use regular season seeding as a proxy for post-season finish.');
  }

  // ── Manager grades ────────────────────────────────────────────────────────
  lines.push('');
  lines.push('## Manager Grades');
  lines.push('*Letter grades only — C = league average. Weights: Draft 40% · Trades 20% · Waivers 20% · Lineup IQ 20%.*');
  lines.push('*Zero activity in a category = C (neutral), not penalized.*');
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
  lines.push('### Raw Component Values (underlying the letter grades)');
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
    lines.push(`*Adjusted PAR = how much each manager's picks outperformed/underperformed historical round expectations.*`);
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
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}, Pick #${p.pickNo}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, ${fp(p.actualPts)} pts scored`);
    });

    lines.push('');
    lines.push('### Biggest Draft Busts');
    (draftEndOfSeasonGrade.leagueTopBusts||[]).slice(0,5).forEach((p,i) => {
      lines.push(`${i+1}. **${p.playerName}** (${p.pos}, Rd ${p.round}, Pick #${p.pickNo}) — ${mn(p.managerId)} — Adj PAR: ${signedFp(p.adjustedPAR)}, ${fp(p.actualPts)} pts scored`);
    });
  }

  // ── Lineup IQ ─────────────────────────────────────────────────────────────
  if (rosterStats) {
    lines.push('');
    lines.push('## Lineup IQ (Optimal Lineup Management)');
    lines.push('*How often did each manager start their best possible lineup each week?*');
    lines.push('');
    lines.push('| Manager | Points Scored | Max Possible | Efficiency | Grade |');
    lines.push('|---------|---------------|--------------|------------|-------|');

    activeIds
      .map(id => ({ id, data: rosterStats[id]?.[String(year)] }))
      .filter(({ data }) => data)
      .sort((a, b) => (b.data.lineupIQ||0) - (a.data.lineupIQ||0))
      .forEach(({ id, data }) => {
        const g = seasonManagerGrades?.[id];
        lines.push(`| ${mn(id)} | ${fp(data.fpts)} | ${fp(data.ppts)} | ${pct(data.lineupIQ)} | ${toLetter(g?.normLineup)} |`);
      });
  }

  return lines.join('\n');
}

// ── All-time history export ───────────────────────────────────────────────────

/**
 * Multi-season history covering all computed all-time metrics.
 * Upload as all_time_history.md, replace once per year.
 */
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

  lines.push('# NLFL All-Time League History');
  lines.push('*All grades are letter grades (C = league average for that season)*');
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
  lines.push(['| Manager', ...allYears.map(y => `**${y}**`), '|'].join(' | '));
  lines.push(['|--------', ...allYears.map(() => '--------'), '|'].join('|'));
  Object.keys(allTimeManagerGrades).forEach(id => {
    const row = [mn(id), ...allYears.map(y => {
      const g = seasonManagerGrades[y]?.[id];
      return g?.overallGrade != null ? toLetter(g.overallGrade) : '—';
    })];
    lines.push('| ' + row.join(' | ') + ' |');
  });

  // Raw component averages for context
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
    .forEach(({ id, rs, champs, last, seasons }) => {
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

  // ── Trade/waiver history ──────────────────────────────────────────────────
  const txYears = [...new Set([
    ...Object.keys(managerTradePARBySeason||{}),
    ...Object.keys(managerWaiverPARBySeason||{})
  ])].sort((a,b) => Number(a)-Number(b));

  if (txYears.length > 0) {
    const tHeader = ['| Manager', ...txYears, '|'].join(' | ');
    const tSep    = ['|--------', ...txYears.map(() => '------'), '|'].join('|');

    lines.push('');
    lines.push('## Trade PAR by Season');
    lines.push('*Total Points Above Replacement gained through trades each season.*');
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

/**
 * This week's data — matchup results, waivers, standings, power rankings.
 * Upload as current_week.md, replace every week.
 */
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

  lines.push(`# NLFL ${year} — Week ${week} Data`);
  lines.push(`*Generated for article use. All scores and stats are from Week ${week}.*`);
  lines.push('');

  // ── Matchup results ───────────────────────────────────────────────────────
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

  // ── Waiver moves ──────────────────────────────────────────────────────────
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
    lines.push('');
    sorted.forEach(tx => {
      const g = tx.grade;
      lines.push(`- **${mn(tx.managerIds?.[0])}**: +${g.name} (${g.position})${g.droppedName?` / -${g.droppedName}`:''} — ${signedFp(g.par)} PAR vs replacement (${g.repName}), grade: ${g.gradeLabel}`);
    });
    lines.push('');
    lines.push(`**Best pickup**: ${mn(sorted[0].managerIds?.[0])} added ${sorted[0].grade.name} (${signedFp(sorted[0].grade.par)} PAR)`);
    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1];
      lines.push(`**Worst pickup**: ${mn(worst.managerIds?.[0])} added ${worst.grade.name} (${signedFp(worst.grade.par)} PAR)`);
    }
  }

  // ── Trades ────────────────────────────────────────────────────────────────
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
    lines.push(`## Next Week's Matchups (Week ${week + 1})`);
    lines.push('');
    nextWeekMatchups.forEach(m => {
      lines.push(`- **${mn(m.home)}** vs **${mn(m.away)}**`);
    });
  }

  return lines.join('\n');
}

// ── Pre-draft package ─────────────────────────────────────────────────────────

/**
 * Pre-draft package — pre-season power rankings + all-time history + last season stats.
 * Upload as pre_draft.md, generate once before the draft.
 */
export function exportPreDraftPackage({
  year,
  allTimeExport,
  latestSeasonExport,
  preSeasonRankings,
  managersSnapshot
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

  // ── Pre-draft power rankings ──────────────────────────────────────────────
  lines.push('## Pre-Draft Power Rankings');
  lines.push('');

  if (preSeasonRankings?.rankings?.length) {
    lines.push('| Rank | Manager | Overall | Draft | Trades | Waivers | Lineup IQ | Prior Reg Finish | Prior Post Finish |');
    lines.push('|------|---------|---------|-------|--------|---------|-----------|-----------------|-------------------|');
    preSeasonRankings.rankings.forEach(team => {
      const regRank  = team.isFirstSeason ? '(new)'
                     : team.prevRegRank  != null ? `#${team.prevRegRank}`  : '—';
      const postRank = team.isFirstSeason ? '(new)'
                     : team.prevPostRank != null ? `#${team.prevPostRank}` : '—';
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
  lines.push(latestSeasonExport || '*(Season stats not available — load season data and re-export)*');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## All-Time League History');
  lines.push('');
  lines.push(allTimeExport || '*(All-time history not available — load manager grades and re-export)*');

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

**Opening** (3-4 sentences — punch them in the mouth immediately. Reference something embarrassing from last season or the offseason.)

**[YEAR] Season Recap** (~250 words)
Who won, who was last, who won the Draft Order Bowl and what that means for pick order. Hit the 3-4 most embarrassing/impressive statistical moments with specific numbers. Brief callbacks to 2023/2024 patterns where someone has a repeating problem.

**All-Time Hall of Fame / Hall of Shame**
Award specific titles based on the all-time data. Examples: Best Drafter, Waiver Wire Wizard, Worst Trader, Most Likely to Choke in the Playoffs, Luckiest SOB in the League, The Guy Who Always Reaches for a QB Too Early. Be mean when the data supports it. Be specific with which stats justify each title.

**Storylines Heading Into the Draft** (FORWARD-LOOKING ONLY — no rehashing last season)
3-4 things to watch in the upcoming draft. Draft position stakes, redemption arcs, who needs to prove something, positional patterns to exploit, historical tendencies that are predictable.

**Pre-Draft Power Rankings**
Copy the pre-computed table exactly. Then write 1-2 sentences of spicy commentary per manager. Reference their component grades (draft, trades, waivers, lineup IQ) and their prior season finish. Acknowledge new managers. Don't be diplomatic.
`.trim(),

  draftGrades: `
You are grading the just-completed NLFL draft for the group newsletter.

VOICE: Commissioner energy. You watched every single pick. You have takes. Some of them are going to hurt.

TONE: Call out bad picks by name. Hype up value picks. Reference who this manager has drafted in prior years — do they always reach for a QB too early? Do they always load RBs and get burned? Do they ignore TE until it's too late? The draft history is in the data.

RULES:
- Use REAL NAMES from league_context.md — never Sleeper usernames
- LETTER GRADES ONLY
- Be specific: don't say "bad value" — say "taking [player] in round 4 when he was available in round 6 is either very smart or very dumb, and based on [manager]'s draft history, I know which one it is"
- Reference prior draft grades (from all_time_history.md) when calling out patterns
- Use bio details to add personality to each grade

FOR EACH MANAGER:
- Letter grade (A+ through F)
- 2-3 sentences: key picks, reaches vs value, positional strategy, historical pattern recognition
- One bold prediction for their season based specifically on what they drafted

FINISH WITH:
- Who had the best draft in the room and the specific pick that made it
- Who had the worst draft and the specific pick that doomed them
- One sleeper pick across the entire draft that could make everyone look stupid by week 8
`.trim(),

  weeklyRecap: `
You are writing the NLFL weekly recap newsletter.

VOICE: Commissioner to the group chat. You watched every game. You're going to roast the losers and hype the winners and you're going to use their real names.

TONE EXAMPLES:
- "Wow, James pulled off the improbable and potentially clawed his way out of last."
- "Pretty sure Berra is Alec's daddy after the ass whooping he just gave."
- "His team is ass cheeks" is appropriate vocabulary
- Always include exact scores — "lost by 0.4 points" not "narrowly lost"
- "Jesus [player name] is so fucking good" is the right register

RULES:
- Use REAL NAMES from league_context.md throughout
- Include exact scores for every game
- Reference specific players who had big weeks or completely flopped
- If it's rivalry week, reference the bet stakes for each rivalry matchup
- Trades this week have NO grades — list them factually only, no analysis
- Keep it punchy. Short paragraphs. No filler.

STRUCTURE:

**Opening** (2-3 sentences — reference something absurd, painful, or hilarious from the week's games)

**Game Recaps** (2-4 sentences per game)
Include exact scores and margin. Winner gets credit. Loser gets roasted. If it's rivalry week, call out the bet stakes and what the loser now owes.

**Waiver Wire Report**
Best pickup of the week (use PAR data — explain why this pickup matters to their season)
Worst pickup of the week (lowest PAR — give them appropriate grief)
List all other moves factually.

**Power Rankings**
Copy the table. Write 1 sentence per team referencing their movement (↑ or ↓) and current trajectory. Be honest about who's trending toward last place.

**Next Week Preview**
1-2 sentences per matchup. Who has the edge and why. Add trash talk. If a rivalry matchup is upcoming, call out the stakes.
`.trim(),

  endOfSeasonRecap: `
You are writing the NLFL End of Season Recap — the permanent record of what happened this year.

VOICE: Commissioner with a full season of receipts. You have all the data. You're going to use it. This is the document people refer back to in future seasons to talk shit.

TONE: More analytical than the weekly but still savage. "The data says [name] had the worst draft in the league and their final record proved it" hits different when you back it up with specific numbers.

RULES:
- Use REAL NAMES from league_context.md — never Sleeper usernames
- LETTER GRADES ONLY
- Back every claim with specific numbers from the data
- Reference bio details to personalize the roasts
- Be honest about who underperformed, who got lucky, who actually earned their result
- Reference rivalry results and who won/lost their bets

STRUCTURE:

**Season Narrative** (~200 words)
How did the season unfold? Who started hot and faded? Who came from nowhere? What was the defining storyline? What were the 2-3 moments that made this season memorable?

**Final Outcomes**
Champion, runner-up, last place, Draft Order Bowl winner. Champion gets credit — back it up with their grades. Last place gets the full autopsy — what went wrong, where did it fall apart, what do the grades say about why?

**Rivalry Week Results**
For each rivalry matchup: who won, what the loser owes, any notable context from their head-to-head.

**Best Trades of the Season** (top 3 by PAR)
Name the trade, who sent what, who won it, by how much. Be specific.

**Worst Trades of the Season** (bottom 3 by PAR)
Name the trade, who got fleeced, and how badly. Don't sugarcoat it.

**Best Waiver Pickup** (highest PAR — must have been started at least once)
Name the player, who picked them up, when, and the PAR value. Explain the season impact.

**Draft Report Card**
Whose draft held up when the final standings came out? Whose looked great in August and was a disaster by December? Cite specific busts and steals by player name and round.

**Season Awards**
🏆 **Best Manager** — data-backed, not just who won. Someone can win with a lucky schedule and a mediocre grade.
📈 **Most Improved** — who made the biggest leap from prior seasons?
🍀 **Luckiest Schedule** — use the SOS luck metric. Call them out specifically.
🧠 **Lineup Genius** — best lineup IQ, the one who actually paid attention every week.
🤡 **The Annual Clown Award** — worst grades, most embarrassing moment, specific evidence required. Be mean.
🎯 **Best Single Transaction** — one trade or waiver pickup that had the biggest impact on the season.
`.trim()

};
