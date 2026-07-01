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
  import { computeSeasonManagerGrades, computeAllTimeManagerGrades, letterGradeToScore } from '$lib/utils/dataEngine/managerGrades.js';
  import { computePowerRankings, computeRankMovement } from '$lib/utils/dataEngine/powerRankings.js';
  import { teamManagersStore } from '$lib/stores';

  // ── Global state ───────────────────────────────────────────────────────────
  let allTimeHistory   = null;
  let loadingAll       = false;
  let globalDebug      = [];
  let showGlobalDebug  = false;
  let mainTab          = 'transactions'; // transactions | draft | llm | managers | power

  // ── Transaction state ──────────────────────────────────────────────────────
  let transactionHistory   = null;
  let loadingTransactions  = false;
  let gradedTransactions   = [];
  let allTimeTransactionTotals = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals   = [];
  let txFilter         = 'all';
  let showTxDebug      = false;
  let transactionDebug = [];
  let expandedTx       = new Set();

  // ── Draft state ────────────────────────────────────────────────────────────
  let allDrafts          = [];
  let loadingDrafts      = false;
  let draftDebug         = [];
  let showDraftDebug     = false;
  let selectedDraftYear  = null;
  let selectedDraft      = null;
  let preSeasonGrade     = null;
  let endOfSeasonGrade   = null;
  let draftActiveTab     = 'end'; // 'pre' | 'end'

  // ── LLM context state ─────────────────────────────────────────────────────
  let llmHistoryText   = '';
  let llmCurrentText   = '';
  let llmPromptText    = '';
  let llmSelectedYear  = null;
  let copiedHistory    = false;
  let copiedCurrent    = false;
  let copiedPrompt     = false;

  // ── Manager grades state ───────────────────────────────────────────────────
  let rosterStats        = null;
  let loadingManagers    = false;
  let managerDebug       = [];
  let showManagerDebug   = false;
  let llmDraftScores     = {};  // { [year]: { [managerId]: score 0-100 } }
  let seasonManagerGrades = {}; // { [year]: { [managerId]: gradeResult } }
  let allTimeManagerGrades = {};
  let managerGradeYear   = null;

  // Per-season aggregated trade/waiver PAR per manager
  let managerTradePARBySeason   = {}; // { [year]: { [managerId]: total } }
  let managerWaiverPARBySeason  = {}; // { [year]: { [managerId]: total } }
  let managerLineupIQBySeason   = {}; // { [year]: { [managerId]: ratio } }

  // ── Power rankings state ───────────────────────────────────────────────────
  let powerRankingsYear    = null;
  let powerRankingsWeek    = 0;
  let powerRankings        = null;
  let previousPowerRankings = null;
  let rankingsWithMovement = [];
  let loadingPower         = false;

  // ── Reactive ───────────────────────────────────────────────────────────────
  $: draftYearOptions = allDrafts.map((d) => d.year).sort((a, b) => b - a);

  $: filteredTransactions = gradedTransactions
    .filter((tx) => !tx.isPartOfComposite)
    .filter((tx) => txFilter === 'all' || tx.type === txFilter);

  $: if (transactionHistory && selectedTransactionSeason) {
    const snap = get(teamManagersStore) || {};
    seasonTransactionTotals = getSeasonTransactionTotals(
      transactionHistory.totals, selectedTransactionSeason, snap
    );
  }

  $: currentSeasonYears = allTimeHistory?.seasons?.map((s) => String(s.year)).sort((a,b) => Number(b)-Number(a)) || [];
  $: allManagerIds = allTimeHistory ? Object.keys(allTimeHistory.managers || {}) : [];

  // ── Helpers ────────────────────────────────────────────────────────────────
  function managerDisplayName(managerId) {
    if (!managerId) return '?';
    const snap = get(teamManagersStore) || {};
    return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
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

  function valueLabelClass(label) {
    if (!label) return '';
    if (label === 'elite steal' || label === 'steal') return 'vl-steal';
    if (label === 'value')                            return 'vl-value';
    if (label === 'as expected')                      return 'vl-neutral';
    if (label === 'slight bust')                      return 'vl-slight-bust';
    if (label === 'bust' || label === 'major bust')   return 'vl-bust';
    if (label.includes('reach'))                      return 'vl-reach';
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
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedTx = next;
  }

  async function copyToClipboard(text, which) {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'history')  { copiedHistory = true;  setTimeout(() => copiedHistory = false, 2000); }
      if (which === 'current')  { copiedCurrent = true;  setTimeout(() => copiedCurrent = false, 2000); }
      if (which === 'prompt')   { copiedPrompt  = true;  setTimeout(() => copiedPrompt  = false, 2000); }
    } catch {}
  }

  // ── Core data loader (runs once) ──────────────────────────────────────────
  async function ensureAllTimeHistory() {
    if (allTimeHistory) return;
    globalDebug.push('Loading all-time history...');
    await getLeagueTeamManagers();
    allTimeHistory = await getAllSeasonsHistory();
    globalDebug.push(`All-time history loaded. Seasons: ${Object.keys(allTimeHistory.parTablesBySeason || {}).join(', ')}`);
    globalDebug.push(`Player results: ${allTimeHistory.playerResults?.length ?? 0} rows.`);
    globalDebug = [...globalDebug];
  }

  // ── Transaction loader ─────────────────────────────────────────────────────
  async function loadTransactions() {
    loadingTransactions = true;
    transactionDebug = [];
    gradedTransactions = [];

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

      // Build per-manager per-season trade/waiver PAR for manager grades
      managerTradePARBySeason  = {};
      managerWaiverPARBySeason = {};
      gradedTransactions.filter((tx) => !tx.isPartOfComposite).forEach((tx) => {
        const year = String(tx.seasonKey || tx.season);
        if (tx.type === 'trade' && tx.grade) {
          [tx.grade.side0, tx.grade.side1].forEach((side, idx) => {
            const mgrId = tx.managerIds?.[idx];
            if (!mgrId) return;
            if (!managerTradePARBySeason[year]) managerTradePARBySeason[year] = {};
            managerTradePARBySeason[year][mgrId] = (managerTradePARBySeason[year][mgrId] || 0) + (side?.parTotal || 0);
          });
        }
        if (tx.type === 'waiver' && tx.grade && tx.managerIds?.[0]) {
          const mgrId = tx.managerIds[0];
          if (!managerWaiverPARBySeason[year]) managerWaiverPARBySeason[year] = {};
          managerWaiverPARBySeason[year][mgrId] = (managerWaiverPARBySeason[year][mgrId] || 0) + (tx.grade.par || 0);
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

  // ── Draft loader ───────────────────────────────────────────────────────────
  async function loadDrafts() {
    loadingDrafts = true;
    draftDebug = [];
    try {
      await ensureAllTimeHistory();
      allDrafts = await getAllDrafts(allTimeHistory.allPlayersData || {});
      draftDebug.push(`Loaded ${allDrafts.length} draft(s): ${allDrafts.map((d) => d.year).join(', ')}`);
      if (allDrafts.length > 0) {
        selectedDraftYear = allDrafts[0].year;
        await analyzeDraft(selectedDraftYear);
      }
    } catch (e) {
      console.error(e);
      draftDebug.push(`Crash: ${e.message}`);
    } finally {
      loadingDrafts = false;
    }
  }

  async function analyzeDraft(year) {
    selectedDraft    = allDrafts.find((d) => d.year === year) || null;
    preSeasonGrade   = null;
    endOfSeasonGrade = null;
    if (!selectedDraft) return;

    draftDebug.push(`--- Analyzing ${year} (${selectedDraft.picks.length} picks) ---`);
    preSeasonGrade = gradeDraftPreSeason(selectedDraft);

    const parTables         = allTimeHistory?.parTablesBySeason?.[String(year)];
    const allSeasonStats    = allTimeHistory?.allSeasonStats || {};
    const parTablesBySeason = allTimeHistory?.parTablesBySeason || {};
    const allPlayersData    = allTimeHistory?.allPlayersData || {};

    if (!parTables) { draftDebug.push(`No PAR tables for ${year}.`); return; }

    const baselines = computeRoundBaselines(year, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData);
    if (!baselines) { draftDebug.push(`Could not compute round baselines for ${year}.`); return; }

    draftDebug.push(`Baseline seasons: ${baselines.seasonYears.join(', ')}`);
    draftDebug.push(...(baselines.debug || []));

    const scoringSettings = allTimeHistory?.sharedScoringSettings || null;
    const statsResult = await getSeasonStatTotals(year, scoringSettings).catch((err) => {
      draftDebug.push(`Stats fetch failed: ${err.message}`);
      return null;
    });

    if (!statsResult) return;
    draftDebug.push(`${year} stats: ${Object.keys(statsResult.totals || {}).length} players.`);

    endOfSeasonGrade = gradeDraftEndOfSeason(
      selectedDraft, statsResult.totals, statsResult.gamesPlayed, baselines, parTables, allPlayersData
    );

    if (endOfSeasonGrade) draftDebug.push(...(endOfSeasonGrade.debug || []));
    draftDebug = [...draftDebug];
  }

  // ── LLM context builder ────────────────────────────────────────────────────
  function buildLLMContext(year) {
    if (!allTimeHistory || !allDrafts.length) return;
    const allSeasonStats = allTimeHistory.allSeasonStats || {};
    const allPlayersData = allTimeHistory.allPlayersData || {};

    const { text } = buildDraftHistoryContext(allDrafts, allSeasonStats, managerDisplayName);
    llmHistoryText = text;

    const draft = allDrafts.find((d) => d.year === Number(year));
    llmCurrentText = buildCurrentDraftSummary(draft, managerDisplayName);

    llmPromptText = DRAFT_GRADING_PROMPT_TEMPLATE
      .replace('{{HISTORY}}', llmHistoryText)
      .replace('{{CURRENT_DRAFT}}', llmCurrentText);

    llmSelectedYear = year;
  }

  // ── Manager grades loader ──────────────────────────────────────────────────
  async function loadManagerGrades(year) {
    loadingManagers = true;
    managerDebug = [];
    try {
      await ensureAllTimeHistory();

      // Lineup IQ from roster stats
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

      // Aggregate lineup IQ per season per manager
      managerLineupIQBySeason = {};
      Object.entries(rosterStats || {}).forEach(([mgrId, seasons]) => {
        Object.entries(seasons).forEach(([yr, data]) => {
          if (!managerLineupIQBySeason[yr]) managerLineupIQBySeason[yr] = {};
          if (data.lineupIQ != null) managerLineupIQBySeason[yr][mgrId] = data.lineupIQ;
        });
      });

      managerGradeYear = year || currentSeasonYears[0];
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
      const draftScores = llmDraftScores[year] || {};
      seasonManagerGrades[year] = computeSeasonManagerGrades(
        year, draftScores,
        managerTradePARBySeason[year] || {},
        managerWaiverPARBySeason[year] || {},
        managerLineupIQBySeason[year]  || {},
        allManagerIds
      );
    });
    allTimeManagerGrades = computeAllTimeManagerGrades(seasonManagerGrades);
  }

  function updateLLMDraftScore(year, managerId, value) {
    const score = parseFloat(value);
    if (!llmDraftScores[year]) llmDraftScores[year] = {};
    llmDraftScores[year][managerId] = isNaN(score) ? null : Math.min(100, Math.max(0, score));
    llmDraftScores = { ...llmDraftScores };
    recomputeManagerGrades();
  }

  function importPostSeasonDraftGrades(year) {
    // Auto-populate draft scores from post-season data grade if available
    const draftYear = allDrafts.find((d) => d.year === Number(year));
    if (!draftYear || !endOfSeasonGrade) return;
    const yearStr = String(year);
    if (!llmDraftScores[yearStr]) llmDraftScores[yearStr] = {};
    Object.entries(endOfSeasonGrade.byRoster || {}).forEach(([, team]) => {
      const score = letterGradeToScore(team.grade);
      if (score != null && team.managerId) {
        llmDraftScores[yearStr][team.managerId] = score;
      }
    });
    llmDraftScores = { ...llmDraftScores };
    recomputeManagerGrades();
  }

  // ── Power rankings ─────────────────────────────────────────────────────────
  async function computePower() {
    loadingPower = true;
    try {
      await ensureAllTimeHistory();
      const yearStr    = String(powerRankingsYear);
      const seasonData = allTimeHistory.seasons.find((s) => String(s.year) === yearStr);
      if (!seasonData) return;

      const standings    = seasonData.standings    || [];
      const weeklyResults = allTimeHistory.weeklyResults.filter((r) => String(r.year) === yearStr);

      const yearMap = get(teamManagersStore)?.teamManagersMap?.[yearStr] || {};
      const rosterToManagerId = (rosterId) => {
        return yearMap[String(rosterId)]?.managers?.[0] ?? null;
      };

      const mgrGradesThisSeason = seasonManagerGrades[yearStr] || {};
      const rankings = computePowerRankings(
        powerRankingsWeek, standings, weeklyResults,
        mgrGradesThisSeason, allTimeManagerGrades, rosterToManagerId
      );

      if (powerRankings) previousPowerRankings = powerRankings.rankings;
      powerRankings = rankings;
      rankingsWithMovement = computeRankMovement(rankings.rankings, previousPowerRankings || []);
    } catch (e) {
      console.error(e);
    } finally {
      loadingPower = false;
    }
  }

  onMount(async () => {
    await getLeagueTeamManagers().catch(() => {});
    if (currentSeasonYears.length === 0) {
      await ensureAllTimeHistory().catch(() => {});
    }
  });
</script>

<main class="container">
  <h1>League Analysis Panel</h1>

  <!-- ── Main tab bar ───────────────────────────────────────────────────────── -->
  <div class="main-tabs">
    <button class="tab-btn {mainTab === 'transactions' ? 'active' : ''}" on:click={() => (mainTab = 'transactions')}>💱 Transactions</button>
    <button class="tab-btn {mainTab === 'draft'        ? 'active' : ''}" on:click={() => (mainTab = 'draft')}>📋 Draft Analysis</button>
    <button class="tab-btn {mainTab === 'llm'          ? 'active' : ''}" on:click={() => (mainTab = 'llm')}>🤖 LLM Draft Context</button>
    <button class="tab-btn {mainTab === 'managers'     ? 'active' : ''}" on:click={() => (mainTab = 'managers')}>📊 Manager Grades</button>
    <button class="tab-btn {mainTab === 'power'        ? 'active' : ''}" on:click={() => (mainTab = 'power')}>⚡ Power Rankings</button>
  </div>

  <!-- ════════════════════════════════════════════════════════════════════════ -->
  <!-- TRANSACTIONS TAB                                                         -->
  <!-- ════════════════════════════════════════════════════════════════════════ -->
  {#if mainTab === 'transactions'}
    <h2>Transaction Analysis</h2>
    <div class="control-row">
      <button on:click={loadTransactions} disabled={loadingTransactions}>
        {loadingTransactions ? 'Loading...' : transactionHistory ? 'Reload Transactions' : 'Load Transactions'}
      </button>
    </div>

    {#if loadingTransactions}
      <div class="status-msg">Fetching and grading all transactions...</div>
    {:else if transactionHistory}

      <h4>All-Time Transaction Totals</h4>
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

      <h4>All Transactions (PAR Graded) <span class="count-badge">{filteredTransactions.length}</span></h4>
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
              {#if g?.hasDraftPicks}<span class="badge pick">📋 Picks</span>{/if}
            </div>
            <div class="tx-managers">
              {#if tx.isComposite}{(tx.teams || []).map((t) => managerDisplayName(t.managerId)).join(' → ')}
              {:else if tx.managerIds?.length}{tx.managerIds.map((id) => managerDisplayName(id)).join(' ↔ ')}
              {:else}—{/if}
            </div>
            {#if tx.isComposite && g}
              <span class="par-line">{(g.ranked || []).map((t) => `${managerDisplayName(t.managerId)}: ${fp(t.parTotal)} PAR`).join(' | ')}</span>
            {:else if tx.type === 'trade' && g}
              <span class="grade-badge grade-{g.narrative?.grade}">{tradeGradeEmoji(g.narrative?.grade)} {g.narrative?.grade}</span>
              <span class="par-line">{managerDisplayName(tx.managerIds?.[0])}: {fp(g.side0?.parTotal)} | {managerDisplayName(tx.managerIds?.[1])}: {fp(g.side1?.parTotal)} PAR</span>
            {:else if tx.type === 'waiver' && g}
              <span class="grade-badge grade-{g.gradeLabel}">{waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}</span>
              <span class="par-line">{g.name} ({g.position}) · {fp(g.par)} PAR · {g.weeksHeld} wk(s)</span>
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
                      <div class="side-par">PAR: <span class="{parClass(side?.parTotal)}">{signedFp(side?.parTotal)}</span> · Raw: {fp(side?.rawTotal)}</div>
                      {#each (side?.players || []) as p}
                        <div class="player-block">
                          <div class="p-row"><span class="pos">{p.position}</span><strong>{p.name}</strong><span class="{parClass(p.par)}">{signedFp(p.par)} PAR</span></div>
                          <div class="p-stats">{fp(p.totalPts)} total / {fp(p.startedPts)} started · {p.weeksStarted}/{p.weeksHeld} wks</div>
                          <div class="baseline-info">baseline: {fp(p.repSeasonTotal)}/season ÷ 17 = {fp(p.repPerWeek)}/wk × {p.weeksHeld} wks = {fp(p.baseline)} vs <em>{p.repName}</em></div>
                          {#if p.weekBreakdown?.length > 0}
                            <table class="wk-table">
                              <thead><tr><th>Wk</th><th>Player</th><th>Started?</th><th>Rep/wk</th><th>PAR</th></tr></thead>
                              <tbody>
                                {#each p.weekBreakdown as row}
                                  <tr><td>{row.week}</td><td>{fp(row.playerPts)}</td><td>{row.startedPts > 0 ? '✓' : '—'}</td><td>{fp(row.repBaseline)}</td><td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td></tr>
                                {/each}
                                <tr class="totals"><td>Total</td><td>{fp(p.totalPts)}</td><td>—</td><td>{fp(p.baseline)}</td><td class="{parClass(p.par)}">{signedFp(p.par)}</td></tr>
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
                    <div class="p-row"><span class="pos">{g.position}</span><strong>{g.name}</strong><span class="grade-badge grade-{g.gradeLabel}">{waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}</span></div>
                    <div class="p-stats">{fp(g.totalPts)} total / {fp(g.startedPts)} started · {g.weeksStarted}/{g.weeksHeld} wks{g.isStream ? ' (stream)' : ''}</div>
                    {#if g.droppedName}<div class="dropped">Dropped: {g.droppedName}</div>{/if}
                  </div>
                  <div class="w-section">
                    <div class="w-header">📊 Replacement</div>
                    <div class="p-row"><span class="pos">{g.position}</span><strong>{g.repName}</strong></div>
                    <div class="p-stats">{fp(g.repSeasonTotal)} season pts ÷ 17 = {fp(g.repPerWeek)} pts/wk</div>
                    <div class="p-stats">Prorated ({g.weeksHeld} wks): <strong>{fp(g.baseline)}</strong></div>
                  </div>
                  <div class="w-section">
                    <div class="w-header">🎯 Result</div>
                    <div class="formula">{fp(g.totalPts)} − {fp(g.baseline)} = <strong class="{parClass(g.par)}">{signedFp(g.par)} PAR</strong></div>
                  </div>
                </div>
                {#if g.weekBreakdown?.length > 0}
                  <table class="wk-table" style="margin-top:0.5rem;">
                    <thead><tr><th>Wk</th><th>{g.name.split(' ').pop()}</th><th>Started?</th><th>Rep/wk</th><th>PAR</th></tr></thead>
                    <tbody>
                      {#each g.weekBreakdown as row}
                        <tr><td>{row.week}</td><td>{fp(row.playerPts)}</td><td>{row.startedPts > 0 ? '✓' : '—'}</td><td>{fp(row.repBaseline)}</td><td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td></tr>
                      {/each}
                      <tr class="totals"><td>Total</td><td>{fp(g.totalPts)}</td><td>—</td><td>{fp(g.baseline)}</td><td class="{parClass(g.par)}">{signedFp(g.par)}</td></tr>
                    </tbody>
                  </table>
                {/if}
              {:else if tx.isComposite && g}
                <div class="trade-sides">
                  {#each g.teamGrades as team}
                    {@const isWinner = g.winnerRoster === team.roster}
                    <div class="side {isWinner ? 'winner' : ''}">
                      <div class="side-header">{isWinner ? '🏆 ' : ''}{managerDisplayName(team.managerId)} (net):</div>
                      <div class="side-par">PAR: <span class="{parClass(team.parTotal)}">{signedFp(team.parTotal)}</span></div>
                      {#each (team.players || []) as p}
                        <div class="player-block">
                          <div class="p-row"><span class="pos">{p.position}</span><strong>{p.name}</strong><span class="{parClass(p.par)}">{signedFp(p.par)} PAR</span></div>
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showTxDebug = !showTxDebug)}>{showTxDebug ? 'Hide' : 'Show'} Transaction Debug</button>
      </div>
      {#if showTxDebug}
        <div class="debug-terminal"><h4>Transaction Debug</h4><ul>{#each transactionDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
      {/if}
    {/if}

  <!-- ════════════════════════════════════════════════════════════════════════ -->
  <!-- DRAFT ANALYSIS TAB                                                       -->
  <!-- ════════════════════════════════════════════════════════════════════════ -->
  {:else if mainTab === 'draft'}
    <h2>Draft Analysis</h2>
    <div class="control-row">
      <button on:click={loadDrafts} disabled={loadingDrafts}>
        {loadingDrafts ? 'Loading...' : allDrafts.length > 0 ? 'Reload Drafts' : 'Load Draft Data'}
      </button>
    </div>

    {#if loadingDrafts}
      <div class="status-msg">Loading drafts and computing PAR baselines...</div>
    {:else if allDrafts.length > 0}
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={selectedDraftYear} on:change={async () => { await analyzeDraft(selectedDraftYear); }}>
          {#each draftYearOptions as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        <div class="tab-group">
          <button class="tab-btn {draftActiveTab === 'end' ? 'active' : ''}" on:click={() => (draftActiveTab = 'end')}>End-of-Season Grade</button>
          <button class="tab-btn {draftActiveTab === 'pre' ? 'active' : ''}" on:click={() => (draftActiveTab = 'pre')}>Pre-Season Grade</button>
        </div>
      </div>

      <!-- END-OF-SEASON TAB -->
      {#if draftActiveTab === 'end'}
        {#if endOfSeasonGrade}
          <h3>{endOfSeasonGrade.year} — End-of-Season Draft Grade</h3>
          <div class="explainer">
            <strong>Adjusted PAR = Actual PAR − Expected PAR.</strong><br/>
            Actual PAR = actual pts − positional replacement level (this season's real settings).<br/>
            Expected PAR = historical average Actual PAR for that round
            (averaged equally across {endOfSeasonGrade.baselineSeasons?.join(', ')} seasons —
            2023 data uses forced 2-FLEX when included in 2024+ baselines for consistency).<br/>
            K/DEF: no round adjustment — adjustedPAR = actualPAR directly.
          </div>

          <!-- Reference panels -->
          <div class="ref-grid">
            <div class="ref-panel">
              <div class="ref-title">📊 Expected PAR by Round
                <span class="ref-sub">(avg of {endOfSeasonGrade.baselineSeasons?.join('+')} seasons, equal weight per year)</span>
              </div>
              <div class="baseline-pills">
                {#each Object.entries(endOfSeasonGrade.expectedPARByRound || {}).sort(([a],[b]) => Number(a)-Number(b)) as [r, val]}
                  <div class="baseline-pill">
                    <span class="bl-round">R{r}</span>
                    <span class="bl-pts">{signedFp(val)}</span>
                    <span class="bl-raw muted">raw: {signedFp(endOfSeasonGrade.rawExpectedPAR?.[r])}</span>
                    <span class="bl-n muted">{endOfSeasonGrade.sampleSizes?.[r]} yr(s)</span>
                  </div>
                {/each}
              </div>
            </div>
            <div class="ref-panel">
              <div class="ref-title">🔄 Replacement Levels (this season)</div>
              <div class="rep-pills">
                {#each Object.entries(endOfSeasonGrade.replacementLevels || {}).sort(([a],[b]) => a.localeCompare(b)) as [pos, pts]}
                  <div class="rep-pill">
                    <span class="rp-pos">{pos}</span>
                    <span class="rp-pts">{fp(pts)} pts</span>
                    <span class="rp-name muted">{endOfSeasonGrade.replacementNames?.[pos] || '?'}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <!-- Team rankings -->
          <h4>Team Draft Grades</h4>
          <table class="data-table">
            <thead>
              <tr><th>Rank</th><th>Manager</th><th>Grade</th><th>Adj PAR</th><th>Excl. Inj</th><th>Actual Pts</th><th>Injuries</th><th>Best Pick</th><th>Worst Pick</th></tr>
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
                  <td>{#if team.injured.length > 0}<span class="injury-count">🤕 {team.injured.length}</span>{:else}—{/if}</td>
                  <td>{#if team.bestPick}{team.bestPick.playerName} R{team.bestPick.round} <span class="vl-tag vl-steal">{signedFp(team.bestPick.adjustedPAR)}</span>{:else}—{/if}</td>
                  <td>{#if team.worstPick}{team.worstPick.playerName} R{team.worstPick.round} {injuryIcon(team.worstPick.injuryFlag)} <span class="vl-tag vl-bust">{signedFp(team.worstPick.adjustedPAR)}</span>{:else}—{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>

          <!-- Steals and busts -->
          <div class="two-col">
            <div>
              <h4>🔥 Biggest Steals</h4>
              <table class="data-table">
                <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Actual</th><th>Act PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Manager</th></tr></thead>
                <tbody>
                  {#each endOfSeasonGrade.leagueTopSteals as pick}
                    <tr>
                      <td>{pick.playerName}</td><td><span class="pos">{pick.pos}</span></td>
                      <td>{pick.round}</td><td>{fp(pick.actualPts)}</td>
                      <td class="muted">{signedFp(pick.actualPAR)}</td>
                      <td class="muted">{signedFp(pick.expectedPAR)}</td>
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
                <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Actual</th><th>Act PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Inj</th><th>Manager</th></tr></thead>
                <tbody>
                  {#each endOfSeasonGrade.leagueTopBusts as pick}
                    <tr>
                      <td>{pick.playerName}</td><td><span class="pos">{pick.pos}</span></td>
                      <td>{pick.round}</td><td>{fp(pick.actualPts)}</td>
                      <td class="muted">{signedFp(pick.actualPAR)}</td>
                      <td class="muted">{signedFp(pick.expectedPAR)}</td>
                      <td class="negative">{signedFp(pick.adjustedPAR)}</td>
                      <td>{injuryIcon(pick.injuryFlag) || '—'}</td>
                      <td>{managerDisplayName(pick.managerId)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Full per-team breakdowns -->
          <h4>Full Breakdown by Team</h4>
          {#each endOfSeasonGrade.teamRankings as team}
            <div class="team-block">
              <div class="team-header">
                <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
                <strong>{managerDisplayName(team.managerId)}</strong>
                <span class="header-stat">Adj PAR: <span class="{parClass(team.totalAdjustedPAR)}">{signedFp(team.totalAdjustedPAR)}</span></span>
                <span class="header-stat muted">Act PAR: {signedFp(team.totalActualPAR)} · {fp(team.totalActualPts)} pts</span>
                {#if team.injured.length > 0}<span class="header-stat muted">🤕 {team.injured.length} injured · excl: <span class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</span></span>{/if}
              </div>
              <div class="table-scroll">
                <table class="data-table mini">
                  <thead><tr><th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th><th>Actual Pts</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Games</th><th>Label</th></tr></thead>
                  <tbody>
                    {#each team.picks as pick}
                      <tr class="{pick.injuryFlag ? 'injury-row' : ''}">
                        <td>{pick.round}</td><td>#{pick.pickNo}</td>
                        <td>{pick.playerName}{#if pick.injuryFlag} {injuryIcon(pick.injuryFlag)}{/if}</td>
                        <td><span class="pos">{pick.pos}</span></td>
                        <td>{fp(pick.actualPts)}</td>
                        <td class="muted">{signedFp(pick.actualPAR)}</td>
                        <td class="muted">{pick.noRoundAdjustment ? '0 (K/DEF)' : signedFp(pick.expectedPAR)}</td>
                        <td class="{parClass(pick.adjustedPAR)}">{pick.adjustedPAR != null ? signedFp(pick.adjustedPAR) : '—'}</td>
                        <td class="{pick.injuryFlag ? 'negative' : 'muted'}">{pick.gamesPlayed != null ? pick.gamesPlayed : '—'}</td>
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
          <div class="status-msg">Load Draft Data to see end-of-season grades.</div>
        {/if}

      <!-- PRE-SEASON TAB -->
      {:else if draftActiveTab === 'pre'}
        {#if preSeasonGrade}
          <h3>{preSeasonGrade.year} — Pre-Season Draft Grade (Positional Scarcity)</h3>
          <div class="explainer">
            Grades based on positional scarcity within the draft itself — no projections needed.
            <strong>vs Market</strong> = picks earlier/later than average for that positional slot.
          </div>
          <h4>Team Grades</h4>
          <table class="data-table">
            <thead><tr><th>Rank</th><th>Manager</th><th>Grade</th><th>Avg vs Market</th><th>Best Pick</th><th>Worst Pick</th></tr></thead>
            <tbody>
              {#each preSeasonGrade.teamRankings as team, idx}
                <tr>
                  <td>#{idx+1}</td>
                  <td><strong>{managerDisplayName(team.managerId)}</strong></td>
                  <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                  <td class="{(parseFloat(team.avgVsMarket)||0) >= 0 ? 'positive' : 'negative'}">{signedFp(team.avgVsMarket)} picks</td>
                  <td>{#if team.bestValuePick}{team.bestValuePick.playerName} ({team.bestValuePick.pos}) R{team.bestValuePick.round} <span class="vl-tag vl-steal">{signedFp(team.bestValuePick.vsMarket)}</span>{:else}—{/if}</td>
                  <td>{#if team.worstValuePick}{team.worstValuePick.playerName} ({team.worstValuePick.pos}) R{team.worstValuePick.round} <span class="vl-tag vl-bust">{signedFp(team.worstValuePick.vsMarket)}</span>{:else}—{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="status-msg">Pre-season grade not available yet.</div>
        {/if}
      {/if}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showDraftDebug = !showDraftDebug)}>{showDraftDebug ? 'Hide' : 'Show'} Draft Debug</button>
      </div>
      {#if showDraftDebug}
        <div class="debug-terminal"><h4>Draft Debug</h4><ul>{#each draftDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
      {/if}
    {/if}

  <!-- ════════════════════════════════════════════════════════════════════════ -->
  <!-- LLM DRAFT CONTEXT TAB                                                    -->
  <!-- ════════════════════════════════════════════════════════════════════════ -->
  {:else if mainTab === 'llm'}
    <h2>LLM Draft Context Builder</h2>
    <div class="explainer">
      Generate text context to paste into Claude or ChatGPT for post-draft qualitative grading.
      The history includes actual season results where available, so the LLM can learn each
      manager's drafting tendencies. Paste the full prompt into an LLM, get scores back (0-100
      per manager), and enter them in the Manager Grades tab.
    </div>

    {#if !allDrafts.length}
      <div class="control-row">
        <button on:click={loadDrafts} disabled={loadingDrafts}>{loadingDrafts ? 'Loading...' : 'Load Draft Data First'}</button>
      </div>
    {:else}
      <div class="control-row">
        <label><strong>Draft to grade:</strong></label>
        <select bind:value={llmSelectedYear} on:change={() => buildLLMContext(llmSelectedYear)}>
          <option value={null}>Select a year...</option>
          {#each draftYearOptions as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        {#if llmSelectedYear}
          <button on:click={() => buildLLMContext(llmSelectedYear)}>Generate Context</button>
        {/if}
      </div>

      {#if llmPromptText}
        <!-- Full combined prompt -->
        <div class="llm-section">
          <div class="llm-header">
            <h4>📋 Full Prompt (paste this into LLM)</h4>
            <button class="copy-btn {copiedPrompt ? 'copied' : ''}" on:click={() => copyToClipboard(llmPromptText, 'prompt')}>
              {copiedPrompt ? '✓ Copied!' : 'Copy Full Prompt'}
            </button>
          </div>
          <pre class="llm-text">{llmPromptText}</pre>
        </div>

        <!-- Individual pieces -->
        <div class="two-col" style="margin-top:1rem;">
          <div class="llm-section">
            <div class="llm-header">
              <h4>📚 History Only</h4>
              <button class="copy-btn {copiedHistory ? 'copied' : ''}" on:click={() => copyToClipboard(llmHistoryText, 'history')}>
                {copiedHistory ? '✓ Copied!' : 'Copy History'}
              </button>
            </div>
            <pre class="llm-text small">{llmHistoryText}</pre>
          </div>
          <div class="llm-section">
            <div class="llm-header">
              <h4>📝 Current Draft Only</h4>
              <button class="copy-btn {copiedCurrent ? 'copied' : ''}" on:click={() => copyToClipboard(llmCurrentText, 'current')}>
                {copiedCurrent ? '✓ Copied!' : 'Copy Current Draft'}
              </button>
            </div>
            <pre class="llm-text small">{llmCurrentText}</pre>
          </div>
        </div>
      {:else if llmSelectedYear}
        <div class="status-msg">Click "Generate Context" to build the LLM prompt.</div>
      {/if}
    {/if}

  <!-- ════════════════════════════════════════════════════════════════════════ -->
  <!-- MANAGER GRADES TAB                                                       -->
  <!-- ════════════════════════════════════════════════════════════════════════ -->
  {:else if mainTab === 'managers'}
    <h2>Manager Grades</h2>
    <div class="explainer">
      Weights: 40% Draft · 20% Trades · 20% Waivers · 20% Lineup IQ (fpts/ppts).<br/>
      Draft scores must be entered manually (from LLM post-draft grade or post-season data grade).<br/>
      All components are normalized within-league within-season. Missing components redistribute weight proportionally.
    </div>
    <div class="control-row">
      <button on:click={() => loadManagerGrades(currentSeasonYears[0])} disabled={loadingManagers}>
        {loadingManagers ? 'Loading...' : rosterStats ? 'Reload Manager Grades' : 'Load Manager Grades'}
      </button>
      {#if !transactionHistory}
        <span class="muted">⚠ Load Transactions first for trade/waiver PAR data.</span>
      {/if}
    </div>

    {#if rosterStats || Object.keys(seasonManagerGrades).length > 0}
      <!-- Season selector -->
      <div class="control-row">
        <label><strong>Season:</strong></label>
        <select bind:value={managerGradeYear} on:change={recomputeManagerGrades}>
          {#each currentSeasonYears as yr}<option value={yr}>{yr}</option>{/each}
        </select>
        {#if managerGradeYear && endOfSeasonGrade && String(endOfSeasonGrade.year) === String(managerGradeYear)}
          <button on:click={() => importPostSeasonDraftGrades(managerGradeYear)}>
            Import Post-Season Draft Grades →
          </button>
        {/if}
      </div>

      {#if managerGradeYear}
        {@const yearGrades = seasonManagerGrades[String(managerGradeYear)] || {}}
        <h3>{managerGradeYear} Manager Grades</h3>

        <!-- Draft score input -->
        <div class="draft-score-inputs">
          <div class="input-header">
            <h4>Draft Scores (enter LLM output, 0-100)</h4>
            <span class="muted">Source: paste full prompt into LLM → enter each manager's score</span>
          </div>
          <div class="score-grid">
            {#each allManagerIds as mgrId}
              <div class="score-input-row">
                <span class="score-name">{managerDisplayName(mgrId)}</span>
                <input
                  type="number" min="0" max="100" step="1"
                  placeholder="0-100"
                  value={llmDraftScores[String(managerGradeYear)]?.[mgrId] ?? ''}
                  on:change={(e) => updateLLMDraftScore(String(managerGradeYear), mgrId, e.target.value)}
                  class="score-field"
                />
              </div>
            {/each}
          </div>
        </div>

        <!-- Season grades table -->
        <table class="data-table" style="margin-top:1rem;">
          <thead>
            <tr>
              <th>Manager</th><th>Overall (0-100)</th>
              <th>Draft (40%)</th><th>Trades (20%)</th>
              <th>Waivers (20%)</th><th>Lineup IQ (20%)</th>
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
              {@const comps  = result?.components || []}
              {@const draftComp  = comps.find(c => c.key === 'draft')}
              {@const tradeComp  = comps.find(c => c.key === 'trades')}
              {@const waiverComp = comps.find(c => c.key === 'waivers')}
              {@const lineupComp = comps.find(c => c.key === 'lineupIQ')}
              <tr>
                <td><strong>{managerDisplayName(mgrId)}</strong></td>
                <td>
                  {#if result?.overallGrade != null}
                    <span class="overall-score" style="background: hsl({result.overallGrade * 1.2},70%,45%); color:white; padding:0.2rem 0.5rem; border-radius:4px; font-weight:700;">
                      {fp(result.overallGrade, 0)}
                    </span>
                  {:else}—{/if}
                </td>
                <td>{draftComp?.score != null ? fp(draftComp.score, 0) : '—'}</td>
                <td>{tradeComp?.score != null ? fp(tradeComp.score, 0) : '—'}</td>
                <td>{waiverComp?.score != null ? fp(waiverComp.score, 0) : '—'}</td>
                <td>
                  {#if lineupComp?.score != null}
                    {fp(lineupComp.score, 0)}
                    <span class="muted">({fp((managerLineupIQBySeason[String(managerGradeYear)] || {})[mgrId] * 100, 1)}%)</span>
                  {:else}—{/if}
                </td>
                <td class="muted">{result?.missingComponents?.join(', ') || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Raw component data for validation -->
        <details>
          <summary class="muted" style="cursor:pointer;">Show raw component data</summary>
          <table class="data-table mini" style="margin-top:0.5rem;">
            <thead><tr><th>Manager</th><th>Trade PAR</th><th>Waiver PAR</th><th>fpts</th><th>ppts</th><th>LineupIQ%</th></tr></thead>
            <tbody>
              {#each allManagerIds as mgrId}
                {@const yr = String(managerGradeYear)}
                <tr>
                  <td>{managerDisplayName(mgrId)}</td>
                  <td class="{parClass(managerTradePARBySeason[yr]?.[mgrId])}">{fp(managerTradePARBySeason[yr]?.[mgrId])}</td>
                  <td class="{parClass(managerWaiverPARBySeason[yr]?.[mgrId])}">{fp(managerWaiverPARBySeason[yr]?.[mgrId])}</td>
                  <td>{fp(rosterStats?.[mgrId]?.[yr]?.fpts)}</td>
                  <td>{fp(rosterStats?.[mgrId]?.[yr]?.ppts)}</td>
                  <td>{rosterStats?.[mgrId]?.[yr]?.lineupIQ != null ? fp(rosterStats[mgrId][yr].lineupIQ * 100, 1) + '%' : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>
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
                  <span class="overall-score" style="background: hsl({data.allTimeGrade * 1.2},70%,45%); color:white; padding:0.2rem 0.5rem; border-radius:4px; font-weight:700;">
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
        <button on:click={() => (showManagerDebug = !showManagerDebug)}>{showManagerDebug ? 'Hide' : 'Show'} Manager Debug</button>
      </div>
      {#if showManagerDebug}
        <div class="debug-terminal"><h4>Manager Debug</h4><ul>{#each managerDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
      {/if}
    {/if}

  <!-- ════════════════════════════════════════════════════════════════════════ -->
  <!-- POWER RANKINGS TAB                                                       -->
  <!-- ════════════════════════════════════════════════════════════════════════ -->
  {:else if mainTab === 'power'}
    <h2>Power Rankings</h2>
    <div class="explainer">
      Blends record, points, recent form, and manager grade. Manager grade weight decreases as the
      season progresses (40% weeks 1-3 → 15% weeks 4-8 → 5% week 9+). Week 0 = pre-season / post-draft:
      100% manager grade. Load Manager Grades first for the best rankings.
    </div>

    <div class="control-row">
      <label><strong>Season:</strong></label>
      <select bind:value={powerRankingsYear}>
        {#each currentSeasonYears as yr}<option value={yr}>{yr}</option>{/each}
      </select>
      <label><strong>Through Week:</strong></label>
      <select bind:value={powerRankingsWeek}>
        <option value={0}>Pre-season (Week 0)</option>
        {#each Array.from({length:17}, (_,i) => i+1) as w}
          <option value={w}>Week {w}</option>
        {/each}
      </select>
      <button on:click={computePower} disabled={loadingPower}>
        {loadingPower ? 'Computing...' : 'Compute Rankings'}
      </button>
    </div>

    {#if powerRankings}
      <div class="phase-banner">
        Phase: <strong>{powerRankings.phase}</strong>
        · Weights: record {(powerRankings.weights.record*100).toFixed(0)}%
        / pts {(powerRankings.weights.points*100).toFixed(0)}%
        / form {(powerRankings.weights.recentForm*100).toFixed(0)}%
        / mgr grade {(powerRankings.weights.managerGrade*100).toFixed(0)}%
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Rank</th><th>Δ</th><th>Manager</th><th>Record</th>
            <th>PF</th><th>Score</th>
            <th>Record Score</th><th>Pts Score</th><th>Form Score</th><th>Mgr Score</th>
          </tr>
        </thead>
        <tbody>
          {#each rankingsWithMovement.length > 0 ? rankingsWithMovement : powerRankings.rankings as team}
            {@const mov = team.movement}
            <tr>
              <td><strong>#{team.rank}</strong></td>
              <td class="{mov > 0 ? 'positive' : mov < 0 ? 'negative' : 'muted'}">
                {#if mov > 0}↑{mov}{:else if mov < 0}↓{Math.abs(mov)}{:else if team.prevRank != null}—{:else}NEW{/if}
              </td>
              <td><strong>{managerDisplayName(team.managerId)}</strong> <span class="muted">({team.name})</span></td>
              <td>{team.wins}-{team.losses}{team.ties > 0 ? `-${team.ties}` : ''}</td>
              <td>{fp(team.pf)}</td>
              <td><strong>{fp(team.compositeScore)}</strong></td>
              <td class="muted">{fp(team.recordScore)}</td>
              <td class="muted">{fp(team.pointsScore)}</td>
              <td class="muted">{fp(team.formScore)}</td>
              <td class="muted">{fp(team.managerScore)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  <!-- Global debug -->
  {#if globalDebug.length > 0}
    <div class="control-row" style="margin-top:2rem;">
      <button on:click={() => (showGlobalDebug = !showGlobalDebug)}>{showGlobalDebug ? 'Hide' : 'Show'} Global Debug</button>
    </div>
    {#if showGlobalDebug}
      <div class="debug-terminal"><h4>Global Debug</h4><ul>{#each globalDebug as l}<li><code>{l}</code></li>{/each}</ul></div>
    {/if}
  {/if}
</main>

<style>
  .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  h1, h2, h3, h4 { margin: 0.75rem 0 0.5rem; }
  .control-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  select, button, input[type="number"] { padding: 0.5rem 1rem; font-size: 0.95rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; margin-bottom: 1rem; }
  .muted { color: #888; font-size: 0.87em; }
  .explainer { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.87rem; color: #0c4a6e; line-height: 1.6; }

  /* Main tabs */
  .main-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 2rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  .tab-group { display: flex; gap: 0.4rem; }
  .tab-btn { padding: 0.45rem 1rem; border-radius: 6px 6px 0 0; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.9rem; }
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
  .tx-meta { display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
  .tx-managers { font-size: 0.87em; color: #444; flex: 1; min-width: 100px; }
  .tx-info { font-size: 0.81em; color: #666; }
  .par-line { font-size: 0.83em; color: #555; }
  .expand-toggle { margin-left: auto; color: #888; font-size: 0.78em; }
  .tx-detail { padding: 0.75rem 1rem 1rem; border-top: 1px solid #eee; }
  .narrative { font-style: italic; color: #444; margin: 0 0 0.75rem; font-size: 0.89em; background: #f9f9f9; padding: 0.5rem 0.75rem; border-radius: 4px; }

  /* Trade layout */
  .trade-sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
  .side { padding: 0.7rem; border-radius: 6px; background: #f8f8f8; border: 2px solid transparent; }
  .side.winner { background: #f0fff4; border-color: #34d399; }
  .side-header { font-weight: 700; margin-bottom: 0.3rem; font-size: 0.92em; }
  .side-par { font-size: 0.84em; color: #555; margin-bottom: 0.5rem; }

  /* Waiver layout */
  .waiver-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
  .w-section { background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.65rem; }
  .w-header { font-weight: 700; color: #475569; font-size: 0.83em; margin-bottom: 0.35rem; }
  .formula { font-family: monospace; font-size: 0.88em; background: #f1f5f9; padding: 0.3rem 0.5rem; border-radius: 3px; }

  /* Player blocks */
  .player-block { background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.55rem; margin-top: 0.4rem; }
  .p-row { display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.2rem; }
  .p-stats { font-size: 0.81em; color: #555; }
  .baseline-info { font-size: 0.79em; color: #888; margin-top: 0.15rem; }
  .dropped { font-size: 0.81em; color: #999; }
  .pos { background: #e5e7eb; border-radius: 3px; padding: 0.08rem 0.3rem; font-size: 0.73em; font-weight: 700; }
  .count-badge { background: #e5e7eb; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.78rem; color: #555; margin-left: 0.5rem; font-weight: normal; }

  /* Week table */
  .wk-table { width: 100%; border-collapse: collapse; font-size: 0.8em; margin-top: 0.3rem; }
  .wk-table th, .wk-table td { border: 1px solid #e5e7eb; padding: 0.22rem 0.4rem; text-align: center; }
  .wk-table th { background: #f1f5f9; }

  /* Draft */
  .ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
  .ref-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; }
  .ref-title { font-weight: 700; font-size: 0.87em; color: #374151; margin-bottom: 0.5rem; }
  .ref-sub { font-weight: 400; color: #888; font-size: 0.9em; margin-left: 0.25rem; }
  .baseline-pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .baseline-pill { background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.2rem 0.45rem; font-size: 0.79em; display: flex; flex-direction: column; align-items: center; min-width: 52px; }
  .bl-round { font-weight: 700; color: #374151; }
  .bl-pts { font-weight: 700; color: #2563eb; }
  .bl-raw, .bl-n { font-size: 0.85em; }
  .rep-pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .rep-pill { background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.79em; display: flex; flex-direction: column; align-items: center; }
  .rp-pos { font-weight: 700; color: #374151; }
  .rp-pts { color: #555; }
  .rp-name { font-size: 0.88em; }

  /* Team blocks */
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

  /* LLM context */
  .llm-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; }
  .llm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .llm-header h4 { margin: 0; }
  .llm-text { white-space: pre-wrap; font-family: monospace; font-size: 0.78em; background: #1e1e1e; color: #d4d4d4; padding: 0.75rem; border-radius: 4px; max-height: 400px; overflow-y: auto; }
  .llm-text.small { max-height: 250px; font-size: 0.72em; }
  .copy-btn { padding: 0.3rem 0.8rem; font-size: 0.83rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; transition: background 0.15s; }
  .copy-btn.copied { background: #16a34a; }
  .copy-btn:hover:not(.copied) { background: #1d4ed8; }

  /* Manager grades */
  .draft-score-inputs { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1rem; }
  .input-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
  .input-header h4 { margin: 0; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem; }
  .score-input-row { display: flex; align-items: center; gap: 0.5rem; }
  .score-name { flex: 1; font-size: 0.87em; color: #374151; }
  .score-field { width: 70px; padding: 0.3rem 0.5rem; font-size: 0.87rem; text-align: center; }
  .overall-score { display: inline-block; }

  /* Power rankings */
  .phase-banner { background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 6px; padding: 0.5rem 1rem; margin-bottom: 1rem; font-size: 0.88rem; color: #4c1d95; }

  /* Badges */
  .badge { padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72em; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
  .badge.trade     { background: #dbeafe; color: #1d4ed8; }
  .badge.waiver    { background: #dcfce7; color: #15803d; }
  .badge.composite { background: #ede9fe; color: #6d28d9; }
  .badge.pick      { background: #fef3c7; color: #92400e; }
  .grade-badge { padding: 0.18rem 0.55rem; border-radius: 4px; font-weight: 700; font-size: 0.84em; display: inline-block; }
  .grade-a { background: #d1fae5; color: #065f46; }
  .grade-b { background: #e0f2fe; color: #0369a1; }
  .grade-c { background: #fef3c7; color: #92400e; }
  .grade-d { background: #fed7aa; color: #9a3412; }
  .grade-f { background: #fef2f2; color: #dc2626; }
  .vl-tag        { display: inline-block; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.77em; font-weight: 600; margin-left: 0.2rem; }
  .vl-steal      { background: #d1fae5; color: #065f46; }
  .vl-value      { background: #e0f2fe; color: #0369a1; }
  .vl-neutral    { background: #f3f4f6; color: #6b7280; }
  .vl-slight-bust { background: #fff7ed; color: #c2410c; }
  .vl-bust       { background: #fef2f2; color: #dc2626; }
  .vl-reach      { background: #fff7ed; color: #c2410c; }
  .injury-count  { color: #d97706; font-weight: 600; font-size: 0.88em; }

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
