<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getAllSeasonsHistory } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getTransactionHistory, getAllTimeTransactionTotals, getSeasonTransactionTotals } from '$lib/utils/dataEngine/allTransactions.js';
  import { gradeTradeByPAR, gradeWaiverByPAR, gradeCompositeTrade } from '$lib/utils/dataEngine/parGrading.js';
  import { getAllDrafts } from '$lib/utils/dataEngine/allDrafts.js';
  import { gradeDraftPreSeason, gradeDraftEndOfSeason } from '$lib/utils/dataEngine/draftAnalysis.js';
  import { getSeasonStatTotals } from '$lib/utils/dataEngine/allPlayerSeasonStats.js';
  import { computeRoundBaselines } from '$lib/utils/dataEngine/draftBaselines.js';
  import { buildDraftHistoryContext, buildCurrentDraftSummary, DRAFT_GRADING_PROMPT_TEMPLATE } from '$lib/utils/dataEngine/draftHistoryContext.js';
  import { getAllRosterStats } from '$lib/utils/dataEngine/allRosterStats.js';
  import { computeSeasonManagerGrades, computeAllTimeManagerGrades } from '$lib/utils/dataEngine/managerGrades.js';
  import { computePreSeasonRankings, computePowerRankings, computeAllWeekRankings, REGULAR_SEASON_WEEKS } from '$lib/utils/dataEngine/powerRankings.js';
  import { computeSeasonSOS, computeAllTimeSOS } from '$lib/utils/dataEngine/strengthOfSchedule.js';
  import {
    exportLeagueContext, exportSeasonStats, exportAllTimeHistory,
    exportWeeklyData, exportPreDraftPackage, PROMPTS
  } from '$lib/utils/dataEngine/dataExport.js';
  import { teamManagersStore } from '$lib/stores';

  // ── Global ─────────────────────────────────────────────────────────────────
  let allTimeHistory  = null;
  let globalDebug     = [];
  let showGlobalDebug = false;
  let mainTab         = 'transactions';

  // ── Transactions ────────────────────────────────────────────────────────────
  let transactionHistory        = null;
  let loadingTransactions       = false;
  let gradedTransactions        = [];
  let allTimeTransactionTotals  = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals   = [];
  let txFilter         = 'all';
  let showTxDebug      = false;
  let transactionDebug = [];
  let expandedTx       = new Set();
  let managerTradePARBySeason  = {};
  let managerWaiverPARBySeason = {};

  // ── Drafts ──────────────────────────────────────────────────────────────────
  let allDrafts         = [];
  let loadingDrafts     = false;
  let draftDebug        = [];
  let showDraftDebug    = false;
  let selectedDraftYear = null;
  let preSeasonGrade    = null;
  let endOfSeasonGrade  = null;
  let draftActiveTab    = 'end';
  let draftGradesByYear = {};
  const eosCache        = {};

  // ── LLM ─────────────────────────────────────────────────────────────────────
  let llmHistoryText  = '';
  let llmCurrentText  = '';
  let llmPromptText   = '';
  let llmSelectedYear = null;
  let copiedHistory   = false;
  let copiedCurrent   = false;
  let copiedPrompt    = false;

  // ── Manager grades ──────────────────────────────────────────────────────────
  let rosterStats           = null;
  let loadingManagers       = false;
  let managerDebug          = [];
  let showManagerDebug      = false;
  let seasonManagerGrades   = {};
  let allTimeManagerGrades  = {};
  let managerGradeYear      = null;
  let managerLineupIQBySeason = {};

  // ── SOS ─────────────────────────────────────────────────────────────────────
  let seasonSOSByYear = {};
  let allTimeSOS      = {};
  let sosYear         = null;

  // ── Power rankings ──────────────────────────────────────────────────────────
  let powerYear             = null;
  let loadingPower          = false;
  let preSeasonRankings     = null;
  let endOfSeasonRankings   = null;
  let weeklyProgressionData = [];
  let chartHoverWeek        = null;

  // ── Export ──────────────────────────────────────────────────────────────────
  let exportPreview      = '';
  let exportPreviewTitle = '';
  let exportPreviewType  = '';
  let exportCopied       = {};
  let promptCopied       = {};
  let mainCopied         = false;
  let exportWeek         = 1;

  const EXPORT_CONFIGS = [
    { key: 'context',  title: 'League Context',        filename: 'league_context.md',   desc: 'League rules, scoring, manager roster, metrics glossary.', freq: 'Upload once — re-upload only if rules change' },
    { key: 'history',  title: 'All-Time History',      filename: 'all_time_history.md', desc: 'Career records, all-time grades, SOS, draft/trade/waiver history by season.', freq: 'Replace once per year after season ends' },
    { key: 'season',   title: 'Current Season Stats',  filename: 'current_season.md',   desc: 'Full current season: standings, all grades, SOS, draft analysis.', freq: 'Replace weekly with cumulative data' },
    { key: 'week',     title: 'Current Week',          filename: 'current_week.md',     desc: "This week's matchup results, waivers, standings, power rankings.", freq: 'Replace every week' },
    { key: 'predraft', title: 'Pre-Draft Package',     filename: 'pre_draft.md',        desc: 'Pre-season power rankings + all-time history + last season stats combined.', freq: 'Generate once before the draft' }
  ];

  const PROMPT_LABELS = {
    preDraftRecap:    '📰 Pre-Draft Recap',
    draftGrades:      '📋 Draft Grades',
    weeklyRecap:      '📅 Weekly Recap',
    endOfSeasonRecap: '🏆 End of Season Recap'
  };

  // ── Reactive ────────────────────────────────────────────────────────────────
  $: currentSeasonYears = allTimeHistory
    ? Object.keys(allTimeHistory.parTablesBySeason || {}).sort((a, b) => Number(b) - Number(a))
    : [];
  $: allManagerIds = allTimeHistory ? Object.keys(allTimeHistory.managers || {}) : [];
  $: draftYearOptions = allDrafts.map((d) => d.year).sort((a, b) => b - a);
  $: filteredTransactions = gradedTransactions
    .filter((tx) => !tx.isPartOfComposite)
    .filter((tx) => txFilter === 'all' || tx.type === txFilter);
  $: if (transactionHistory && selectedTransactionSeason) {
    const snap = get(teamManagersStore) || {};
    seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, snap);
  }

  const CHART_COLORS = ['#2563eb','#dc2626','#16a34a','#d97706','#7c3aed','#0891b2','#be185d','#65a30d','#9333ea','#ea580c','#0d9488','#b45309'];
  $: managerColors = Object.fromEntries(allManagerIds.map((id, i) => [id, CHART_COLORS[i % CHART_COLORS.length]]));

  // ── Helpers ──────────────────────────────────────────────────────────────────
  // Replace the clipboard-only approach with download + clipboard
function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

  function mdn(managerId) {
    if (!managerId) return '?';
    return get(teamManagersStore)?.users?.[managerId]?.display_name || `Manager ${managerId}`;
  }
  function fp(val, d = 1) {
    const n = typeof val === 'string' ? parseFloat(val) : val;
    return typeof n === 'number' && !isNaN(n) ? n.toFixed(d) : '—';
  }
  function signedFp(val, d = 1) {
    const n = typeof val === 'string' ? parseFloat(val) : val;
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(d);
  }
  function pct(val, d = 1) {
    const n = typeof val === 'string' ? parseFloat(val) : val;
    return typeof n === 'number' && !isNaN(n) ? (n * 100).toFixed(d) + '%' : '—';
  }
  function parClass(val) {
    const n = typeof val === 'string' ? parseFloat(val) : val;
    if (typeof n !== 'number' || isNaN(n)) return '';
    return n >= 0 ? 'positive' : 'negative';
  }
  function gradeColor(g) {
    if (!g) return '';
    if (g.startsWith('A')) return 'grade-a';
    if (g.startsWith('B')) return 'grade-b';
    if (g.startsWith('C')) return 'grade-c';
    if (g.startsWith('D')) return 'grade-d';
    return 'grade-f';
  }
  function scoreColor(score) {
    const n = parseFloat(score);
    if (isNaN(n)) return '#9ca3af';
    if (n >= 70) return '#16a34a';
    if (n >= 55) return '#65a30d';
    if (n >= 45) return '#d97706';
    if (n >= 30) return '#dc6803';
    return '#dc2626';
  }
  function valueLabelClass(label) {
    if (!label) return '';
    if (label.includes('steal') || label === 'value') return 'vl-steal';
    if (label === 'as expected')                      return 'vl-neutral';
    if (label.includes('bust'))                       return 'vl-bust';
    if (label.includes('reach'))                      return 'vl-reach';
    return 'vl-neutral';
  }
  function waiverEmoji(l) { return { elite:'🔥', strong:'✅', solid:'👍', breakeven:'➖', poor:'❌' }[l] || '?'; }
  function tradeEmoji(g)  { return { lopsided:'💥', clear:'✅', close:'⚖️', even:'🤝' }[g] || '?'; }
  function injIcon(f)     { return f === 'major-injury' ? '🚑' : f === 'injury' ? '🤕' : ''; }

  function toggleTx(id) {
    const next = new Set(expandedTx);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedTx = next;
  }

  async function clipboardCopy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
  async function copy(text, which) {
    await clipboardCopy(text);
    if (which === 'h') { copiedHistory = true; setTimeout(() => copiedHistory = false, 2000); }
    if (which === 'c') { copiedCurrent = true; setTimeout(() => copiedCurrent = false, 2000); }
    if (which === 'p') { copiedPrompt  = true; setTimeout(() => copiedPrompt  = false, 2000); }
  }

  // ── Helpers used by export ────────────────────────────────────────────────
  function getActiveManagerIds(year) {
    const seasonData = allTimeHistory?.seasons?.find((s) => String(s.year) === String(year));
    return (seasonData?.standings || []).map((t) => t.managerId).filter(Boolean);
  }

  // ── Core loader ──────────────────────────────────────────────────────────────
  async function ensureHistory() {
    if (allTimeHistory) return;
    globalDebug.push('Loading all-time history...');
    globalDebug = [...globalDebug];
    await getLeagueTeamManagers();
    allTimeHistory = await getAllSeasonsHistory();
    globalDebug.push(`Seasons: ${currentSeasonYears.join(', ')} | Players: ${Object.keys(allTimeHistory.allPlayersData||{}).length}`);
    globalDebug = [...globalDebug];
  }

  // ── Transactions ─────────────────────────────────────────────────────────────
  async function loadTransactions() {
    loadingTransactions = true;
    transactionDebug = [];
    gradedTransactions = [];
    try {
      await ensureHistory();
      const txResult = await getTransactionHistory(undefined, allTimeHistory.playerResults || []);
      transactionHistory = txResult;
      transactionDebug.push(...txResult.debug);

      const playerResults     = allTimeHistory.playerResults  || [];
      const allPlayersData    = allTimeHistory.allPlayersData || {};
      const parTablesBySeason = allTimeHistory.parTablesBySeason || {};

      gradedTransactions = txResult.transactions.map((tx) => {
        const pt = parTablesBySeason[String(tx.seasonKey || tx.season)];
        const mn = (tx.managerIds || []).map((id) => mdn(id));
        if (tx.isComposite) return { ...tx, grade: gradeCompositeTrade(tx, pt, playerResults, allPlayersData) };
        if (tx.type === 'trade')  return { ...tx, grade: gradeTradeByPAR(tx, pt, playerResults, allPlayersData, mn) };
        if (tx.type === 'waiver') return { ...tx, grade: gradeWaiverByPAR(tx, pt, playerResults, allPlayersData) };
        return tx;
      });

      const snap = get(teamManagersStore) || {};
      allTimeTransactionTotals = getAllTimeTransactionTotals(txResult.totals, snap);
      const avail = Object.keys(txResult.totals.seasons || {}).sort((a,b) => Number(b)-Number(a));
      if (avail.length) {
        selectedTransactionSeason = avail[0];
        seasonTransactionTotals   = getSeasonTransactionTotals(txResult.totals, avail[0], snap);
      }

      managerTradePARBySeason  = {};
      managerWaiverPARBySeason = {};
      gradedTransactions.filter((tx) => !tx.isPartOfComposite).forEach((tx) => {
        const year = String(tx.seasonKey || tx.season);
        if (tx.type === 'trade' && tx.grade) {
          [tx.grade.side0, tx.grade.side1].forEach((side, idx) => {
            const mgrId = tx.managerIds?.[idx];
            if (!mgrId || side?.parTotal == null) return;
            if (!managerTradePARBySeason[year]) managerTradePARBySeason[year] = {};
            managerTradePARBySeason[year][mgrId] = (managerTradePARBySeason[year][mgrId] || 0) + side.parTotal;
          });
        }
        if (tx.type === 'waiver' && tx.grade?.par != null && tx.managerIds?.[0]) {
          const mgrId = tx.managerIds[0];
          if (!managerWaiverPARBySeason[year]) managerWaiverPARBySeason[year] = {};
          managerWaiverPARBySeason[year][mgrId] = (managerWaiverPARBySeason[year][mgrId] || 0) + tx.grade.par;
        }
      });
      transactionDebug.push(`Graded ${gradedTransactions.length} transactions.`);
    } catch (e) {
      console.error(e); transactionDebug.push(`Crash: ${e.message}`);
    } finally { loadingTransactions = false; }
  }

  // ── Drafts ───────────────────────────────────────────────────────────────────
  async function loadDrafts() {
    loadingDrafts = true; draftDebug = [];
    try {
      await ensureHistory();
      allDrafts = await getAllDrafts(allTimeHistory.allPlayersData || {});
      draftDebug.push(`Loaded ${allDrafts.length} draft(s): ${allDrafts.map(d=>d.year).join(', ')}`);
      for (const draft of allDrafts) await computeEOS(draft.year, true);
      if (allDrafts.length) {
        selectedDraftYear = allDrafts[0].year;
        preSeasonGrade    = gradeDraftPreSeason(allDrafts[0]);
        endOfSeasonGrade  = eosCache[String(selectedDraftYear)] || null;
      }
    } catch (e) {
      console.error(e); draftDebug.push(`Crash: ${e.message}`);
    } finally { loadingDrafts = false; }
  }

  async function computeEOS(year, silent = false) {
    const ys    = String(year);
    const draft = allDrafts.find((d) => d.year === year);
    const pt    = allTimeHistory?.parTablesBySeason?.[ys];
    if (!draft || !pt) return null;

    const allSeasonStats    = allTimeHistory?.allSeasonStats    || {};
    const parTablesBySeason = allTimeHistory?.parTablesBySeason || {};
    const allPlayersData    = allTimeHistory?.allPlayersData    || {};

    const baselines = computeRoundBaselines(year, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData);
    if (!baselines) return null;

    const sr = await getSeasonStatTotals(year, allTimeHistory?.sharedScoringSettings).catch(() => null);
    if (!sr) return null;

    const grade = gradeDraftEndOfSeason(draft, sr.totals, sr.gamesPlayed, baselines, pt, allPlayersData);
    if (grade) {
      eosCache[ys] = grade;
      draftGradesByYear[ys] = {};
      Object.entries(grade.byRoster || {}).forEach(([, team]) => {
        if (team.managerId && team.totalAdjustedPAR != null) {
          draftGradesByYear[ys][team.managerId] = parseFloat(team.totalAdjustedPAR);
        }
      });
      draftGradesByYear = { ...draftGradesByYear };
      if (!silent) draftDebug.push(`${year} EOS grade computed.`);
    }
    return grade;
  }

  async function selectDraft(year) {
    selectedDraftYear = year;
    const draft = allDrafts.find((d) => d.year === year);
    preSeasonGrade   = gradeDraftPreSeason(draft);
    endOfSeasonGrade = eosCache[String(year)] || await computeEOS(year);
    if (endOfSeasonGrade) draftDebug.push(...(endOfSeasonGrade.debug || []));
    draftDebug = [...draftDebug];
  }

  // ── LLM ──────────────────────────────────────────────────────────────────────
  function buildLLM(year) {
    if (!allDrafts.length) return;
    const { text } = buildDraftHistoryContext(allDrafts, allTimeHistory?.allSeasonStats || {}, mdn);
    llmHistoryText  = text;
    llmCurrentText  = buildCurrentDraftSummary(allDrafts.find(d=>d.year===Number(year)), mdn);
    llmPromptText   = DRAFT_GRADING_PROMPT_TEMPLATE
      .replace('{{HISTORY}}', llmHistoryText)
      .replace('{{CURRENT_DRAFT}}', llmCurrentText);
    llmSelectedYear = year;
  }

  // ── Manager grades ────────────────────────────────────────────────────────────
  async function loadManagerGrades() {
    loadingManagers = true; managerDebug = [];
    try {
      await ensureHistory();

      const rosterToManagerByYear = {};
      allTimeHistory.seasons.forEach((s) => {
        const ys = String(s.year);
        rosterToManagerByYear[ys] = s.rosterToManagerId || {};
      });

      const rsResult = await getAllRosterStats(allTimeHistory.seasons, rosterToManagerByYear);
      rosterStats = rsResult.byManager;
      managerDebug.push(...(rsResult.debug || []));

      managerLineupIQBySeason = {};
      Object.entries(rosterStats || {}).forEach(([mgrId, seasons]) => {
        Object.entries(seasons).forEach(([yr, data]) => {
          if (!managerLineupIQBySeason[yr]) managerLineupIQBySeason[yr] = {};
          if (data.lineupIQ != null) managerLineupIQBySeason[yr][mgrId] = data.lineupIQ;
        });
      });

      seasonSOSByYear = {};
      allTimeHistory.seasons.forEach((s) => {
        const ys        = String(s.year);
        const standings = s.standings || [];
        const wkResults = allTimeHistory.weeklyResults.filter((r) => String(r.year) === ys);
        const mgrIds    = standings.map((t) => t.managerId).filter(Boolean);
        if (wkResults.length > 0 && mgrIds.length > 0) {
          seasonSOSByYear[ys] = computeSeasonSOS(wkResults, standings, mgrIds);
          managerDebug.push(`SOS ${ys}: ${Object.keys(seasonSOSByYear[ys]).length} managers`);
        } else {
          managerDebug.push(`SOS ${ys}: skipped — wkResults=${wkResults.length} mgrIds=${mgrIds.length}`);
        }
      });
      allTimeSOS = computeAllTimeSOS(seasonSOSByYear, allManagerIds);

      managerGradeYear = currentSeasonYears[0];
      recomputeGrades();
      managerDebug.push('Manager grades computed.');
    } catch (e) {
      console.error(e); managerDebug.push(`Crash: ${e.message}`);
    } finally { loadingManagers = false; }
  }

  // FIX: use active managers per season, not all-time allManagerIds
  function recomputeGrades() {
    seasonManagerGrades = {};
    currentSeasonYears.forEach((year) => {
      const activeIds = getActiveManagerIds(year);
      if (activeIds.length === 0) return;
      seasonManagerGrades[year] = computeSeasonManagerGrades(
        year,
        draftGradesByYear[year]        || {},
        managerTradePARBySeason[year]  || {},
        managerWaiverPARBySeason[year] || {},
        managerLineupIQBySeason[year]  || {},
        activeIds
      );
    });
    allTimeManagerGrades = computeAllTimeManagerGrades(seasonManagerGrades);
  }

  // ── Power rankings ────────────────────────────────────────────────────────────
  // FIX: use active managers per season
  async function loadPowerRankings(year) {
    loadingPower = true;
    powerYear    = year;
    preSeasonRankings     = null;
    endOfSeasonRankings   = null;
    weeklyProgressionData = [];
    try {
      await ensureHistory();
      const ys         = String(year);
      const seasonData = allTimeHistory.seasons.find((s) => String(s.year) === ys);
      if (!seasonData) return;

      const standings     = seasonData.standings || [];
      const weeklyResults = allTimeHistory.weeklyResults.filter((r) => String(r.year) === ys);
      const rosterToMgr   = (rosterId) => seasonData.rosterToManagerId?.[String(rosterId)] ?? null;

      // Only managers who played this season
      const activeManagerIds = standings.map((t) => t.managerId).filter(Boolean);
      if (activeManagerIds.length === 0) return;

      const mgrGrades = seasonManagerGrades[ys] || {};

      const sortedYears  = currentSeasonYears.map(Number).sort((a, b) => a - b);
      const prevYear     = sortedYears.find((y) => y < Number(year));
      const prevSeason   = prevYear ? allTimeHistory.seasons.find((s) => Number(s.year) === prevYear) : null;
      const prevStandings = prevSeason?.standings || [];

      const priorSeasonGrades = {};
      currentSeasonYears
        .filter((y) => Number(y) < Number(year))
        .forEach((y) => { if (seasonManagerGrades[y]) priorSeasonGrades[y] = seasonManagerGrades[y]; });
      const priorAllTimeGrades = computeAllTimeManagerGrades(priorSeasonGrades);

      preSeasonRankings = computePreSeasonRankings(year, priorAllTimeGrades, prevStandings, activeManagerIds);

      weeklyProgressionData = computeAllWeekRankings(standings, weeklyResults, mgrGrades, allTimeManagerGrades, rosterToMgr);
      endOfSeasonRankings   = weeklyProgressionData[REGULAR_SEASON_WEEKS];
    } catch (e) {
      console.error(e);
    } finally { loadingPower = false; }
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  async function generateExport(type) {
    const snap       = get(teamManagersStore) || {};
    const yearStr    = currentSeasonYears[0];
    const seasonData = allTimeHistory?.seasons?.find((s) => String(s.year) === yearStr);
    let text  = '';
    let title = '';

    try {
      if (type === 'context') {
        text  = exportLeagueContext(snap);
        title = 'league_context.md';

      } else if (type === 'history') {
        text = exportAllTimeHistory({
          allTimeManagerGrades, allTimeSOS, seasonManagerGrades, seasonSOSByYear,
          allDrafts, draftGradesByYear, managerTradePARBySeason, managerWaiverPARBySeason,
          managers: allTimeHistory?.managers || {}, managersSnapshot: snap
        });
        title = 'all_time_history.md';

      } else if (type === 'season') {
        text = exportSeasonStats({
          year: yearStr,
          standings:      seasonData?.standings || [],
          weeklyResults:  allTimeHistory?.weeklyResults?.filter((r) => String(r.year) === yearStr) || [],
          seasonManagerGrades: seasonManagerGrades[yearStr] || {},
          seasonSOS:      seasonSOSByYear[yearStr] || null,
          draftEndOfSeasonGrade: eosCache[yearStr] || null,
          managerTradePAR:  managerTradePARBySeason[yearStr]  || {},
          managerWaiverPAR: managerWaiverPARBySeason[yearStr] || {},
          managerLineupIQ:  managerLineupIQBySeason[yearStr]  || {},
          rosterStats, managersSnapshot: snap
        });
        title = 'current_season.md';

      } else if (type === 'week') {
        const weekResults = allTimeHistory?.weeklyResults?.filter(
          (r) => String(r.year) === yearStr && r.week === exportWeek
        ) || [];
        const pr     = weeklyProgressionData[exportWeek] || null;
        const prevPR = exportWeek > 0 ? weeklyProgressionData[exportWeek - 1] : null;
        text = exportWeeklyData({
          year: yearStr, week: exportWeek,
          weeklyResults:   weekResults,
          gradedTransactions,
          currentStandings: seasonData?.standings || [],
          powerRankings:    pr,
          previousPowerRankings: prevPR?.rankings || [],
          managersSnapshot: snap
        });
        title = 'current_week.md';

      } else if (type === 'predraft') {
        const histText = exportAllTimeHistory({
          allTimeManagerGrades, allTimeSOS, seasonManagerGrades, seasonSOSByYear,
          allDrafts, draftGradesByYear, managerTradePARBySeason, managerWaiverPARBySeason,
          managers: allTimeHistory?.managers || {}, managersSnapshot: snap
        });
        const seasonText = exportSeasonStats({
          year: yearStr, standings: seasonData?.standings || [],
          weeklyResults: allTimeHistory?.weeklyResults?.filter((r) => String(r.year) === yearStr) || [],
          seasonManagerGrades: seasonManagerGrades[yearStr] || {},
          seasonSOS: seasonSOSByYear[yearStr] || null,
          draftEndOfSeasonGrade: eosCache[yearStr] || null,
          managerTradePAR:  managerTradePARBySeason[yearStr]  || {},
          managerWaiverPAR: managerWaiverPARBySeason[yearStr] || {},
          managerLineupIQ:  managerLineupIQBySeason[yearStr]  || {},
          rosterStats, managersSnapshot: snap
        });
        text = exportPreDraftPackage({
          year:               Number(yearStr) + 1,
          allTimeExport:      histText,
          latestSeasonExport: seasonText,
          preSeasonRankings,
          managersSnapshot:   snap
        });
        title = 'pre_draft.md';
      }
      exportPreview      = text;
      exportPreviewTitle = title;
      exportPreviewType  = type;

      // Download file directly to user's computer
      downloadMarkdown(text, title);

      // Also copy to clipboard as backup
      try { await navigator.clipboard.writeText(text); } catch {}

      exportCopied = { ...exportCopied, [type]: true };
      setTimeout(() => { exportCopied = { ...exportCopied, [type]: false }; }, 2000);
    } catch (e) {
      console.error('Export error:', e);
    }
  }

  async function copyPrompt(key, text) {
    await clipboardCopy(text);
    promptCopied = { ...promptCopied, [key]: true };
    setTimeout(() => { promptCopied = { ...promptCopied, [key]: false }; }, 2000);
  }

  async function copyPreview() {
    await clipboardCopy(exportPreview);
    mainCopied = true;
    setTimeout(() => { mainCopied = false; }, 2000);
  }

  // SVG chart helper
  function chartPath(managerId, progression, chartW, chartH, numTeams) {
    const points = progression.map((weekData, weekIdx) => {
      const entry = weekData.rankings.find((r) => r.managerId === managerId);
      if (!entry) return null;
      const x = (weekIdx / REGULAR_SEASON_WEEKS) * chartW;
      const y = ((entry.rank - 1) / (numTeams - 1)) * chartH;
      return `${x},${y}`;
    }).filter(Boolean);
    return points.length > 1 ? `M ${points.join(' L ')}` : '';
  }

  onMount(async () => {
    await getLeagueTeamManagers().catch(() => {});
  });
</script>

<main class="container">
  <h1>League Analysis Panel</h1>

  <div class="main-tabs">
    {#each [
      ['transactions','💱 Transactions'],
      ['draft',       '📋 Draft'],
      ['llm',         '🤖 LLM Context'],
      ['managers',    '📊 Manager Grades'],
      ['sos',         '📅 Schedule Strength'],
      ['power',       '⚡ Power Rankings'],
      ['export',      '📤 Export']
    ] as [tab, label]}
      <button class="tab-btn {mainTab===tab?'active':''}" on:click={() => (mainTab=tab)}>{label}</button>
    {/each}
  </div>

  <!-- ════════ TRANSACTIONS ════════ -->
  {#if mainTab === 'transactions'}
    <h2>Transaction Analysis</h2>
    <div class="control-row">
      <button on:click={loadTransactions} disabled={loadingTransactions}>
        {loadingTransactions ? 'Loading...' : transactionHistory ? 'Reload' : 'Load Transactions'}
      </button>
    </div>
    {#if loadingTransactions}
      <div class="status-msg">Grading transactions...</div>
    {:else if transactionHistory}
      <h4>All-Time Totals</h4>
      <table class="data-table">
        <thead><tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr></thead>
        <tbody>{#each allTimeTransactionTotals as m}<tr><td>{m.displayName}</td><td>{m.trades}</td><td>{m.waivers}</td><td>{m.total}</td></tr>{/each}</tbody>
      </table>

      <h4>Season Totals</h4>
      <div class="control-row">
        <select bind:value={selectedTransactionSeason} on:change={() => {
          const s = get(teamManagersStore) || {};
          seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, s);
        }}>
          {#each Object.keys(transactionHistory.totals.seasons||{}).sort((a,b)=>Number(b)-Number(a)) as yr}
            <option value={yr}>{yr}</option>
          {/each}
        </select>
      </div>
      {#if seasonTransactionTotals.length}
        <table class="data-table">
          <thead><tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr></thead>
          <tbody>{#each seasonTransactionTotals as m}<tr><td>{m.displayName}</td><td>{m.trades}</td><td>{m.waivers}</td><td>{m.total}</td></tr>{/each}</tbody>
        </table>
      {/if}

      <h4>All Transactions <span class="count-badge">{filteredTransactions.length}</span></h4>
      <div class="control-row">
        <select bind:value={txFilter}>
          <option value="all">All</option>
          <option value="trade">Trades</option>
          <option value="waiver">Waivers</option>
        </select>
      </div>
      {#each filteredTransactions as tx}
        {@const g=tx.grade} {@const isExp=expandedTx.has(tx.id)}
        <div class="tx-card {tx.type} {tx.isComposite?'composite':''}">
          <div class="tx-summary" on:click={() => toggleTx(tx.id)} role="button" tabindex="0"
            on:keydown={(e)=>e.key==='Enter'&&toggleTx(tx.id)}>
            <div class="tx-meta">
              {#if tx.isComposite}<span class="badge composite">🔀 {tx.teams?.length}-Team</span>
              {:else}<span class="badge {tx.type}">{tx.type}</span>{/if}
              <span class="tx-info">{tx.date} · S{tx.seasonKey||tx.season} Wk{tx.leg}</span>
            </div>
            <div class="tx-managers">
              {#if tx.isComposite}{(tx.teams||[]).map(t=>mdn(t.managerId)).join(' → ')}
              {:else if tx.managerIds?.length}{tx.managerIds.map(id=>mdn(id)).join(' ↔ ')}{:else}—{/if}
            </div>
            {#if tx.type==='trade'&&g}
              <span class="grade-badge grade-{g.narrative?.grade}">{tradeEmoji(g.narrative?.grade)} {g.narrative?.grade}</span>
              <span class="par-line">{mdn(tx.managerIds?.[0])}: {fp(g.side0?.parTotal)} | {mdn(tx.managerIds?.[1])}: {fp(g.side1?.parTotal)} PAR</span>
            {:else if tx.type==='waiver'&&g}
              <span class="grade-badge grade-{g.gradeLabel}">{waiverEmoji(g.gradeLabel)} {g.gradeLabel}</span>
              <span class="par-line">{g.name} ({g.position}) · {fp(g.par)} PAR</span>
            {/if}
            <span class="expand-toggle">{isExp?'▲':'▼'}</span>
          </div>
          {#if isExp}
            <div class="tx-detail">
              {#if tx.type==='trade'&&!tx.isComposite&&g}
                <p class="narrative">{g.narrative?.summary}</p>
                <div class="trade-sides">
                  {#each tx.rosters as roster, idx}
                    {@const side=idx===0?g.side0:g.side1} {@const isWin=g.winner===idx}
                    <div class="side {isWin?'winner':''}">
                      <div class="side-header">{isWin?'🏆 ':''}{mdn(tx.managerIds?.[idx])} received:</div>
                      <div class="side-par">PAR: <span class="{parClass(side?.parTotal)}">{signedFp(side?.parTotal)}</span></div>
                      {#each (side?.players||[]) as p}
                        <div class="player-block">
                          <div class="p-row"><span class="pos">{p.position}</span><strong>{p.name}</strong><span class="{parClass(p.par)}">{signedFp(p.par)} PAR</span></div>
                          <div class="p-stats">{fp(p.totalPts)} total · {p.weeksHeld} wks · baseline: {fp(p.baseline)} ({p.repName})</div>
                          {#if p.weekBreakdown?.length}
                            <table class="wk-table">
                              <thead><tr><th>Wk</th><th>Player</th><th>Rep/wk</th><th>PAR</th></tr></thead>
                              <tbody>
                                {#each p.weekBreakdown as row}
                                  <tr><td>{row.week}</td><td>{fp(row.playerPts)}</td><td>{fp(row.repBaseline)}</td><td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td></tr>
                                {/each}
                                <tr class="totals"><td>Total</td><td>{fp(p.totalPts)}</td><td>{fp(p.baseline)}</td><td class="{parClass(p.par)}">{signedFp(p.par)}</td></tr>
                              </tbody>
                            </table>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>
              {:else if tx.type==='waiver'&&g}
                <p class="narrative">{g.gradeSummary}</p>
                <div class="waiver-grid">
                  <div class="w-section"><div class="w-header">📥 Pickup</div><div class="p-row"><span class="pos">{g.position}</span><strong>{g.name}</strong></div><div class="p-stats">{fp(g.totalPts)} total · {g.weeksHeld} wks{g.isStream?' (stream)':''}</div></div>
                  <div class="w-section"><div class="w-header">📊 Replacement</div><div class="p-row"><strong>{g.repName}</strong></div><div class="p-stats">{fp(g.repSeasonTotal)}/season ÷ 17 = {fp(g.repPerWeek)}/wk × {g.weeksHeld} = {fp(g.baseline)}</div></div>
                  <div class="w-section"><div class="w-header">🎯 Result</div><div class="formula">{fp(g.totalPts)} − {fp(g.baseline)} = <strong class="{parClass(g.par)}">{signedFp(g.par)} PAR</strong></div></div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showTxDebug=!showTxDebug)}>{showTxDebug?'Hide':'Show'} Debug</button>
      </div>
      {#if showTxDebug}<div class="debug-terminal"><h4>Debug</h4><ul>{#each transactionDebug as l}<li><code>{l}</code></li>{/each}</ul></div>{/if}
    {/if}

  <!-- ════════ DRAFT ════════ -->
  {:else if mainTab === 'draft'}
    <h2>Draft Analysis</h2>
    <div class="control-row">
      <button on:click={loadDrafts} disabled={loadingDrafts}>
        {loadingDrafts?'Loading...':allDrafts.length?'Reload':'Load Draft Data'}
      </button>
    </div>
    {#if loadingDrafts}<div class="status-msg">Computing draft grades...</div>
    {:else if allDrafts.length}
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={selectedDraftYear} on:change={() => selectDraft(selectedDraftYear)}>
          {#each draftYearOptions as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        <div class="tab-group">
          <button class="tab-btn {draftActiveTab==='end'?'active':''}" on:click={() => (draftActiveTab='end')}>Post-Season</button>
          <button class="tab-btn {draftActiveTab==='pre'?'active':''}" on:click={() => (draftActiveTab='pre')}>Pre-Season</button>
        </div>
      </div>

      {#if draftActiveTab === 'end'}
        {#if endOfSeasonGrade}
          <h3>{endOfSeasonGrade.year} Post-Season Draft Grade</h3>
          <div class="explainer">
            <strong>Adjusted PAR = Actual PAR − Expected PAR.</strong>
            Actual PAR = actual pts − positional replacement level.
            Expected PAR = historical avg per round (baseline: {endOfSeasonGrade.baselineSeasons?.join(', ')}).
            K/DEF: adjustedPAR = actualPAR directly.
          </div>
          <div class="ref-grid">
            <div class="ref-panel">
              <div class="ref-title">📊 Expected PAR by Round</div>
              <div class="baseline-pills">
                {#each Object.entries(endOfSeasonGrade.expectedPARByRound||{}).sort(([a],[b])=>Number(a)-Number(b)) as [r,v]}
                  <div class="baseline-pill"><span class="bl-round">R{r}</span><span class="bl-pts">{signedFp(v)}</span><span class="bl-n muted">{endOfSeasonGrade.sampleSizes?.[r]}yr</span></div>
                {/each}
              </div>
            </div>
            <div class="ref-panel">
              <div class="ref-title">🔄 Replacement Levels</div>
              <div class="rep-pills">
                {#each Object.entries(endOfSeasonGrade.replacementLevels||{}).sort(([a],[b])=>a.localeCompare(b)) as [pos,pts]}
                  <div class="rep-pill"><span class="rp-pos">{pos}</span><span class="rp-pts">{fp(pts)}</span><span class="rp-name muted">{endOfSeasonGrade.replacementNames?.[pos]||'?'}</span></div>
                {/each}
              </div>
            </div>
          </div>
          <h4>Team Grades</h4>
          <table class="data-table">
            <thead><tr><th>#</th><th>Manager</th><th>Grade</th><th>Adj PAR</th><th>Excl Inj</th><th>Actual Pts</th><th>🤕</th><th>Best Pick</th><th>Worst Pick</th></tr></thead>
            <tbody>
              {#each endOfSeasonGrade.teamRankings as team, i}
                <tr>
                  <td>#{i+1}</td><td><strong>{mdn(team.managerId)}</strong></td>
                  <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                  <td class="{parClass(team.totalAdjustedPAR)}">{signedFp(team.totalAdjustedPAR)}</td>
                  <td class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</td>
                  <td>{fp(team.totalActualPts)}</td>
                  <td>{team.injured.length||'—'}</td>
                  <td>{team.bestPick?`${team.bestPick.playerName} R${team.bestPick.round}`:''}</td>
                  <td>{team.worstPick?`${team.worstPick.playerName} R${team.worstPick.round} ${injIcon(team.worstPick.injuryFlag)}`:''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div class="two-col">
            <div>
              <h4>🔥 Biggest Steals</h4>
              <table class="data-table">
                <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Act PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Manager</th></tr></thead>
                <tbody>{#each endOfSeasonGrade.leagueTopSteals as p}<tr><td>{p.playerName}</td><td>{p.pos}</td><td>{p.round}</td><td class="muted">{signedFp(p.actualPAR)}</td><td class="muted">{p.noRoundAdjustment?'0':signedFp(p.expectedPAR)}</td><td class="positive">{signedFp(p.adjustedPAR)}</td><td>{mdn(p.managerId)}</td></tr>{/each}</tbody>
              </table>
            </div>
            <div>
              <h4>💀 Biggest Busts</h4>
              <table class="data-table">
                <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Act PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Inj</th><th>Manager</th></tr></thead>
                <tbody>{#each endOfSeasonGrade.leagueTopBusts as p}<tr><td>{p.playerName}</td><td>{p.pos}</td><td>{p.round}</td><td class="muted">{signedFp(p.actualPAR)}</td><td class="muted">{p.noRoundAdjustment?'0':signedFp(p.expectedPAR)}</td><td class="negative">{signedFp(p.adjustedPAR)}</td><td>{injIcon(p.injuryFlag)||'—'}</td><td>{mdn(p.managerId)}</td></tr>{/each}</tbody>
              </table>
            </div>
          </div>
          <h4>Full Team Breakdowns</h4>
          {#each endOfSeasonGrade.teamRankings as team}
            <div class="team-block">
              <div class="team-header">
                <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
                <strong>{mdn(team.managerId)}</strong>
                <span class="header-stat">Adj PAR: <span class="{parClass(team.totalAdjustedPAR)}">{signedFp(team.totalAdjustedPAR)}</span></span>
                <span class="header-stat muted">{fp(team.totalActualPts)} pts</span>
                {#if team.injured.length}<span class="header-stat muted">🤕 {team.injured.length} · excl: <span class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</span></span>{/if}
              </div>
              <div class="table-scroll">
                <table class="data-table mini">
                  <thead><tr><th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th><th>Actual</th><th>Act PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Games</th><th>Label</th></tr></thead>
                  <tbody>
                    {#each team.picks as p}
                      <tr class="{p.injuryFlag?'injury-row':''}">
                        <td>{p.round}</td><td>#{p.pickNo}</td>
                        <td>{p.playerName}{p.injuryFlag?' '+injIcon(p.injuryFlag):''}</td>
                        <td><span class="pos">{p.pos}</span></td>
                        <td>{fp(p.actualPts)}</td>
                        <td class="muted">{signedFp(p.actualPAR)}</td>
                        <td class="muted">{p.noRoundAdjustment?'0 (K/DEF)':signedFp(p.expectedPAR)}</td>
                        <td class="{parClass(p.adjustedPAR)}">{p.adjustedPAR!=null?signedFp(p.adjustedPAR):'—'}</td>
                        <td class="{p.injuryFlag?'negative':'muted'}">{p.gamesPlayed??'—'}</td>
                        <td><span class="vl-tag {valueLabelClass(p.valueLabel)}">{p.valueLabel}</span></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="pos-breakdown">
                {#each Object.entries(team.byPosition).sort(([a],[b])=>a.localeCompare(b)) as [pos,data]}
                  <div class="pos-card">
                    <div class="pos-label">{pos}</div>
                    <div class="pos-stat">{data.picks} picks</div>
                    <div class="pos-stat">{fp(data.totalActualPts)} pts</div>
                    <div class="pos-par {data.totalAdjustedPAR>=0?'positive':'negative'}">{signedFp(data.totalAdjustedPAR)}</div>
                  </div>
                {/each}
              </div>
              <div class="round-breakdown">
                <span class="muted">Adj PAR by round:</span>
                {#each Object.entries(team.byRound).sort(([a],[b])=>Number(a)-Number(b)) as [rnd,data]}
                  <span class="round-pill {data.totalAdjustedPAR>=0?'positive-bg':'negative-bg'}">R{rnd}: {signedFp(data.totalAdjustedPAR)}</span>
                {/each}
              </div>
            </div>
          {/each}
        {:else}<div class="status-msg">Load Draft Data to see grades.</div>{/if}

      {:else if draftActiveTab === 'pre'}
        {#if preSeasonGrade}
          <h3>{preSeasonGrade.year} Pre-Season Grade</h3>
          <table class="data-table">
            <thead><tr><th>#</th><th>Manager</th><th>Grade</th><th>Avg vs Market</th><th>Best Pick</th><th>Worst Pick</th></tr></thead>
            <tbody>
              {#each preSeasonGrade.teamRankings as team, i}
                <tr>
                  <td>#{i+1}</td><td>{mdn(team.managerId)}</td>
                  <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                  <td class="{(parseFloat(team.avgVsMarket)||0)>=0?'positive':'negative'}">{signedFp(team.avgVsMarket)} picks</td>
                  <td>{team.bestValuePick?`${team.bestValuePick.playerName} R${team.bestValuePick.round}`:''}</td>
                  <td>{team.worstValuePick?`${team.worstValuePick.playerName} R${team.worstValuePick.round}`:''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}<div class="status-msg">Load Draft Data first.</div>{/if}
      {/if}
      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showDraftDebug=!showDraftDebug)}>{showDraftDebug?'Hide':'Show'} Debug</button>
      </div>
      {#if showDraftDebug}<div class="debug-terminal"><h4>Draft Debug</h4><ul>{#each draftDebug as l}<li><code>{l}</code></li>{/each}</ul></div>{/if}
    {/if}

  <!-- ════════ LLM ════════ -->
  {:else if mainTab === 'llm'}
    <h2>LLM Draft Context</h2>
    <div class="explainer">Generate context for post-draft qualitative grading. Manager grades use post-season data grades automatically — this is for narrative grading only.</div>
    {#if !allDrafts.length}
      <div class="control-row"><button on:click={loadDrafts} disabled={loadingDrafts}>{loadingDrafts?'Loading...':'Load Draft Data First'}</button></div>
    {:else}
      <div class="control-row">
        <select bind:value={llmSelectedYear} on:change={() => llmSelectedYear&&buildLLM(llmSelectedYear)}>
          <option value={null}>Select year...</option>
          {#each draftYearOptions as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        {#if llmSelectedYear}<button on:click={() => buildLLM(llmSelectedYear)}>Generate</button>{/if}
      </div>
      {#if llmPromptText}
        <div class="llm-section">
          <div class="llm-header"><h4>Full Prompt</h4><button class="copy-btn {copiedPrompt?'copied':''}" on:click={() => copy(llmPromptText,'p')}>{copiedPrompt?'✓ Copied!':'Copy'}</button></div>
          <pre class="llm-text">{llmPromptText}</pre>
        </div>
        <div class="two-col" style="margin-top:1rem;">
          <div class="llm-section">
            <div class="llm-header"><h4>History</h4><button class="copy-btn {copiedHistory?'copied':''}" on:click={() => copy(llmHistoryText,'h')}>{copiedHistory?'✓':'Copy'}</button></div>
            <pre class="llm-text small">{llmHistoryText}</pre>
          </div>
          <div class="llm-section">
            <div class="llm-header"><h4>Current Draft</h4><button class="copy-btn {copiedCurrent?'copied':''}" on:click={() => copy(llmCurrentText,'c')}>{copiedCurrent?'✓':'Copy'}</button></div>
            <pre class="llm-text small">{llmCurrentText}</pre>
          </div>
        </div>
      {/if}
    {/if}

  <!-- ════════ MANAGER GRADES ════════ -->
  {:else if mainTab === 'managers'}
    <h2>Manager Grades</h2>
    <div class="explainer">
      <strong>Weights:</strong> 40% Draft (post-season adj PAR) · 20% Trades · 20% Waivers · 20% Lineup IQ.<br/>
      <strong>Scoring:</strong> Z-score centered at 50 (league avg = 50, ±1 std dev = ±25 pts). Zero activity = 50 neutral. Only managers active that season are included.
    </div>
    <div class="control-row">
      <button on:click={loadManagerGrades} disabled={loadingManagers}>{loadingManagers?'Loading...':rosterStats?'Reload':'Load Manager Grades'}</button>
      {#if !transactionHistory}<span class="muted">⚠ Load Transactions first.</span>{/if}
      {#if !allDrafts.length}<span class="muted">⚠ Load Draft Data first.</span>{/if}
    </div>

    {#if Object.keys(seasonManagerGrades).length}
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={managerGradeYear} on:change={recomputeGrades}>
          {#each currentSeasonYears as yr}<option value={yr}>{yr}</option>{/each}
        </select>
      </div>

      {#if managerGradeYear}
        {@const yg = seasonManagerGrades[String(managerGradeYear)] || {}}
        {@const activeIds = getActiveManagerIds(managerGradeYear)}
        <h3>{managerGradeYear} Season Grades</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Manager</th><th>Overall</th>
              <th>Draft (40%)</th><th>Trades (20%)</th>
              <th>Waivers (20%)</th><th>Lineup IQ (20%)</th>
              <th>Missing</th>
            </tr>
          </thead>
          <tbody>
            {#each activeIds.sort((a,b)=>(yg[b]?.overallGrade??-1)-(yg[a]?.overallGrade??-1)) as mgrId}
              {@const r=yg[mgrId]}
              <tr>
                <td><strong>{mdn(mgrId)}</strong></td>
                <td>{#if r?.overallGrade!=null}<span class="score-pill" style="background:{scoreColor(r.overallGrade)};">{fp(r.overallGrade,0)}</span>{:else}—{/if}</td>
                <td>
                  {#if r?.normDraft!=null}<span class="score-pill" style="background:{scoreColor(r.normDraft)};">{fp(r.normDraft,0)}</span><div class="muted" style="font-size:0.8em;">{signedFp(r.rawDraftPAR)} adj PAR</div>
                  {:else}<span class="muted">—</span>{/if}
                </td>
                <td>
                  <span class="score-pill" style="background:{scoreColor(r?.normTrade)};">{fp(r?.normTrade,0)}</span>
                  <div class="muted" style="font-size:0.8em;">{r?.rawTradePAR!=null?signedFp(r.rawTradePAR)+' PAR':'no trades'}</div>
                </td>
                <td>
                  <span class="score-pill" style="background:{scoreColor(r?.normWaiver)};">{fp(r?.normWaiver,0)}</span>
                  <div class="muted" style="font-size:0.8em;">{r?.rawWaiverPAR!=null?signedFp(r.rawWaiverPAR)+' PAR':'no waivers'}</div>
                </td>
                <td>
                  {#if r?.normLineup!=null}<span class="score-pill" style="background:{scoreColor(r.normLineup)};">{fp(r.normLineup,0)}</span><div class="muted" style="font-size:0.8em;">{pct(r.rawLineupIQ)} eff.</div>
                  {:else}<span class="muted">—</span>{/if}
                </td>
                <td class="muted">{r?.missingComponents?.join(', ')||'—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      {#if Object.keys(allTimeManagerGrades).length}
        <h3>All-Time Manager Grades</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Manager</th><th>All-Time Grade</th>
              <th>Avg Draft</th><th>Avg Trades</th><th>Avg Waivers</th><th>Avg Lineup IQ</th>
              <th>Seasons</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(allTimeManagerGrades).sort(([,a],[,b])=>(b.allTimeGrade??-1)-(a.allTimeGrade??-1)) as [mgrId, data]}
              <tr>
                <td><strong>{mdn(mgrId)}</strong></td>
                <td>{#if data.allTimeGrade!=null}<span class="score-pill" style="background:{scoreColor(data.allTimeGrade)};">{fp(data.allTimeGrade,0)}</span>{:else}—{/if}</td>
                <td>{#if data.avgNormDraft!=null}<span class="score-pill" style="background:{scoreColor(data.avgNormDraft)};font-size:0.85em;">{fp(data.avgNormDraft,0)}</span><div class="muted" style="font-size:0.78em;">{signedFp(data.avgRawDraftPAR)} PAR avg</div>{:else}<span class="muted">—</span>{/if}</td>
                <td>{#if data.avgNormTrade!=null}<span class="score-pill" style="background:{scoreColor(data.avgNormTrade)};font-size:0.85em;">{fp(data.avgNormTrade,0)}</span><div class="muted" style="font-size:0.78em;">{signedFp(data.avgRawTradePAR)} PAR avg</div>{:else}<span class="muted">—</span>{/if}</td>
                <td>{#if data.avgNormWaiver!=null}<span class="score-pill" style="background:{scoreColor(data.avgNormWaiver)};font-size:0.85em;">{fp(data.avgNormWaiver,0)}</span><div class="muted" style="font-size:0.78em;">{signedFp(data.avgRawWaiverPAR)} PAR avg</div>{:else}<span class="muted">—</span>{/if}</td>
                <td>{#if data.avgNormLineup!=null}<span class="score-pill" style="background:{scoreColor(data.avgNormLineup)};font-size:0.85em;">{fp(data.avgNormLineup,0)}</span><div class="muted" style="font-size:0.78em;">{pct(data.avgRawLineupIQ)} avg eff.</div>{:else}<span class="muted">—</span>{/if}</td>
                <td>
                  <span class="muted">{data.years?.join(', ')}</span>
                  {#each (data.perSeason||[]) as s}
                    <div style="font-size:0.76em; color:#888;">{s.year}: {s.overallGrade!=null?fp(s.overallGrade,0):'—'}</div>
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showManagerDebug=!showManagerDebug)}>{showManagerDebug?'Hide':'Show'} Debug</button>
      </div>
      {#if showManagerDebug}<div class="debug-terminal"><h4>Manager Debug</h4><ul>{#each managerDebug as l}<li><code>{l}</code></li>{/each}</ul></div>{/if}
    {/if}

  <!-- ════════ STRENGTH OF SCHEDULE ════════ -->
  {:else if mainTab === 'sos'}
    <h2>Strength of Schedule</h2>
    <div class="explainer">
      <strong>Points SOS:</strong> avg points opponents scored against you (regular season only).<br/>
      <strong>Record SOS:</strong> avg final win% of your regular-season opponents.<br/>
      <strong>Luck:</strong> actual win% minus expected win% based on your score vs all other scores each week.
    </div>
    {#if !rosterStats&&Object.keys(seasonSOSByYear).length===0}
      <div class="control-row"><button on:click={loadManagerGrades} disabled={loadingManagers}>{loadingManagers?'Computing...':'Load Schedule Data'}</button></div>
    {:else}
      <div class="control-row">
        <label><strong>View:</strong></label>
        <select bind:value={sosYear}>
          <option value={null}>All-Time</option>
          {#each Object.keys(seasonSOSByYear).sort((a,b)=>Number(b)-Number(a)) as yr}<option value={yr}>{yr}</option>{/each}
        </select>
      </div>
      {#if sosYear == null}
        <h3>All-Time Strength of Schedule</h3>
        <table class="data-table">
          <thead><tr><th>Manager</th><th>Avg Opp Pts</th><th>Avg Opp Win%</th><th>Avg Luck</th><th>Luck Label</th><th>Seasons</th></tr></thead>
          <tbody>
            {#each Object.entries(allTimeSOS).sort(([,a],[,b])=>b.avgOpponentPts-a.avgOpponentPts) as [mgrId,data]}
              <tr>
                <td><strong>{mdn(mgrId)}</strong></td>
                <td>{fp(data.avgOpponentPts)}</td>
                <td>{data.avgOpponentWinPct!=null?pct(data.avgOpponentWinPct):'—'}</td>
                <td class="{parClass(data.avgLuck)}">{data.avgLuck!=null?signedFp(data.avgLuck*100,1)+'%':'—'}</td>
                <td><span class="luck-tag luck-{data.luckLabel?.replace(/\s/g,'-')}">{data.luckLabel||'—'}</span></td>
                <td class="muted">{data.seasons}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        {@const yearSOS=seasonSOSByYear[sosYear]||{}}
        <h3>{sosYear} Strength of Schedule</h3>
        <table class="data-table">
          <thead><tr><th>Manager</th><th>Avg Opp Pts</th><th>Avg Opp Win%</th><th>Actual Wins</th><th>Expected Win%</th><th>Actual Win%</th><th>Luck</th><th>Label</th></tr></thead>
          <tbody>
            {#each Object.entries(yearSOS).sort(([,a],[,b])=>b.avgOpponentPts-a.avgOpponentPts) as [mgrId,data]}
              <tr>
                <td><strong>{mdn(mgrId)}</strong></td>
                <td>{fp(data.avgOpponentPts)}</td>
                <td>{data.avgOpponentWinPct!=null?pct(data.avgOpponentWinPct):'—'}</td>
                <td>{data.actualWins}</td>
                <td class="muted">{data.expectedWinRate!=null?pct(data.expectedWinRate):'—'}</td>
                <td>{data.actualWinRate!=null?pct(data.actualWinRate):'—'}</td>
                <td class="{parClass(data.luck)}">{data.luck!=null?signedFp(data.luck*100,1)+'%':'—'}</td>
                <td><span class="luck-tag luck-{data.luckLabel?.replace(/\s/g,'-')}">{data.luckLabel||'—'}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}

  <!-- ════════ POWER RANKINGS ════════ -->
  {:else if mainTab === 'power'}
    <h2>Power Rankings</h2>
    <div class="explainer">
      <strong>Pre-season:</strong> 60% all-time manager grade + 40% prior season placement.<br/>
      <strong>In-season (wks 1-{REGULAR_SEASON_WEEKS}):</strong> record/points/form/manager grade blend. Manager grade fades 40%→15%→5% as season progresses.
    </div>
    <div class="control-row">
      <label><strong>Season:</strong></label>
      <select bind:value={powerYear}>
        <option value={null}>Select...</option>
        {#each currentSeasonYears as yr}<option value={yr}>{yr}</option>{/each}
      </select>
      <button on:click={() => powerYear&&loadPowerRankings(powerYear)} disabled={loadingPower||!powerYear}>
        {loadingPower?'Computing...':'Compute Rankings'}
      </button>
      {#if !Object.keys(seasonManagerGrades).length}
        <span class="muted">⚠ Load Manager Grades first.</span>
      {/if}
    </div>

    {#if loadingPower}
      <div class="status-msg">Computing weekly rankings...</div>
    {:else if preSeasonRankings || endOfSeasonRankings}
      <div class="rankings-grid">
        {#if preSeasonRankings}
          <div class="rankings-card">
            <h3>Pre-Season Rankings ({preSeasonRankings.year})</h3>
            <p class="sub">60% manager history + 40% prior season placement</p>
            <table class="data-table">
              <thead><tr><th>#</th><th>Manager</th><th>Score</th><th>Mgr Grade</th><th>Prev Placement</th></tr></thead>
              <tbody>
                {#each preSeasonRankings.rankings as team}
                  <tr>
                    <td><strong>#{team.rank}</strong></td>
                    <td><span class="mgr-color-dot" style="background:{managerColors[team.managerId]||'#888'};"></span>{mdn(team.managerId)}</td>
                    <td><strong>{fp(team.score)}</strong></td>
                    <td class="muted">{team.mgrGrade!=null?fp(team.mgrGrade,0):'—'}</td>
                    <td class="muted">{team.prevPlacement!=null?`#${team.prevPlacement}`:'(first season)'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if endOfSeasonRankings}
          <div class="rankings-card">
            <h3>End-of-Season Rankings (Week {REGULAR_SEASON_WEEKS})</h3>
            <p class="sub">Phase: <strong>{endOfSeasonRankings.phase}</strong></p>
            <table class="data-table">
              <thead><tr><th>#</th><th>Manager</th><th>Score</th><th>Record</th><th>PF</th></tr></thead>
              <tbody>
                {#each endOfSeasonRankings.rankings as team}
                  <tr>
                    <td><strong>#{team.rank}</strong></td>
                    <td><span class="mgr-color-dot" style="background:{managerColors[team.managerId]||'#888'};"></span>{mdn(team.managerId)}</td>
                    <td><strong>{fp(team.compositeScore)}</strong></td>
                    <td>{team.wins}-{team.losses}{team.ties>0?`-${team.ties}`:''}</td>
                    <td>{fp(team.pf)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      {#if weeklyProgressionData.length > 1}
        {@const numTeams = weeklyProgressionData[0]?.rankings?.length || 12}
        {@const chartW=700} {@const chartH=320} {@const padL=36} {@const padR=40} {@const padT=12} {@const padB=32}
        {@const plotW=chartW-padL-padR} {@const plotH=chartH-padT-padB}
        <h3>Season Rank Progression</h3>
        <p class="sub">Lower = better. Hover for week details.</p>
        <div class="chart-container">
          <svg viewBox="0 0 {chartW} {chartH}" class="rank-chart"
            on:mousemove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x    = e.clientX - rect.left - padL;
              chartHoverWeek = Math.max(0, Math.min(REGULAR_SEASON_WEEKS, Math.round((x / plotW) * REGULAR_SEASON_WEEKS)));
            }}
            on:mouseleave={() => { chartHoverWeek = null; }}>
            {#each Array.from({length:numTeams},(_,i)=>i+1) as rnk}
              {#if rnk===1||rnk===Math.ceil(numTeams/2)||rnk===numTeams}
                {@const y=padT+((rnk-1)/(numTeams-1))*plotH}
                <text x={padL-4} y={y+4} text-anchor="end" class="axis-label">#{rnk}</text>
                <line x1={padL} y1={y} x2={padL+plotW} y2={y} class="grid-line"/>
              {/if}
            {/each}
            {#each [0,2,4,6,8,10,12,14] as wk}
              {#if wk<=REGULAR_SEASON_WEEKS}
                {@const x=padL+(wk/REGULAR_SEASON_WEEKS)*plotW}
                <text x={x} y={padT+plotH+18} text-anchor="middle" class="axis-label">{wk===0?'Pre':'Wk '+wk}</text>
                <line x1={x} y1={padT} x2={x} y2={padT+plotH} class="grid-line light"/>
              {/if}
            {/each}
            {#each allManagerIds as managerId}
              {@const color=managerColors[managerId]||'#888'}
              {@const path=chartPath(managerId,weeklyProgressionData,plotW,plotH,numTeams)}
              {#if path}
                <path d="M {path.replace(/^M /,'')}" transform="translate({padL},{padT})"
                  fill="none" stroke={color} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
              {/if}
              {#if weeklyProgressionData[REGULAR_SEASON_WEEKS]}
                {@const lastEntry=weeklyProgressionData[REGULAR_SEASON_WEEKS].rankings.find(r=>r.managerId===managerId)}
                {#if lastEntry}
                  {@const ex=padL+plotW} {@const ey=padT+((lastEntry.rank-1)/(numTeams-1))*plotH}
                  <circle cx={ex} cy={ey} r="4" fill={color}/>
                  <text x={ex+6} y={ey+4} class="end-label" fill={color}>#{lastEntry.rank}</text>
                {/if}
              {/if}
            {/each}
            {#if chartHoverWeek!=null}
              {@const hx=padL+(chartHoverWeek/REGULAR_SEASON_WEEKS)*plotW}
              <line x1={hx} y1={padT} x2={hx} y2={padT+plotH} class="hover-line"/>
              {#if weeklyProgressionData[chartHoverWeek]}
                {#each weeklyProgressionData[chartHoverWeek].rankings as entry}
                  {@const color=managerColors[entry.managerId]||'#888'}
                  {@const hy=padT+((entry.rank-1)/(numTeams-1))*plotH}
                  <circle cx={hx} cy={hy} r="5" fill={color} stroke="white" stroke-width="1.5"/>
                {/each}
              {/if}
            {/if}
          </svg>
          <div class="chart-legend">
            {#each allManagerIds as managerId}
              <div class="legend-item">
                <span class="legend-dot" style="background:{managerColors[managerId]||'#888'};"></span>
                <span>{mdn(managerId)}</span>
              </div>
            {/each}
          </div>
          {#if chartHoverWeek!=null&&weeklyProgressionData[chartHoverWeek]}
            <div class="hover-tooltip">
              <strong>{chartHoverWeek===0?'Pre-Season':`Week ${chartHoverWeek}`}</strong>
              {#each weeklyProgressionData[chartHoverWeek].rankings as entry}
                <div class="tooltip-row">
                  <span class="legend-dot" style="background:{managerColors[entry.managerId]||'#888'};"></span>
                  <span>#{entry.rank} {mdn(entry.managerId)}</span>
                  <span class="muted">{fp(entry.compositeScore)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}

  <!-- ════════ EXPORT ════════ -->
  {:else if mainTab === 'export'}
    <h2>Export for LLM</h2>
    <div class="explainer">
      Export league data as Markdown for a <strong>Claude Project</strong> (claude.ai → Projects → New → Add content).
      Always <strong>overwrite</strong> files rather than adding new ones — you only need 4 files total, regardless of seasons or weeks.
    </div>

    {#if !allTimeHistory}
      <div class="status-msg">Load data first: Transactions → Draft Data → Manager Grades (in that order).</div>
    {:else}
      <div class="file-guide">
        <h4>4 Files, Always (overwrite, never accumulate)</h4>
        <div class="file-grid">
          <div class="file-pill static"><div class="file-name">league_context.md</div><div class="file-freq">Upload once</div></div>
          <div class="file-pill yearly"><div class="file-name">all_time_history.md</div><div class="file-freq">Replace each year</div></div>
          <div class="file-pill weekly"><div class="file-name">current_season.md</div><div class="file-freq">Replace each week</div></div>
          <div class="file-pill weekly"><div class="file-name">current_week.md</div><div class="file-freq">Replace each week</div></div>
        </div>
      </div>

      <div class="control-row">
        <label><strong>Current week:</strong></label>
        <select bind:value={exportWeek}>
          {#each Array.from({length:17},(_,i)=>i+1) as w}<option value={w}>Week {w}</option>{/each}
        </select>
        <span class="muted">Set before generating week/season exports.</span>
      </div>

      <h3>Generate Files</h3>
      <div class="export-card-grid">
        {#each EXPORT_CONFIGS as config}
          <div class="export-card {exportPreviewType===config.key?'active-card':''}">
            <div class="export-card-header">
              <div>
                <div class="export-card-title">{config.title}</div>
                <code class="export-filename">{config.filename}</code>
              </div>
              <!-- In the export card, change the button label -->
              <button
                class="copy-btn {exportCopied[config.key]?'copied':''}"
                on:click={() => generateExport(config.key)}
              >
                {exportCopied[config.key] ? '✓ Downloaded!' : 'Download & Copy'}
              </button>
            </div>
            <p class="export-desc">{config.desc}</p>
            <div class="export-freq">{config.freq}</div>
          </div>
        {/each}
      </div>

      {#if exportPreview}
        <div class="preview-panel">
          <div class="preview-header">
            <div>
              <h4 style="margin:0;">{exportPreviewTitle}</h4>
              <span class="muted">{exportPreview.split('\n').length} lines · ~{Math.round(exportPreview.length/4)} tokens</span>
            </div>
            <button class="copy-btn {mainCopied?'copied':''}" on:click={() => {
              downloadMarkdown(exportPreview, exportPreviewTitle);
              clipboardCopy(exportPreview);
              mainCopied = true;
              setTimeout(() => { mainCopied = false; }, 2000);
            }}>
              {mainCopied ? '✓ Downloaded!' : 'Download Again'}
            </button>
          </div>
          <pre class="export-preview-text">{exportPreview}</pre>
        </div>
      {/if}

      <h3>Project Guides</h3>
      <div class="project-guide-grid">
        <div class="project-guide">
          <div class="pg-title">📅 Weekly Recap</div>
          <div class="pg-files">
            <span class="file-ref">league_context.md</span>
            <span class="file-ref">current_season.md</span>
            <span class="file-ref">current_week.md</span>
          </div>
          <p class="muted">Replace season + week files each week.</p>
        </div>
        <div class="project-guide">
          <div class="pg-title">📰 Pre-Draft / End of Season</div>
          <div class="pg-files">
            <span class="file-ref">league_context.md</span>
            <span class="file-ref">all_time_history.md</span>
            <span class="file-ref">pre_draft.md</span>
          </div>
          <p class="muted">Replace history + pre_draft once per year.</p>
        </div>
        <div class="project-guide">
          <div class="pg-title">📋 Draft Grades</div>
          <div class="pg-files">
            <span class="file-ref">league_context.md</span>
            <span class="file-ref">all_time_history.md</span>
            <span class="file-ref">pre_draft.md</span>
          </div>
          <p class="muted">Generate pre_draft.md right after draft.</p>
        </div>
      </div>

      <h3>Article Prompts</h3>
      <p class="muted">Paste these as your first message in the relevant Claude Project.</p>
      <div class="prompt-list">
        {#each Object.entries(PROMPTS) as [key, prompt]}
          <div class="prompt-card">
            <div class="prompt-card-header">
              <strong>{PROMPT_LABELS[key]||key}</strong>
              <button class="copy-btn {promptCopied[key]?'copied':''}" on:click={() => copyPrompt(key, prompt)}>
                {promptCopied[key]?'✓ Copied!':'Copy Prompt'}
              </button>
            </div>
            <pre class="prompt-text">{prompt}</pre>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="control-row" style="margin-top:2rem;">
    <button on:click={() => (showGlobalDebug=!showGlobalDebug)}>{showGlobalDebug?'Hide':'Show'} Global Debug</button>
  </div>
  {#if showGlobalDebug}<div class="debug-terminal"><h4>Global Debug</h4><ul>{#each globalDebug as l}<li><code>{l}</code></li>{/each}</ul></div>{/if}
</main>

<style>
  .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  h1, h2, h3, h4 { margin: 0.75rem 0 0.5rem; }
  .sub { font-size: 0.86rem; color: #666; margin: -0.25rem 0 0.75rem; }
  .control-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  select, button { padding: 0.5rem 1rem; font-size: 0.93rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; margin-bottom: 1rem; }
  .muted { color: #888; font-size: 0.87em; }
  .explainer { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.87rem; color: #0c4a6e; line-height: 1.6; }

  .main-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 2rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  .tab-group  { display: flex; gap: 0.4rem; }
  .tab-btn { padding: 0.4rem 0.85rem; border-radius: 6px 6px 0 0; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.88rem; }
  .tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }

  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.85rem; }
  .data-table.mini { font-size: 0.79rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.3rem 0.45rem; text-align: center; }
  .data-table th { background: #f5f5f5; font-weight: 600; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .injury-row { background: #fff7ed; }
  .table-scroll { overflow-x: auto; }
  .totals td { background: #f8fafc; font-weight: 700; }

  .tx-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.6rem; overflow: hidden; }
  .tx-card.trade     { border-left: 4px solid #2563eb; }
  .tx-card.waiver    { border-left: 4px solid #16a34a; }
  .tx-card.composite { border-left: 4px solid #7c3aed; }
  .tx-summary { padding: 0.6rem 1rem; cursor: pointer; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; background: #fafafa; }
  .tx-summary:hover { background: #f0f0f0; }
  .tx-meta { display: flex; gap: 0.35rem; align-items: center; flex-shrink: 0; }
  .tx-managers { font-size: 0.87em; color: #444; flex: 1; min-width: 100px; }
  .tx-info { font-size: 0.81em; color: #666; }
  .par-line { font-size: 0.83em; color: #555; }
  .expand-toggle { margin-left: auto; color: #888; font-size: 0.78em; }
  .tx-detail { padding: 0.75rem 1rem 1rem; border-top: 1px solid #eee; }
  .narrative { font-style: italic; color: #444; margin: 0 0 0.75rem; font-size: 0.89em; background: #f9f9f9; padding: 0.5rem 0.75rem; border-radius: 4px; }
  .trade-sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px,1fr)); gap: 1rem; }
  .side { padding: 0.7rem; border-radius: 6px; background: #f8f8f8; border: 2px solid transparent; }
  .side.winner { background: #f0fff4; border-color: #34d399; }
  .side-header { font-weight: 700; margin-bottom: 0.3rem; font-size: 0.92em; }
  .side-par { font-size: 0.84em; color: #555; margin-bottom: 0.5rem; }
  .waiver-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
  .w-section { background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.65rem; }
  .w-header { font-weight: 700; color: #475569; font-size: 0.83em; margin-bottom: 0.35rem; }
  .formula { font-family: monospace; font-size: 0.88em; background: #f1f5f9; padding: 0.3rem 0.5rem; border-radius: 3px; }
  .player-block { background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.55rem; margin-top: 0.4rem; }
  .p-row { display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.2rem; }
  .p-stats { font-size: 0.81em; color: #555; }
  .pos { background: #e5e7eb; border-radius: 3px; padding: 0.08rem 0.3rem; font-size: 0.73em; font-weight: 700; }
  .count-badge { background: #e5e7eb; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.78rem; color: #555; margin-left: 0.5rem; font-weight: normal; }
  .wk-table { width: 100%; border-collapse: collapse; font-size: 0.8em; margin-top: 0.3rem; }
  .wk-table th, .wk-table td { border: 1px solid #e5e7eb; padding: 0.22rem 0.4rem; text-align: center; }
  .wk-table th { background: #f1f5f9; }

  .ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
  .ref-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; }
  .ref-title { font-weight: 700; font-size: 0.87em; color: #374151; margin-bottom: 0.5rem; }
  .baseline-pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .baseline-pill { background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.2rem 0.45rem; font-size: 0.79em; display: flex; flex-direction: column; align-items: center; min-width: 50px; }
  .bl-round { font-weight: 700; color: #374151; }
  .bl-pts { font-weight: 700; color: #2563eb; }
  .bl-n { font-size: 0.85em; }
  .rep-pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .rep-pill { background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.79em; display: flex; flex-direction: column; align-items: center; }
  .rp-pos { font-weight: 700; color: #374151; }
  .rp-pts { color: #555; }
  .rp-name { font-size: 0.88em; }
  .team-block { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1.25rem; overflow: hidden; }
  .team-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: #f9f9f9; border-bottom: 1px solid #eee; flex-wrap: wrap; }
  .header-stat { font-size: 0.88em; }
  .pos-breakdown { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.6rem 1rem; background: #fafafa; border-top: 1px solid #eee; }
  .pos-card { background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.35rem 0.55rem; min-width: 65px; text-align: center; }
  .pos-label { font-weight: 700; font-size: 0.78em; color: #374151; }
  .pos-stat { font-size: 0.76em; color: #555; }
  .pos-par { font-size: 0.8em; font-weight: 700; }
  .round-breakdown { display: flex; gap: 0.4rem; flex-wrap: wrap; padding: 0.5rem 1rem; background: #f8f8f8; border-top: 1px solid #eee; font-size: 0.83em; align-items: center; }
  .round-pill { padding: 0.15rem 0.45rem; border-radius: 3px; font-size: 0.85em; font-weight: 600; }
  .positive-bg { background: #d1fae5; color: #065f46; }
  .negative-bg { background: #fef2f2; color: #dc2626; }

  .llm-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; }
  .llm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .llm-header h4 { margin: 0; }
  .llm-text { white-space: pre-wrap; font-family: monospace; font-size: 0.78em; background: #1e1e1e; color: #d4d4d4; padding: 0.75rem; border-radius: 4px; max-height: 400px; overflow-y: auto; }
  .llm-text.small { max-height: 250px; font-size: 0.72em; }
  .copy-btn { padding: 0.3rem 0.8rem; font-size: 0.83rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
  .copy-btn.copied { background: #16a34a; }

  .score-pill { display: inline-block; padding: 0.2rem 0.55rem; border-radius: 4px; color: white; font-weight: 700; font-size: 0.9em; }

  .luck-tag { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.8em; font-weight: 600; background: #f3f4f6; color: #374151; }
  .luck-very-lucky, .luck-consistently-lucky   { background: #d1fae5; color: #065f46; }
  .luck-lucky, .luck-slightly-lucky            { background: #e0f2fe; color: #0369a1; }
  .luck-very-unlucky, .luck-consistently-unlucky { background: #fef2f2; color: #dc2626; }
  .luck-unlucky, .luck-slightly-unlucky        { background: #fff7ed; color: #c2410c; }

  .rankings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
  .rankings-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; }
  .rankings-card h3 { margin-top: 0; }
  .mgr-color-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 0.35rem; vertical-align: middle; }

  .chart-container { position: relative; margin-bottom: 2rem; }
  .rank-chart { width: 100%; max-width: 760px; display: block; background: white; border: 1px solid #e5e7eb; border-radius: 8px; cursor: crosshair; }
  .axis-label { font-size: 10px; fill: #888; font-family: system-ui, sans-serif; }
  .end-label  { font-size: 9px; font-family: system-ui, sans-serif; }
  .grid-line  { stroke: #e5e7eb; stroke-width: 1; }
  .grid-line.light { stroke: #f0f0f0; }
  .hover-line { stroke: #374151; stroke-width: 1; stroke-dasharray: 4,3; }
  .chart-legend { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; font-size: 0.82em; }
  .legend-item { display: flex; align-items: center; gap: 0.3rem; }
  .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .hover-tooltip { position: absolute; top: 12px; right: 12px; background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.82em; box-shadow: 0 2px 8px rgba(0,0,0,0.12); min-width: 180px; }
  .tooltip-row { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.2rem; justify-content: space-between; }

  /* Export */
  .file-guide { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
  .file-grid  { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .file-pill  { border-radius: 6px; padding: 0.5rem 0.75rem; min-width: 160px; }
  .file-pill.static { background: #dbeafe; border: 1px solid #93c5fd; }
  .file-pill.yearly { background: #d1fae5; border: 1px solid #6ee7b7; }
  .file-pill.weekly { background: #fef3c7; border: 1px solid #fcd34d; }
  .file-name  { font-family: monospace; font-size: 0.85em; font-weight: 700; color: #1e293b; }
  .file-freq  { font-size: 0.76em; color: #64748b; margin-top: 0.15rem; }
  .export-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px,1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .export-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; }
  .export-card.active-card { border-color: #2563eb; background: #eff6ff; }
  .export-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.5rem; }
  .export-card-title { font-weight: 700; font-size: 0.95em; color: #1e293b; }
  .export-filename { font-size: 0.8em; color: #2563eb; display: block; margin-top: 0.15rem; }
  .export-desc { font-size: 0.83em; color: #555; margin: 0 0 0.4rem; }
  .export-freq { font-size: 0.78em; color: #888; font-style: italic; }
  .preview-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 2rem; }
  .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .export-preview-text { white-space: pre-wrap; font-family: monospace; font-size: 0.77em; background: #1e1e1e; color: #d4d4d4; padding: 0.75rem; border-radius: 6px; max-height: 500px; overflow-y: auto; margin: 0; }
  .project-guide-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px,1fr)); gap: 1rem; margin-bottom: 2rem; }
  .project-guide { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.85rem 1rem; }
  .pg-title { font-weight: 700; margin-bottom: 0.4rem; }
  .pg-files { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  .file-ref { background: #e2e8f0; font-family: monospace; font-size: 0.78em; padding: 0.15rem 0.4rem; border-radius: 3px; color: #374151; }
  .prompt-list { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem; }
  .prompt-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.85rem 1rem; }
  .prompt-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .prompt-text { white-space: pre-wrap; font-size: 0.8em; color: #374151; background: #f0f4f8; padding: 0.5rem 0.75rem; border-radius: 4px; margin: 0; max-height: 160px; overflow-y: auto; }

  /* Badges / value labels */
  .badge { padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72em; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
  .badge.trade     { background: #dbeafe; color: #1d4ed8; }
  .badge.waiver    { background: #dcfce7; color: #15803d; }
  .badge.composite { background: #ede9fe; color: #6d28d9; }
  .grade-badge { padding: 0.18rem 0.55rem; border-radius: 4px; font-weight: 700; font-size: 0.84em; display: inline-block; }
  .grade-a { background: #d1fae5; color: #065f46; }
  .grade-b { background: #e0f2fe; color: #0369a1; }
  .grade-c { background: #fef3c7; color: #92400e; }
  .grade-d { background: #fed7aa; color: #9a3412; }
  .grade-f { background: #fef2f2; color: #dc2626; }
  .vl-tag        { display: inline-block; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.77em; font-weight: 600; }
  .vl-steal      { background: #d1fae5; color: #065f46; }
  .vl-value      { background: #e0f2fe; color: #0369a1; }
  .vl-neutral    { background: #f3f4f6; color: #6b7280; }
  .vl-slight-bust { background: #fff7ed; color: #c2410c; }
  .vl-bust       { background: #fef2f2; color: #dc2626; }
  .vl-reach      { background: #fff7ed; color: #c2410c; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.8em; margin-top: 1rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.18rem; }
</style>
