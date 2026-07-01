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
  import { computePowerRankings, computeRankMovement } from '$lib/utils/dataEngine/powerRankings.js';
  import { computeSeasonSOS, computeAllTimeSOS } from '$lib/utils/dataEngine/strengthOfSchedule.js';
  import { teamManagersStore } from '$lib/stores';

  // ── Global ────────────────────────────────────────────────────────────────
  let allTimeHistory  = null;
  let globalDebug     = [];
  let showGlobalDebug = false;
  let mainTab         = 'transactions';

  // ── Transactions ───────────────────────────────────────────────────────────
  let transactionHistory       = null;
  let loadingTransactions      = false;
  let gradedTransactions       = [];
  let allTimeTransactionTotals = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals  = [];
  let txFilter         = 'all';
  let showTxDebug      = false;
  let transactionDebug = [];
  let expandedTx       = new Set();
  let managerTradePARBySeason  = {};  // { [year]: { [managerId]: totalPAR } }
  let managerWaiverPARBySeason = {};

  // ── Drafts ─────────────────────────────────────────────────────────────────
  let allDrafts         = [];
  let loadingDrafts     = false;
  let draftDebug        = [];
  let showDraftDebug    = false;
  let selectedDraftYear = null;
  let preSeasonGrade    = null;
  let endOfSeasonGrade  = null;
  let draftActiveTab    = 'end';

  // All post-season draft grades by year — used for manager grades
  let draftGradesByYear = {};  // { [year]: { [managerId]: totalAdjustedPAR } }

  // ── LLM context ────────────────────────────────────────────────────────────
  let llmHistoryText  = '';
  let llmCurrentText  = '';
  let llmPromptText   = '';
  let llmSelectedYear = null;
  let copiedHistory   = false;
  let copiedCurrent   = false;
  let copiedPrompt    = false;

  // ── Manager grades ─────────────────────────────────────────────────────────
  let rosterStats          = null;
  let loadingManagers      = false;
  let managerDebug         = [];
  let showManagerDebug     = false;
  let seasonManagerGrades  = {};   // { [year]: { [managerId]: gradeResult } }
  let allTimeManagerGrades = {};
  let managerGradeYear     = null;
  let managerLineupIQBySeason = {}; // { [year]: { [managerId]: ratio } }

  // ── SOS ────────────────────────────────────────────────────────────────────
  let seasonSOSByYear = {};   // { [year]: { [managerId]: sosResult } }
  let allTimeSOS      = {};
  let sosYear         = null;

  // ── Power rankings ─────────────────────────────────────────────────────────
  let powerRankingsYear     = null;
  let powerRankingsWeek     = 0;
  let powerRankings         = null;
  let previousPowerRankings = null;
  let rankingsWithMovement  = [];
  let loadingPower          = false;

  // ── Reactive ───────────────────────────────────────────────────────────────
  $: draftYearOptions = allDrafts.map((d) => d.year).sort((a, b) => b - a);

  $: filteredTransactions = gradedTransactions
    .filter((tx) => !tx.isPartOfComposite)
    .filter((tx) => txFilter === 'all' || tx.type === txFilter);

  $: currentSeasonYears = allTimeHistory
    ? Object.keys(allTimeHistory.parTablesBySeason || {}).sort((a, b) => Number(b) - Number(a))
    : [];

  $: allManagerIds = allTimeHistory ? Object.keys(allTimeHistory.managers || {}) : [];

  $: if (transactionHistory && selectedTransactionSeason) {
    const snap = get(teamManagersStore) || {};
    seasonTransactionTotals = getSeasonTransactionTotals(
      transactionHistory.totals, selectedTransactionSeason, snap
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function managerDisplayName(managerId) {
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

  function gradeColor(grade) {
    if (!grade) return '';
    if (grade.startsWith('A')) return 'grade-a';
    if (grade.startsWith('B')) return 'grade-b';
    if (grade.startsWith('C')) return 'grade-c';
    if (grade.startsWith('D')) return 'grade-d';
    return 'grade-f';
  }

  function scoreColor(score) {
    if (score == null) return '';
    if (score >= 75) return '#16a34a';
    if (score >= 60) return '#65a30d';
    if (score >= 40) return '#d97706';
    if (score >= 25) return '#dc6803';
    return '#dc2626';
  }

  function valueLabelClass(label) {
    if (!label) return '';
    if (label === 'elite steal' || label === 'steal') return 'vl-steal';
    if (label === 'value')                            return 'vl-value';
    if (label === 'as expected')                      return 'vl-neutral';
    if (label === 'slight bust')                      return 'vl-slight-bust';
    if (label === 'bust' || label === 'major bust')   return 'vl-bust';
    if (label?.includes('reach'))                     return 'vl-reach';
    return 'vl-neutral';
  }

  function waiverGradeEmoji(label) {
    return { elite: '🔥', strong: '✅', solid: '👍', breakeven: '➖', poor: '❌' }[label] || '?';
  }

  function tradeGradeEmoji(grade) {
    return { lopsided: '💥', clear: '✅', close: '⚖️', even: '🤝' }[grade] || '?';
  }

  function injuryIcon(flag) {
    if (flag === 'major-injury') return '🚑';
    if (flag === 'injury')       return '🤕';
    return '';
  }

  function toggleTx(id) {
    const next = new Set(expandedTx);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedTx = next;
  }

  async function copyToClipboard(text, which) {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'history') { copiedHistory = true; setTimeout(() => (copiedHistory = false), 2000); }
      if (which === 'current') { copiedCurrent = true; setTimeout(() => (copiedCurrent = false), 2000); }
      if (which === 'prompt')  { copiedPrompt  = true; setTimeout(() => (copiedPrompt  = false), 2000); }
    } catch {}
  }

  // ── Core loader ────────────────────────────────────────────────────────────
  async function ensureAllTimeHistory() {
    if (allTimeHistory) return;
    globalDebug.push('Loading all-time history...');
    globalDebug = [...globalDebug];
    await getLeagueTeamManagers();
    allTimeHistory = await getAllSeasonsHistory();
    globalDebug.push(`Seasons: ${currentSeasonYears.join(', ')} | Players: ${Object.keys(allTimeHistory.allPlayersData || {}).length}`);
    globalDebug = [...globalDebug];
  }

  // ── Transactions ───────────────────────────────────────────────────────────
  async function loadTransactions() {
    loadingTransactions = true;
    transactionDebug    = [];
    gradedTransactions  = [];
    try {
      await ensureAllTimeHistory();
      const txResult = await getTransactionHistory(undefined, allTimeHistory.playerResults || []);
      transactionHistory = txResult;
      transactionDebug.push(...txResult.debug);

      const playerResults     = allTimeHistory.playerResults  || [];
      const allPlayersData    = allTimeHistory.allPlayersData || {};
      const parTablesBySeason = allTimeHistory.parTablesBySeason || {};

      gradedTransactions = txResult.transactions.map((tx) => {
        const parTables    = parTablesBySeason[String(tx.seasonKey || tx.season)];
        const managerNames = (tx.managerIds || []).map((id) => managerDisplayName(id));
        if (tx.isComposite) return { ...tx, grade: gradeCompositeTrade(tx, parTables, playerResults, allPlayersData) };
        if (tx.type === 'trade')  return { ...tx, grade: gradeTradeByPAR(tx, parTables, playerResults, allPlayersData, managerNames) };
        if (tx.type === 'waiver') return { ...tx, grade: gradeWaiverByPAR(tx, parTables, playerResults, allPlayersData) };
        return tx;
      });

      const snap = get(teamManagersStore) || {};
      allTimeTransactionTotals = getAllTimeTransactionTotals(txResult.totals, snap);
      const available = Object.keys(txResult.totals.seasons || {}).sort((a, b) => Number(b) - Number(a));
      if (available.length > 0) {
        selectedTransactionSeason = available[0];
        seasonTransactionTotals   = getSeasonTransactionTotals(txResult.totals, selectedTransactionSeason, snap);
      }

      // Build per-manager per-season trade/waiver PAR totals
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
      console.error(e);
      transactionDebug.push(`Crash: ${e.message}`);
    } finally {
      loadingTransactions = false;
    }
  }

  // ── Drafts ─────────────────────────────────────────────────────────────────
  async function loadDrafts() {
    loadingDrafts = true;
    draftDebug    = [];
    try {
      await ensureAllTimeHistory();
      allDrafts = await getAllDrafts(allTimeHistory.allPlayersData || {});
      draftDebug.push(`Loaded ${allDrafts.length} draft(s): ${allDrafts.map((d) => d.year).join(', ')}`);

      // Pre-compute post-season grades for ALL years (needed for manager grades)
      draftDebug.push('Computing post-season grades for all years...');
      for (const draft of allDrafts) {
        await computeEndOfSeasonGrade(draft.year, true);
      }

      if (allDrafts.length > 0) {
        selectedDraftYear = allDrafts[0].year;
        preSeasonGrade    = gradeDraftPreSeason(allDrafts.find((d) => d.year === selectedDraftYear));
        endOfSeasonGrade  = await getEndOfSeasonGradeForYear(selectedDraftYear);
      }
    } catch (e) {
      console.error(e);
      draftDebug.push(`Crash: ${e.message}`);
    } finally {
      loadingDrafts = false;
    }
  }

  // Cache for computed end-of-season grades
  const endOfSeasonGradeCache = {};

  async function getEndOfSeasonGradeForYear(year) {
    return endOfSeasonGradeCache[String(year)] || null;
  }

  async function computeEndOfSeasonGrade(year, silent = false) {
    const yearStr    = String(year);
    const draft      = allDrafts.find((d) => d.year === year);
    const parTables  = allTimeHistory?.parTablesBySeason?.[yearStr];
    const allSeasonStats    = allTimeHistory?.allSeasonStats || {};
    const parTablesBySeason = allTimeHistory?.parTablesBySeason || {};
    const allPlayersData    = allTimeHistory?.allPlayersData || {};

    if (!draft || !parTables) return null;

    const baselines = computeRoundBaselines(year, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData);
    if (!baselines) return null;

    const scoringSettings = allTimeHistory?.sharedScoringSettings || null;
    const statsResult = await getSeasonStatTotals(year, scoringSettings).catch(() => null);
    if (!statsResult) return null;

    const grade = gradeDraftEndOfSeason(
      draft, statsResult.totals, statsResult.gamesPlayed, baselines, parTables, allPlayersData
    );

    if (grade) {
      endOfSeasonGradeCache[yearStr] = grade;

      // Extract totalAdjustedPAR per manager for manager grades
      draftGradesByYear[yearStr] = {};
      Object.entries(grade.byRoster || {}).forEach(([, team]) => {
        if (team.managerId && team.totalAdjustedPAR != null) {
          draftGradesByYear[yearStr][team.managerId] = parseFloat(team.totalAdjustedPAR);
        }
      });
      draftGradesByYear = { ...draftGradesByYear };

      if (!silent) draftDebug.push(`${year} end-of-season grade computed.`);
    }
    return grade;
  }

  async function analyzeDraft(year) {
    preSeasonGrade   = null;
    endOfSeasonGrade = null;

    const draft = allDrafts.find((d) => d.year === year);
    if (!draft) return;

    draftDebug.push(`--- Analyzing ${year} ---`);
    preSeasonGrade   = gradeDraftPreSeason(draft);
    endOfSeasonGrade = endOfSeasonGradeCache[String(year)] || await computeEndOfSeasonGrade(year);

    if (endOfSeasonGrade) draftDebug.push(...(endOfSeasonGrade.debug || []));
    draftDebug = [...draftDebug];
  }

  // ── LLM context ────────────────────────────────────────────────────────────
  function buildLLMContext(year) {
    if (!allTimeHistory || !allDrafts.length) return;
    const allSeasonStats = allTimeHistory.allSeasonStats || {};
    const { text } = buildDraftHistoryContext(allDrafts, allSeasonStats, managerDisplayName);
    llmHistoryText = text;
    const draft = allDrafts.find((d) => d.year === Number(year));
    llmCurrentText = buildCurrentDraftSummary(draft, managerDisplayName);
    llmPromptText  = DRAFT_GRADING_PROMPT_TEMPLATE
      .replace('{{HISTORY}}', llmHistoryText)
      .replace('{{CURRENT_DRAFT}}', llmCurrentText);
    llmSelectedYear = year;
  }

  // ── Manager grades ─────────────────────────────────────────────────────────
  async function loadManagerGrades() {
    loadingManagers = true;
    managerDebug    = [];
    try {
      await ensureAllTimeHistory();

      // Build roster→manager map per year for getLeagueRosters
      const rosterToManagerByYear = {};
      allTimeHistory.seasons.forEach((s) => {
        const yearStr = String(s.year);
        rosterToManagerByYear[yearStr] = {};
        const yearMap = get(teamManagersStore)?.teamManagersMap?.[yearStr] || {};
        Object.entries(yearMap).forEach(([rosterId, teamInfo]) => {
          const mgrId = teamInfo?.managers?.[0];
          if (mgrId) rosterToManagerByYear[yearStr][String(rosterId)] = mgrId;
        });
      });

      const rosterStatsResult = await getAllRosterStats(allTimeHistory.seasons, rosterToManagerByYear);
      rosterStats = rosterStatsResult.byManager;
      managerDebug.push(...(rosterStatsResult.debug || []));

      // Build lineup IQ per season per manager
      managerLineupIQBySeason = {};
      Object.entries(rosterStats || {}).forEach(([mgrId, seasons]) => {
        Object.entries(seasons).forEach(([yr, data]) => {
          if (!managerLineupIQBySeason[yr]) managerLineupIQBySeason[yr] = {};
          if (data.lineupIQ != null) managerLineupIQBySeason[yr][mgrId] = data.lineupIQ;
        });
      });

      // Make sure draft grades are computed
      if (!allDrafts.length) {
        managerDebug.push('No draft data — load Draft Data first for draft grade component.');
      }

      // Compute SOS for all seasons
      seasonSOSByYear = {};
      allTimeHistory.seasons.forEach((s) => {
        const yearStr    = String(s.year);
        const standings  = s.standings || [];
        const weeklyResults = allTimeHistory.weeklyResults.filter((r) => String(r.year) === yearStr);
        const yearManagerIds = standings.map((t) => t.managerId).filter(Boolean);
        if (weeklyResults.length > 0) {
          seasonSOSByYear[yearStr] = computeSeasonSOS(weeklyResults, standings, yearManagerIds);
        }
      });
      allTimeSOS = computeAllTimeSOS(seasonSOSByYear, allManagerIds);
      managerDebug.push(`SOS computed for seasons: ${Object.keys(seasonSOSByYear).join(', ')}`);

      managerGradeYear = currentSeasonYears[0];
      recomputeManagerGrades();
      managerDebug.push('Manager grades computed.');
    } catch (e) {
      console.error(e);
      managerDebug.push(`Crash: ${e.message}`);
    } finally {
      loadingManagers = false;
    }
  }

  function recomputeManagerGrades() {
    seasonManagerGrades = {};
    currentSeasonYears.forEach((year) => {
      seasonManagerGrades[year] = computeSeasonManagerGrades(
        year,
        draftGradesByYear[year]       || {},  // post-season adjusted PAR per manager
        managerTradePARBySeason[year] || {},
        managerWaiverPARBySeason[year] || {},
        managerLineupIQBySeason[year] || {},
        allManagerIds
      );
    });
    allTimeManagerGrades = computeAllTimeManagerGrades(seasonManagerGrades);
  }

  // ── Power rankings ─────────────────────────────────────────────────────────
  async function computePower() {
    loadingPower = true;
    try {
      await ensureAllTimeHistory();
      const yearStr    = String(powerRankingsYear);
      const seasonData = allTimeHistory.seasons.find((s) => String(s.year) === yearStr);
      if (!seasonData) return;

      const standings     = seasonData.standings || [];
      const weeklyResults = allTimeHistory.weeklyResults.filter((r) => String(r.year) === yearStr);
      const yearMap       = get(teamManagersStore)?.teamManagersMap?.[yearStr] || {};
      const rosterToManagerId = (rosterId) => yearMap[String(rosterId)]?.managers?.[0] ?? null;

      const mgrGradesThisSeason = seasonManagerGrades[yearStr] || {};
      const rankings = computePowerRankings(
        powerRankingsWeek, standings, weeklyResults,
        mgrGradesThisSeason, allTimeManagerGrades, rosterToManagerId
      );

      if (powerRankings) previousPowerRankings = powerRankings.rankings;
      powerRankings        = rankings;
      rankingsWithMovement = computeRankMovement(rankings.rankings, previousPowerRankings || []);
    } catch (e) {
      console.error(e);
    } finally {
      loadingPower = false;
    }
  }

  onMount(async () => {
    await getLeagueTeamManagers().catch(() => {});
  });
</script>

<main class="container">
  <h1>League Analysis Panel</h1>

  <!-- Main tabs -->
  <div class="main-tabs">
    <button class="tab-btn {mainTab === 'transactions' ? 'active' : ''}" on:click={() => (mainTab = 'transactions')}>💱 Transactions</button>
    <button class="tab-btn {mainTab === 'draft'        ? 'active' : ''}" on:click={() => (mainTab = 'draft')}>📋 Draft Analysis</button>
    <button class="tab-btn {mainTab === 'llm'          ? 'active' : ''}" on:click={() => (mainTab = 'llm')}>🤖 LLM Context</button>
    <button class="tab-btn {mainTab === 'managers'     ? 'active' : ''}" on:click={() => (mainTab = 'managers')}>📊 Manager Grades</button>
    <button class="tab-btn {mainTab === 'sos'          ? 'active' : ''}" on:click={() => (mainTab = 'sos')}>📅 Schedule Strength</button>
    <button class="tab-btn {mainTab === 'power'        ? 'active' : ''}" on:click={() => (mainTab = 'power')}>⚡ Power Rankings</button>
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
      <div class="status-msg">Loading and grading transactions...</div>
    {:else if transactionHistory}
      <h4>All-Time Totals</h4>
      <table class="data-table">
        <thead><tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr></thead>
        <tbody>
          {#each allTimeTransactionTotals as m}
            <tr><td>{m.displayName}</td><td>{m.trades}</td><td>{m.waivers}</td><td>{m.total}</td></tr>
          {/each}
        </tbody>
      </table>

      <h4>Season Totals</h4>
      <div class="control-row">
        <select bind:value={selectedTransactionSeason} on:change={() => {
          const snap = get(teamManagersStore) || {};
          seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, snap);
        }}>
          {#each Object.keys(transactionHistory.totals.seasons || {}).sort((a,b) => Number(b)-Number(a)) as yr}
            <option value={yr}>{yr}</option>
          {/each}
        </select>
      </div>
      {#if seasonTransactionTotals.length > 0}
        <table class="data-table">
          <thead><tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr></thead>
          <tbody>
            {#each seasonTransactionTotals as m}
              <tr><td>{m.displayName}</td><td>{m.trades}</td><td>{m.waivers}</td><td>{m.total}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <h4>All Transactions <span class="count-badge">{filteredTransactions.length}</span></h4>
      <div class="control-row">
        <select bind:value={txFilter}>
          <option value="all">All</option>
          <option value="trade">Trades Only</option>
          <option value="waiver">Waivers Only</option>
        </select>
      </div>

      {#each filteredTransactions as tx}
        {@const g = tx.grade}
        {@const isExpanded = expandedTx.has(tx.id)}
        <div class="tx-card {tx.type} {tx.isComposite ? 'composite' : ''}">
          <div class="tx-summary" on:click={() => toggleTx(tx.id)} role="button" tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && toggleTx(tx.id)}>
            <div class="tx-meta">
              {#if tx.isComposite}<span class="badge composite">🔀 {tx.teams?.length}-Team</span>
              {:else}<span class="badge {tx.type}">{tx.type}</span>{/if}
              <span class="tx-info">{tx.date} · S{tx.seasonKey || tx.season} Wk{tx.leg}</span>
            </div>
            <div class="tx-managers">
              {#if tx.isComposite}{(tx.teams || []).map((t) => managerDisplayName(t.managerId)).join(' → ')}
              {:else if tx.managerIds?.length}{tx.managerIds.map((id) => managerDisplayName(id)).join(' ↔ ')}
              {:else}—{/if}
            </div>
            {#if tx.type === 'trade' && g}
              <span class="grade-badge grade-{g.narrative?.grade}">{tradeGradeEmoji(g.narrative?.grade)} {g.narrative?.grade}</span>
              <span class="par-line">{managerDisplayName(tx.managerIds?.[0])}: {fp(g.side0?.parTotal)} | {managerDisplayName(tx.managerIds?.[1])}: {fp(g.side1?.parTotal)} PAR</span>
            {:else if tx.type === 'waiver' && g}
              <span class="grade-badge grade-{g.gradeLabel}">{waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}</span>
              <span class="par-line">{g.name} ({g.position}) · {fp(g.par)} PAR</span>
            {/if}
            <span class="expand-toggle">{isExpanded ? '▲' : '▼'}</span>
          </div>

          {#if isExpanded}
            <div class="tx-detail">
              {#if tx.type === 'trade' && !tx.isComposite && g}
                <p class="narrative">{g.narrative?.summary}</p>
                <div class="trade-sides">
                  {#each tx.rosters as roster, idx}
                    {@const side = idx === 0 ? g.side0 : g.side1}
                    {@const isWinner = g.winner === idx}
                    <div class="side {isWinner ? 'winner' : ''}">
                      <div class="side-header">{isWinner ? '🏆 ' : ''}{managerDisplayName(tx.managerIds?.[idx])} received:</div>
                      <div class="side-par">PAR: <span class="{parClass(side?.parTotal)}">{signedFp(side?.parTotal)}</span></div>
                      {#each (side?.players || []) as p}
                        <div class="player-block">
                          <div class="p-row"><span class="pos">{p.position}</span><strong>{p.name}</strong><span class="{parClass(p.par)}">{signedFp(p.par)} PAR</span></div>
                          <div class="p-stats">{fp(p.totalPts)} total · {p.weeksHeld} wks held</div>
                          <div class="baseline-info">baseline: {fp(p.repPerWeek)}/wk × {p.weeksHeld} wks = {fp(p.baseline)} vs <em>{p.repName}</em></div>
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
              {:else if tx.type === 'waiver' && g}
                <p class="narrative">{g.gradeSummary}</p>
                <div class="waiver-grid">
                  <div class="w-section">
                    <div class="w-header">📥 Pickup</div>
                    <div class="p-row"><span class="pos">{g.position}</span><strong>{g.name}</strong></div>
                    <div class="p-stats">{fp(g.totalPts)} total · {g.weeksHeld} wks{g.isStream ? ' (stream)' : ''}</div>
                  </div>
                  <div class="w-section">
                    <div class="w-header">📊 Replacement</div>
                    <div class="p-row"><span class="pos">{g.position}</span><strong>{g.repName}</strong></div>
                    <div class="p-stats">{fp(g.repSeasonTotal)}/season ÷ 17 = {fp(g.repPerWeek)}/wk × {g.weeksHeld} wks = {fp(g.baseline)}</div>
                  </div>
                  <div class="w-section">
                    <div class="w-header">🎯 Result</div>
                    <div class="formula">{fp(g.totalPts)} − {fp(g.baseline)} = <strong class="{parClass(g.par)}">{signedFp(g.par)} PAR</strong></div>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showTxDebug = !showTxDebug)}>{showTxDebug ? 'Hide' : 'Show'} Debug</button>
      </div>
      {#if showTxDebug}
        <div class="debug-terminal"><h4>Transaction Debug</h4><ul>{#each transactionDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
      {/if}
    {/if}

  <!-- ════════ DRAFT ANALYSIS ════════ -->
  {:else if mainTab === 'draft'}
    <h2>Draft Analysis</h2>
    <div class="control-row">
      <button on:click={loadDrafts} disabled={loadingDrafts}>
        {loadingDrafts ? 'Loading...' : allDrafts.length ? 'Reload Drafts' : 'Load Draft Data'}
      </button>
    </div>

    {#if loadingDrafts}
      <div class="status-msg">Computing draft grades for all seasons...</div>
    {:else if allDrafts.length}
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={selectedDraftYear} on:change={async () => { await analyzeDraft(selectedDraftYear); }}>
          {#each draftYearOptions as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        <div class="tab-group">
          <button class="tab-btn {draftActiveTab === 'end' ? 'active' : ''}" on:click={() => (draftActiveTab = 'end')}>Post-Season Grade</button>
          <button class="tab-btn {draftActiveTab === 'pre' ? 'active' : ''}" on:click={() => (draftActiveTab = 'pre')}>Pre-Season Grade</button>
        </div>
      </div>

      {#if draftActiveTab === 'end'}
        {#if endOfSeasonGrade}
          <h3>{endOfSeasonGrade.year} — Post-Season Draft Grade</h3>
          <div class="explainer">
            <strong>Adjusted PAR = Actual PAR − Expected PAR.</strong> Actual PAR = actual pts − positional replacement level.
            Expected PAR = historical avg Actual PAR for that round (baseline seasons: {endOfSeasonGrade.baselineSeasons?.join(', ')}).
            K/DEF: no round adjustment — adjustedPAR = actualPAR directly.
          </div>

          <div class="ref-grid">
            <div class="ref-panel">
              <div class="ref-title">📊 Expected PAR by Round
                <span class="ref-sub">(avg of {endOfSeasonGrade.baselineSeasons?.join('+')} seasons)</span>
              </div>
              <div class="baseline-pills">
                {#each Object.entries(endOfSeasonGrade.expectedPARByRound || {}).sort(([a],[b]) => Number(a)-Number(b)) as [r, val]}
                  <div class="baseline-pill">
                    <span class="bl-round">R{r}</span>
                    <span class="bl-pts">{signedFp(val)}</span>
                    <span class="bl-n muted">{endOfSeasonGrade.sampleSizes?.[r]}yr</span>
                  </div>
                {/each}
              </div>
            </div>
            <div class="ref-panel">
              <div class="ref-title">🔄 Replacement Levels</div>
              <div class="rep-pills">
                {#each Object.entries(endOfSeasonGrade.replacementLevels || {}).sort(([a],[b]) => a.localeCompare(b)) as [pos, pts]}
                  <div class="rep-pill">
                    <span class="rp-pos">{pos}</span>
                    <span class="rp-pts">{fp(pts)}</span>
                    <span class="rp-name muted">{endOfSeasonGrade.replacementNames?.[pos] || '?'}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <h4>Team Grades</h4>
          <table class="data-table">
            <thead>
              <tr><th>Rank</th><th>Manager</th><th>Grade</th><th>Adj PAR</th><th>Excl Inj</th><th>Actual Pts</th><th>Injuries</th><th>Best Pick</th><th>Worst Pick</th></tr>
            </thead>
            <tbody>
              {#each endOfSeasonGrade.teamRankings as team, idx}
                <tr>
                  <td>#{idx + 1}</td>
                  <td><strong>{managerDisplayName(team.managerId)}</strong></td>
                  <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                  <td class="{parClass(team.totalAdjustedPAR)}">{signedFp(team.totalAdjustedPAR)}</td>
                  <td class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</td>
                  <td>{fp(team.totalActualPts)}</td>
                  <td>{team.injured.length > 0 ? `🤕 ${team.injured.length}` : '—'}</td>
                  <td>{team.bestPick ? `${team.bestPick.playerName} R${team.bestPick.round}` : '—'}</td>
                  <td>{team.worstPick ? `${team.worstPick.playerName} R${team.worstPick.round} ${injuryIcon(team.worstPick.injuryFlag)}` : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>

          <div class="two-col">
            <div>
              <h4>🔥 Biggest Steals</h4>
              <table class="data-table">
                <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Manager</th></tr></thead>
                <tbody>
                  {#each endOfSeasonGrade.leagueTopSteals as pick}
                    <tr>
                      <td>{pick.playerName}</td><td>{pick.pos}</td><td>{pick.round}</td>
                      <td class="muted">{signedFp(pick.actualPAR)}</td>
                      <td class="muted">{pick.noRoundAdjustment ? '0 (K/DEF)' : signedFp(pick.expectedPAR)}</td>
                      <td class="positive">{signedFp(pick.adjustedPAR)}</td>
                      <td>{managerDisplayName(pick.managerId)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <div>
              <h4>💀 Biggest Busts</h4>
              <table class="data-table">
                <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Inj</th><th>Manager</th></tr></thead>
                <tbody>
                  {#each endOfSeasonGrade.leagueTopBusts as pick}
                    <tr>
                      <td>{pick.playerName}</td><td>{pick.pos}</td><td>{pick.round}</td>
                      <td class="muted">{signedFp(pick.actualPAR)}</td>
                      <td class="muted">{pick.noRoundAdjustment ? '0 (K/DEF)' : signedFp(pick.expectedPAR)}</td>
                      <td class="negative">{signedFp(pick.adjustedPAR)}</td>
                      <td>{injuryIcon(pick.injuryFlag) || '—'}</td>
                      <td>{managerDisplayName(pick.managerId)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          <h4>Full Team Breakdowns</h4>
          {#each endOfSeasonGrade.teamRankings as team}
            <div class="team-block">
              <div class="team-header">
                <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
                <strong>{managerDisplayName(team.managerId)}</strong>
                <span class="header-stat">Adj PAR: <span class="{parClass(team.totalAdjustedPAR)}">{signedFp(team.totalAdjustedPAR)}</span></span>
                <span class="header-stat muted">{fp(team.totalActualPts)} pts</span>
                {#if team.injured.length > 0}
                  <span class="header-stat muted">🤕 {team.injured.length} · excl: <span class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</span></span>
                {/if}
              </div>
              <div class="table-scroll">
                <table class="data-table mini">
                  <thead><tr><th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th><th>Actual</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Games</th><th>Label</th></tr></thead>
                  <tbody>
                    {#each team.picks as pick}
                      <tr class="{pick.injuryFlag ? 'injury-row' : ''}">
                        <td>{pick.round}</td><td>#{pick.pickNo}</td>
                        <td>{pick.playerName}{pick.injuryFlag ? ' ' + injuryIcon(pick.injuryFlag) : ''}</td>
                        <td><span class="pos">{pick.pos}</span></td>
                        <td>{fp(pick.actualPts)}</td>
                        <td class="muted">{signedFp(pick.actualPAR)}</td>
                        <td class="muted">{pick.noRoundAdjustment ? '0 (K/DEF)' : signedFp(pick.expectedPAR)}</td>
                        <td class="{parClass(pick.adjustedPAR)}">{pick.adjustedPAR != null ? signedFp(pick.adjustedPAR) : '—'}</td>
                        <td class="{pick.injuryFlag ? 'negative' : 'muted'}">{pick.gamesPlayed ?? '—'}</td>
                        <td><span class="vl-tag {valueLabelClass(pick.valueLabel)}">{pick.valueLabel}</span></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="pos-breakdown">
                {#each Object.entries(team.byPosition).sort(([a],[b]) => a.localeCompare(b)) as [pos, data]}
                  <div class="pos-card">
                    <div class="pos-label">{pos}</div>
                    <div class="pos-stat">{data.picks} picks</div>
                    <div class="pos-stat">{fp(data.totalActualPts)} pts</div>
                    <div class="pos-par {data.totalAdjustedPAR >= 0 ? 'positive' : 'negative'}">{signedFp(data.totalAdjustedPAR)}</div>
                  </div>
                {/each}
              </div>
              <div class="round-breakdown">
                <span class="muted">Adj PAR by round:</span>
                {#each Object.entries(team.byRound).sort(([a],[b]) => Number(a)-Number(b)) as [rnd, data]}
                  <span class="round-pill {data.totalAdjustedPAR >= 0 ? 'positive-bg' : 'negative-bg'}">R{rnd}: {signedFp(data.totalAdjustedPAR)}</span>
                {/each}
              </div>
            </div>
          {/each}
        {:else}
          <div class="status-msg">Load Draft Data to compute grades.</div>
        {/if}

      {:else if draftActiveTab === 'pre'}
        {#if preSeasonGrade}
          <h3>{preSeasonGrade.year} — Pre-Season Grade (Positional Scarcity)</h3>
          <table class="data-table">
            <thead><tr><th>Rank</th><th>Manager</th><th>Grade</th><th>Avg vs Market</th><th>Best Pick</th><th>Worst Pick</th></tr></thead>
            <tbody>
              {#each preSeasonGrade.teamRankings as team, idx}
                <tr>
                  <td>#{idx + 1}</td>
                  <td>{managerDisplayName(team.managerId)}</td>
                  <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                  <td class="{(parseFloat(team.avgVsMarket)||0) >= 0 ? 'positive' : 'negative'}">{signedFp(team.avgVsMarket)} picks</td>
                  <td>{team.bestValuePick ? `${team.bestValuePick.playerName} R${team.bestValuePick.round}` : '—'}</td>
                  <td>{team.worstValuePick ? `${team.worstValuePick.playerName} R${team.worstValuePick.round}` : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="status-msg">Load Draft Data first.</div>
        {/if}
      {/if}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showDraftDebug = !showDraftDebug)}>{showDraftDebug ? 'Hide' : 'Show'} Draft Debug</button>
      </div>
      {#if showDraftDebug}
        <div class="debug-terminal"><h4>Draft Debug</h4><ul>{#each draftDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
      {/if}
    {/if}

  <!-- ════════ LLM CONTEXT ════════ -->
  {:else if mainTab === 'llm'}
    <h2>LLM Draft Context Builder</h2>
    <div class="explainer">
      Generate context to paste into Claude or ChatGPT for post-draft qualitative grading.
      The LLM grade is qualitative context — the actual manager grade score comes from the
      post-season data grade automatically.
    </div>
    {#if !allDrafts.length}
      <div class="control-row">
        <button on:click={loadDrafts} disabled={loadingDrafts}>{loadingDrafts ? 'Loading...' : 'Load Draft Data First'}</button>
      </div>
    {:else}
      <div class="control-row">
        <label><strong>Draft to grade:</strong></label>
        <select bind:value={llmSelectedYear} on:change={() => llmSelectedYear && buildLLMContext(llmSelectedYear)}>
          <option value={null}>Select a year...</option>
          {#each draftYearOptions as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        {#if llmSelectedYear}<button on:click={() => buildLLMContext(llmSelectedYear)}>Generate</button>{/if}
      </div>

      {#if llmPromptText}
        <div class="llm-section">
          <div class="llm-header">
            <h4>📋 Full Prompt (paste into LLM)</h4>
            <button class="copy-btn {copiedPrompt ? 'copied' : ''}" on:click={() => copyToClipboard(llmPromptText, 'prompt')}>
              {copiedPrompt ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
          <pre class="llm-text">{llmPromptText}</pre>
        </div>
        <div class="two-col" style="margin-top:1rem;">
          <div class="llm-section">
            <div class="llm-header">
              <h4>📚 History</h4>
              <button class="copy-btn {copiedHistory ? 'copied' : ''}" on:click={() => copyToClipboard(llmHistoryText, 'history')}>{copiedHistory ? '✓' : 'Copy'}</button>
            </div>
            <pre class="llm-text small">{llmHistoryText}</pre>
          </div>
          <div class="llm-section">
            <div class="llm-header">
              <h4>📝 Current Draft</h4>
              <button class="copy-btn {copiedCurrent ? 'copied' : ''}" on:click={() => copyToClipboard(llmCurrentText, 'current')}>{copiedCurrent ? '✓' : 'Copy'}</button>
            </div>
            <pre class="llm-text small">{llmCurrentText}</pre>
          </div>
        </div>
      {/if}
    {/if}

  <!-- ════════ MANAGER GRADES ════════ -->
  {:else if mainTab === 'managers'}
    <h2>Manager Grades</h2>
    <div class="explainer">
      <strong>Weights:</strong> 40% Draft (post-season adjusted PAR) · 20% Trades · 20% Waivers · 20% Lineup IQ (fpts/ppts).<br/>
      <strong>Scoring:</strong> Z-score centered at 50 (league average = 50). ±1 std dev = ±25 points. Clamped 0-100.<br/>
      Zero activity (no trades/waivers) scores 50 (neutral), not 0.
    </div>
    <div class="control-row">
      <button on:click={loadManagerGrades} disabled={loadingManagers}>
        {loadingManagers ? 'Loading...' : rosterStats ? 'Reload' : 'Load Manager Grades'}
      </button>
      {#if !transactionHistory}<span class="muted">⚠ Load Transactions first for trade/waiver data.</span>{/if}
      {#if !allDrafts.length}<span class="muted">⚠ Load Draft Data first for draft grade component.</span>{/if}
    </div>

    {#if Object.keys(seasonManagerGrades).length > 0}
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={managerGradeYear} on:change={recomputeManagerGrades}>
          {#each currentSeasonYears as yr}<option value={yr}>{yr}</option>{/each}
        </select>
      </div>

      {#if managerGradeYear}
        {@const yearGrades = seasonManagerGrades[String(managerGradeYear)] || {}}
        <h3>{managerGradeYear} Manager Grades</h3>

        <table class="data-table">
          <thead>
            <tr>
              <th>Manager</th><th>Overall</th>
              <th>Draft (40%)<br/><span class="muted">post-season adj PAR</span></th>
              <th>Trades (20%)<br/><span class="muted">PAR vs replacement</span></th>
              <th>Waivers (20%)<br/><span class="muted">PAR vs replacement</span></th>
              <th>Lineup IQ (20%)<br/><span class="muted">fpts/ppts</span></th>
              <th>Missing</th>
            </tr>
          </thead>
          <tbody>
            {#each allManagerIds.sort((a, b) => {
              const ga = yearGrades[a]?.overallGrade ?? -1;
              const gb = yearGrades[b]?.overallGrade ?? -1;
              return gb - ga;
            }) as mgrId}
              {@const result = yearGrades[mgrId]}
              <tr>
                <td><strong>{managerDisplayName(mgrId)}</strong></td>
                <td>
                  {#if result?.overallGrade != null}
                    <span class="score-pill" style="background:{scoreColor(result.overallGrade)};">
                      {fp(result.overallGrade, 0)}
                    </span>
                  {:else}—{/if}
                </td>
                <!-- Draft: show raw PAR + normalized score -->
                <td>
                  {#if result?.normDraft != null}
                    <span class="score-pill" style="background:{scoreColor(result.normDraft)};">{fp(result.normDraft, 0)}</span>
                    <div class="muted" style="font-size:0.8em;">{signedFp(result.rawDraftPAR)} adj PAR</div>
                  {:else}<span class="muted">no data</span>{/if}
                </td>
                <!-- Trades: raw PAR + normalized -->
                <td>
                  <span class="score-pill" style="background:{scoreColor(result?.normTrade)};">{fp(result?.normTrade, 0)}</span>
                  {#if result?.rawTradePAR != null}
                    <div class="muted" style="font-size:0.8em;">{signedFp(result.rawTradePAR)} PAR</div>
                  {:else}<div class="muted" style="font-size:0.8em;">no trades</div>{/if}
                </td>
                <!-- Waivers -->
                <td>
                  <span class="score-pill" style="background:{scoreColor(result?.normWaiver)};">{fp(result?.normWaiver, 0)}</span>
                  {#if result?.rawWaiverPAR != null}
                    <div class="muted" style="font-size:0.8em;">{signedFp(result.rawWaiverPAR)} PAR</div>
                  {:else}<div class="muted" style="font-size:0.8em;">no waivers</div>{/if}
                </td>
                <!-- Lineup IQ -->
                <td>
                  {#if result?.normLineup != null}
                    <span class="score-pill" style="background:{scoreColor(result.normLineup)};">{fp(result.normLineup, 0)}</span>
                    <div class="muted" style="font-size:0.8em;">{pct(result.rawLineupIQ)} eff.</div>
                  {:else}<span class="muted">no data</span>{/if}
                </td>
                <td class="muted">{result?.missingComponents?.join(', ') || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <!-- All-time grades -->
      {#if Object.keys(allTimeManagerGrades).length > 0}
        <h3>All-Time Manager Grades</h3>
        <table class="data-table">
          <thead><tr><th>Manager</th><th>All-Time Grade</th><th>Seasons</th></tr></thead>
          <tbody>
            {#each Object.entries(allTimeManagerGrades).sort(([,a],[,b]) => b.allTimeGrade - a.allTimeGrade) as [mgrId, data]}
              <tr>
                <td><strong>{managerDisplayName(mgrId)}</strong></td>
                <td>
                  <span class="score-pill" style="background:{scoreColor(data.allTimeGrade)};">
                    {fp(data.allTimeGrade, 0)}
                  </span>
                </td>
                <td class="muted">{data.years?.join(', ')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showManagerDebug = !showManagerDebug)}>{showManagerDebug ? 'Hide' : 'Show'} Debug</button>
      </div>
      {#if showManagerDebug}
        <div class="debug-terminal"><h4>Manager Debug</h4><ul>{#each managerDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
      {/if}
    {/if}

  <!-- ════════ STRENGTH OF SCHEDULE ════════ -->
  {:else if mainTab === 'sos'}
    <h2>Strength of Schedule</h2>
    <div class="explainer">
      <strong>Points SOS</strong>: average points your opponents scored against you in regular season games. Higher = tougher schedule.<br/>
      <strong>Record SOS</strong>: average final win % of your opponents. Higher = faced better teams.<br/>
      <strong>Luck</strong>: your actual win rate minus your expected win rate (based on how your weekly score compared to all other scores that week). Positive = won more than your points deserved.
    </div>

    {#if !rosterStats && Object.keys(seasonSOSByYear).length === 0}
      <div class="control-row">
        <button on:click={loadManagerGrades} disabled={loadingManagers}>
          {loadingManagers ? 'Computing...' : 'Load Schedule Data'}
        </button>
      </div>
    {:else}
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={sosYear}>
          <option value={null}>All-Time</option>
          {#each Object.keys(seasonSOSByYear).sort((a,b) => Number(b)-Number(a)) as yr}
            <option value={yr}>{yr}</option>
          {/each}
        </select>
      </div>

      {#if sosYear == null}
        <!-- All-time SOS -->
        <h3>All-Time Strength of Schedule</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Manager</th>
              <th>Avg Opp Pts<br/><span class="muted">(pts SOS)</span></th>
              <th>Avg Opp Win%<br/><span class="muted">(record SOS)</span></th>
              <th>Avg Luck<br/><span class="muted">actual − expected win%</span></th>
              <th>Luck Label</th>
              <th>Seasons</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(allTimeSOS).sort(([,a],[,b]) => b.avgOpponentPts - a.avgOpponentPts) as [mgrId, data]}
              <tr>
                <td><strong>{managerDisplayName(mgrId)}</strong></td>
                <td>{fp(data.avgOpponentPts)}</td>
                <td>{data.avgOpponentWinPct != null ? pct(data.avgOpponentWinPct) : '—'}</td>
                <td class="{parClass(data.avgLuck)}">{data.avgLuck != null ? signedFp(data.avgLuck * 100, 1) + '%' : '—'}</td>
                <td><span class="luck-tag luck-{data.luckLabel?.replace(/\s/g,'-')}">{data.luckLabel || '—'}</span></td>
                <td class="muted">{data.seasons}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <!-- Single season SOS -->
        {@const yearSOS = seasonSOSByYear[sosYear] || {}}
        <h3>{sosYear} Strength of Schedule</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Manager</th>
              <th>Avg Opp Pts</th>
              <th>Avg Opp Win%</th>
              <th>Actual Wins</th>
              <th>Expected Win%</th>
              <th>Actual Win%</th>
              <th>Luck (±%)</th>
              <th>Luck Label</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(yearSOS).sort(([,a],[,b]) => b.avgOpponentPts - a.avgOpponentPts) as [mgrId, data]}
              <tr>
                <td><strong>{managerDisplayName(mgrId)}</strong></td>
                <td>{fp(data.avgOpponentPts)}</td>
                <td>{data.avgOpponentWinPct != null ? pct(data.avgOpponentWinPct) : '—'}</td>
                <td>{data.actualWins}</td>
                <td class="muted">{data.expectedWinRate != null ? pct(data.expectedWinRate) : '—'}</td>
                <td>{data.actualWinRate != null ? pct(data.actualWinRate) : '—'}</td>
                <td class="{parClass(data.luck)}">{data.luck != null ? signedFp(data.luck * 100, 1) + '%' : '—'}</td>
                <td><span class="luck-tag luck-{data.luckLabel?.replace(/\s/g,'-')}">{data.luckLabel || '—'}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Per-season breakdown in all-time view -->
        {#if sosYear == null && Object.keys(allTimeSOS).length > 0}
          <h4>Season-by-Season Detail</h4>
          {#each Object.entries(allTimeSOS) as [mgrId, data]}
            {#if data.perSeason?.length > 1}
              <div class="sos-detail-row">
                <strong>{managerDisplayName(mgrId)}</strong>
                {#each data.perSeason.sort((a,b) => Number(a.year)-Number(b.year)) as s}
                  <span class="sos-pill">
                    {s.year}: {fp(s.avgOpponentPts)} pts opp
                    {s.luck != null ? `· luck ${signedFp(s.luck * 100, 1)}%` : ''}
                  </span>
                {/each}
              </div>
            {/if}
          {/each}
        {/if}
      {/if}
    {/if}

  <!-- ════════ POWER RANKINGS ════════ -->
  {:else if mainTab === 'power'}
    <h2>Power Rankings</h2>
    <div class="explainer">
      Blends record, points scored, recent 3-week form, and manager grade.
      Manager grade weight fades as the season progresses (40% wks 1-3 → 15% wks 4-8 → 5% wk 9+).
      Week 0 (pre-season/post-draft) = 100% manager grade.
    </div>
    <div class="control-row">
      <label><strong>Season:</strong></label>
      <select bind:value={powerRankingsYear}>
        {#each currentSeasonYears as yr}<option value={yr}>{yr}</option>{/each}
      </select>
      <label><strong>Through Week:</strong></label>
      <select bind:value={powerRankingsWeek}>
        <option value={0}>Pre-season</option>
        {#each Array.from({length:17},(_,i)=>i+1) as w}<option value={w}>Week {w}</option>{/each}
      </select>
      <button on:click={computePower} disabled={loadingPower}>
        {loadingPower ? 'Computing...' : 'Compute Rankings'}
      </button>
    </div>

    {#if powerRankings}
      <div class="phase-banner">
        Phase: <strong>{powerRankings.phase}</strong>
        · Record {(powerRankings.weights.record * 100).toFixed(0)}%
        / Points {(powerRankings.weights.points * 100).toFixed(0)}%
        / Form {(powerRankings.weights.recentForm * 100).toFixed(0)}%
        / Mgr Grade {(powerRankings.weights.managerGrade * 100).toFixed(0)}%
      </div>
      <table class="data-table">
        <thead>
          <tr><th>Rank</th><th>Δ</th><th>Manager</th><th>Record</th><th>PF</th><th>Score</th><th>Rec</th><th>Pts</th><th>Form</th><th>Mgr</th></tr>
        </thead>
        <tbody>
          {#each (rankingsWithMovement.length > 0 ? rankingsWithMovement : powerRankings.rankings) as team}
            {@const mov = team.movement}
            <tr>
              <td><strong>#{team.rank}</strong></td>
              <td class="{mov > 0 ? 'positive' : mov < 0 ? 'negative' : 'muted'}">
                {#if mov > 0}↑{mov}{:else if mov < 0}↓{Math.abs(mov)}{:else if team.prevRank != null}—{:else}NEW{/if}
              </td>
              <td><strong>{managerDisplayName(team.managerId)}</strong></td>
              <td>{team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}</td>
              <td>{fp(team.pf)}</td>
              <td><strong>{fp(team.compositeScore)}</strong></td>
              <td class="muted">{fp(team.recordScore, 0)}</td>
              <td class="muted">{fp(team.pointsScore, 0)}</td>
              <td class="muted">{fp(team.formScore, 0)}</td>
              <td class="muted">{fp(team.managerScore, 0)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  <!-- Global debug -->
  <div class="control-row" style="margin-top:2rem;">
    <button on:click={() => (showGlobalDebug = !showGlobalDebug)}>{showGlobalDebug ? 'Hide' : 'Show'} Global Debug</button>
  </div>
  {#if showGlobalDebug}
    <div class="debug-terminal"><h4>Global Debug</h4><ul>{#each globalDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
  {/if}
</main>

<style>
  .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  h1, h2, h3, h4 { margin: 0.75rem 0 0.5rem; }
  .control-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  select, button { padding: 0.5rem 1rem; font-size: 0.95rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; margin-bottom: 1rem; }
  .muted { color: #888; font-size: 0.87em; }
  .explainer { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.87rem; color: #0c4a6e; line-height: 1.6; }

  /* Main tabs */
  .main-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 2rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  .tab-group { display: flex; gap: 0.4rem; }
  .tab-btn { padding: 0.4rem 0.85rem; border-radius: 6px 6px 0 0; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.88rem; }
  .tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }

  /* Tables */
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.85rem; }
  .data-table.mini { font-size: 0.79rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.3rem 0.45rem; text-align: center; }
  .data-table th { background: #f5f5f5; font-weight: 600; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .injury-row { background: #fff7ed; }
  .table-scroll { overflow-x: auto; }
  .totals td { background: #f8fafc; font-weight: 700; }

  /* Transactions */
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

  .trade-sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
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
  .baseline-info { font-size: 0.79em; color: #888; margin-top: 0.15rem; }
  .pos { background: #e5e7eb; border-radius: 3px; padding: 0.08rem 0.3rem; font-size: 0.73em; font-weight: 700; }
  .count-badge { background: #e5e7eb; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.78rem; color: #555; margin-left: 0.5rem; font-weight: normal; }

  .wk-table { width: 100%; border-collapse: collapse; font-size: 0.8em; margin-top: 0.3rem; }
  .wk-table th, .wk-table td { border: 1px solid #e5e7eb; padding: 0.22rem 0.4rem; text-align: center; }
  .wk-table th { background: #f1f5f9; }

  /* Draft */
  .ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
  .ref-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; }
  .ref-title { font-weight: 700; font-size: 0.87em; color: #374151; margin-bottom: 0.5rem; }
  .ref-sub { font-weight: 400; color: #888; font-size: 0.9em; margin-left: 0.25rem; }
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

  /* LLM */
  .llm-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; }
  .llm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .llm-header h4 { margin: 0; }
  .llm-text { white-space: pre-wrap; font-family: monospace; font-size: 0.78em; background: #1e1e1e; color: #d4d4d4; padding: 0.75rem; border-radius: 4px; max-height: 400px; overflow-y: auto; }
  .llm-text.small { max-height: 250px; font-size: 0.72em; }
  .copy-btn { padding: 0.3rem 0.8rem; font-size: 0.83rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
  .copy-btn.copied { background: #16a34a; }

  /* Manager grades */
  .score-pill { display: inline-block; padding: 0.2rem 0.55rem; border-radius: 4px; color: white; font-weight: 700; font-size: 0.9em; }

  /* SOS */
  .luck-tag { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.8em; font-weight: 600; background: #f3f4f6; color: #374151; }
  .luck-very-lucky, .luck-consistently-lucky { background: #d1fae5; color: #065f46; }
  .luck-lucky, .luck-slightly-lucky { background: #e0f2fe; color: #0369a1; }
  .luck-very-unlucky, .luck-consistently-unlucky { background: #fef2f2; color: #dc2626; }
  .luck-unlucky, .luck-slightly-unlucky { background: #fff7ed; color: #c2410c; }
  .sos-detail-row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.5rem; font-size: 0.85em; }
  .sos-pill { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.15rem 0.4rem; font-size: 0.85em; }

  /* Power rankings */
  .phase-banner { background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 6px; padding: 0.5rem 1rem; margin-bottom: 1rem; font-size: 0.88rem; color: #4c1d95; }

  /* Badges */
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

  /* Two-column */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }

  /* Colors */
  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }

  /* Debug */
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.8em; margin-top: 1rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.18rem; }
</style>
