<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getSpecificYearMatchups } from '$lib/utils/dataEngine/allMatchups.js';
  import { getLeaguePlayoffs } from '$lib/utils/dataEngine/allPlayoffs.js';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getLeagueData } from '$lib/utils/helperFunctions/leagueData.js';
  import { getLeagueState } from '$lib/utils/dataEngine/leagueState.js';
  import { getAllSeasonsHistory, getRivalry, getAllTimeTotals } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getTransactionHistory, getAllTimeTransactionTotals, getSeasonTransactionTotals, getTradeHistory } from '$lib/utils/dataEngine/allTransactions.js';
  import { gradeTradeByPAR, gradeWaiverByPAR, gradeCompositeTrade } from '$lib/utils/dataEngine/parGrading.js';
  import { teamManagersStore, leagueData } from '$lib/stores';

  // ── Season view ────────────────────────────────────────────────────────────
  let selectedLeagueID = '';
  let loading = false;
  let debugLogs = [];
  let standings = [];
  let weeklyResults = [];
  let podiums = { championId: null, lastPlaceId: null };
  let rawWinnersBracket = [];
  let rawLosersBracket = [];
  let currentManagersForYear = {};
  let showRawStandings = false;
  let showRawBrackets = false;
  let weekFilter = 'all';

  // ── All-time / PAR ─────────────────────────────────────────────────────────
  let allTimeHistory = null;
  let loadingAllTime = false;
  let allTimeDebug = [];
  let allTimeTotals = [];

  // ── Rivalry ────────────────────────────────────────────────────────────────
  let rivalryManagerA = '';
  let rivalryManagerB = '';
  let rivalryResult = null;

  // ── Transactions ───────────────────────────────────────────────────────────
  let transactionHistory = null;
  let loadingTransactions = false;
  let transactionDebug = [];
  let gradedTransactions = [];
  let allTimeTransactionTotals = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals = [];
  let rivalryTradeHistory = [];
  let txFilter = 'all';
  let showTransactionDebug = false;
  let expandedTx = new Set();

  // ── Reactive: season picker ────────────────────────────────────────────────
  $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => {
      const id = Object.keys($leagueData || {}).find((k) => $leagueData[k]?.season == year);
      return { year, id: id || year };
    });

  $: champTeam       = podiums.championId  != null ? standings.find((s) => s.rosterId === Number(podiums.championId))  : null;
  $: loserTeam       = podiums.lastPlaceId != null ? standings.find((s) => s.rosterId === Number(podiums.lastPlaceId)) : null;
  $: placementsTable = standings.filter((s) => s.finalPlacement != null).sort((a, b) => a.finalPlacement - b.finalPlacement);

  $: rivalryOptions = standings
    .map((team) => {
      const managerId = currentManagersForYear[team.rosterId]?.managerId;
      return managerId != null ? { managerId, label: team.name } : null;
    })
    .filter(Boolean);

  $: filteredWeeklyResults = weeklyResults.filter((r) => {
    if (weekFilter === 'regular')  return !r.isPlayoffs;
    if (weekFilter === 'playoffs') return  r.isPlayoffs;
    if (weekFilter === 'winners')  return  r.bracket === 'winners';
    if (weekFilter === 'losers')   return  r.bracket === 'losers';
    return true;
  });

  $: filteredTransactions = gradedTransactions
    .filter((tx) => !tx.isPartOfComposite)
    .filter((tx) => {
      if (txFilter === 'trade')  return tx.type === 'trade';
      if (txFilter === 'waiver') return tx.type === 'waiver';
      return true;
    });

  $: if (transactionHistory && selectedTransactionSeason) {
    const snap = get(teamManagersStore) || {};
    seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, snap);
  }

  $: if (rivalryResult && transactionHistory && rivalryManagerA && rivalryManagerB) {
    rivalryTradeHistory = getTradeHistory(transactionHistory.transactions, rivalryManagerA, rivalryManagerB)
      .filter((tx) => !tx.isPartOfComposite)
      .map((tx) => {
        const parTables     = allTimeHistory?.parTablesBySeason?.[String(tx.seasonKey || tx.season)];
        const playerResults = allTimeHistory?.playerResults || [];
        const allPlayersData = allTimeHistory?.allPlayersData || {};
        const managerNames  = (tx.managerIds || []).map((id) => managerDisplayName(id));
        if (tx.isComposite) {
          return { ...tx, grade: gradeCompositeTrade(tx, parTables, playerResults, allPlayersData) };
        }
        return { ...tx, grade: gradeTradeByPAR(tx, parTables, playerResults, allPlayersData, managerNames) };
      });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function resolveYear(currentLeagueID, allMetadata) {
    let year = allMetadata?.[currentLeagueID]?.season;
    if (!year && !isNaN(currentLeagueID)) year = currentLeagueID.toString();
    return year;
  }

  function buildManagersForYear(managersSnapshot, year) {
    const yearMap = managersSnapshot?.teamManagersMap?.[year] || {};
    const out = {};
    Object.entries(yearMap).forEach(([rosterId, teamInfo]) => {
      const managerNames = teamInfo?.managers
        ?.map((mID) => managersSnapshot.users?.[mID]?.display_name || 'Unknown')
        .join(' & ') || 'Unknown Manager';
      out[rosterId] = {
        name:      teamInfo?.team?.name || `Team ${rosterId}`,
        avatar:    teamInfo?.team?.avatar || '',
        managerNames,
        managerId: teamInfo?.managers?.[0] ?? null
      };
    });
    return out;
  }

  function nameForRoster(rosterId) {
    const found = standings.find((s) => s.rosterId === Number(rosterId));
    return found ? found.name : `Team ${rosterId}`;
  }

  function managerDisplayName(managerId) {
    if (!managerId) return '?';
    const snap = get(teamManagersStore) || {};
    return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
  }

  function fp(val) { return typeof val === 'number' ? val.toFixed(1) : '—'; }

  function gradeEmoji(label) {
    return { elite: '🔥', strong: '✅', solid: '👍', neutral: '➖', poor: '❌' }[label] || '?';
  }

  function tradeGradeEmoji(grade) {
    return { lopsided: '💥', clear: '✅', close: '⚖️', even: '🤝' }[grade] || '?';
  }

  function toggleTx(id) {
    const next = new Set(expandedTx);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedTx = next;
  }

  // ── Season loader ──────────────────────────────────────────────────────────
  async function loadSeasonData(leagueId) {
    if (!leagueId) return;
    loading = true;
    debugLogs = [];
    standings = [];
    weeklyResults = [];
    podiums = { championId: null, lastPlaceId: null };
    rawWinnersBracket = [];
    rawLosersBracket = [];

    try {
      const [matchupsData] = await Promise.all([
        getSpecificYearMatchups(leagueId).catch((err) => { debugLogs.push(`getSpecificYearMatchups failed: ${err.message}`); return null; }),
        getLeagueData(leagueId).catch((err) => { debugLogs.push(`getLeagueData note: ${err.message}`); return null; })
      ]);

      debugLogs.push(`matchupWeeks count: ${matchupsData?.matchupWeeks?.length ?? 'N/A'}`);
      debugLogs.push(...(matchupsData?.debug || []));

      const managersSnapshot = get(teamManagersStore) || {};
      const allMetadata = get(leagueData) || {};
      const year = resolveYear(leagueId, allMetadata);
      debugLogs.push(`Resolved year: ${year}`);

      const managersForYear = buildManagersForYear(managersSnapshot, year);
      currentManagersForYear = managersForYear;
      const numRosters = Object.keys(managersForYear).length;
      debugLogs.push(`Managers resolved: ${numRosters}`);

      if (!matchupsData) { debugLogs.push('No matchupsData.'); return; }

      const playoffData = await getLeaguePlayoffs(leagueId);
      rawWinnersBracket = playoffData.winnersBracket;
      rawLosersBracket  = playoffData.losersBracket;
      debugLogs.push(...playoffData.debug);

      const result = getLeagueState(matchupsData, managersForYear, allMetadata?.[leagueId] || null, {
        winnersBracket: playoffData.winnersBracket,
        losersBracket:  playoffData.losersBracket,
        numRosters
      });

      standings     = result.standings;
      weeklyResults = result.weeklyResults;
      podiums       = result.podiums;
      debugLogs.push(...result.debug);
    } catch (e) {
      console.error('Critical error:', e);
      debugLogs.push(`Crash: ${e.message}`);
    } finally {
      loading = false;
    }
  }

  // ── All-time history loader ────────────────────────────────────────────────
  async function loadAllTimeHistory() {
    loadingAllTime = true;
    allTimeDebug = [];
    try {
      allTimeHistory = await getAllSeasonsHistory();
      allTimeDebug   = allTimeHistory.debug;
      allTimeTotals  = getAllTimeTotals(allTimeHistory.managers);
    } catch (e) {
      allTimeDebug = [`Critical error: ${e.message}`];
    } finally {
      loadingAllTime = false;
    }
  }

  // ── Transaction loader ─────────────────────────────────────────────────────
  async function loadTransactionHistory() {
    loadingTransactions = true;
    transactionDebug   = [];
    gradedTransactions = [];

    try {
      if (!allTimeHistory) {
        transactionDebug.push('Loading all-time history for PAR grading...');
        allTimeHistory = await getAllSeasonsHistory();
        allTimeTotals  = getAllTimeTotals(allTimeHistory.managers);
        transactionDebug.push(`PAR tables built for ${Object.keys(allTimeHistory.parTablesBySeason || {}).length} seasons.`);
      }

      const txResult = await getTransactionHistory();
      transactionHistory = txResult;
      transactionDebug.push(...txResult.debug);

      const playerResults     = allTimeHistory.playerResults  || [];
      const allPlayersData    = allTimeHistory.allPlayersData || {};
      const parTablesBySeason = allTimeHistory.parTablesBySeason || {};

      gradedTransactions = txResult.transactions.map((tx) => {
        const parTables    = parTablesBySeason[String(tx.seasonKey || tx.season)];
        const managerNames = (tx.managerIds || []).map((id) => managerDisplayName(id));

        if (tx.isComposite) {
          return { ...tx, grade: gradeCompositeTrade(tx, parTables, playerResults, allPlayersData) };
        } else if (tx.type === 'trade') {
          return { ...tx, grade: gradeTradeByPAR(tx, parTables, playerResults, allPlayersData, managerNames) };
        } else if (tx.type === 'waiver') {
          return { ...tx, grade: gradeWaiverByPAR(tx, parTables, playerResults, allPlayersData) };
        }
        return tx;
      });

      const snap = get(teamManagersStore) || {};
      allTimeTransactionTotals = getAllTimeTransactionTotals(txResult.totals, snap);

      const availableSeasons = Object.keys(txResult.totals.seasons || {}).sort((a, b) => Number(b) - Number(a));
      if (availableSeasons.length > 0) {
        selectedTransactionSeason = availableSeasons[0];
        seasonTransactionTotals = getSeasonTransactionTotals(txResult.totals, selectedTransactionSeason, snap);
      }

      const compositeCount = gradedTransactions.filter((tx) => tx.isComposite).length;
      transactionDebug.push(`Graded ${gradedTransactions.length} transactions (${compositeCount} composite multi-team trades).`);
    } catch (e) {
      console.error('Critical error loading transactions:', e);
      transactionDebug.push(`Crash: ${e.message}`);
    } finally {
      loadingTransactions = false;
    }
  }

  // ── Rivalry ────────────────────────────────────────────────────────────────
  function computeRivalry() {
    if (!allTimeHistory || !rivalryManagerA || !rivalryManagerB) return;
    rivalryResult = getRivalry(allTimeHistory.weeklyResults, rivalryManagerA, rivalryManagerB);
  }

  // ── Mount ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    loading = true;
    const managers = await getLeagueTeamManagers().catch((err) => {
      debugLogs = [...debugLogs, `getLeagueTeamManagers failed: ${err.message}`];
      return null;
    });
    const years = Object.keys(managers?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
    if (years.length > 0) {
      const firstYear   = years[0];
      const allMetadata = get(leagueData) || {};
      const idMatch     = Object.keys(allMetadata).find((k) => allMetadata[k]?.season == firstYear);
      selectedLeagueID  = idMatch || firstYear;
      await loadSeasonData(selectedLeagueID);
    } else {
      debugLogs = [...debugLogs, 'No years found in teamManagersStore.'];
      loading = false;
    }
  });
</script>

<main class="container">
  <h2>League State Validation Panel</h2>

  <!-- ── Season selector ────────────────────────────────────────────────────── -->
  {#if seasons.length > 0}
    <div class="control-row">
      <label for="season-select"><strong>Select target season:</strong></label>
      <select id="season-select" bind:value={selectedLeagueID}
        on:change={() => loadSeasonData(selectedLeagueID)} disabled={loading}>
        {#each seasons as s}<option value={s.id}>{s.year}</option>{/each}
      </select>
    </div>
  {/if}

  {#if loading}
    <div class="status-msg">Crunching matchups...</div>
  {:else}

    <!-- ── Podiums ──────────────────────────────────────────────────────────── -->
    <div class="podium-grid">
      <div class="podium-card gold">
        <h3>🏆 League Champion</h3>
        {#if champTeam}
          <div class="meta-title">{champTeam.name}</div>
          <div class="meta-sub">Manager: {champTeam.managerNames || '—'}</div>
        {:else}<div class="meta-empty">Unresolved — check logs below</div>{/if}
      </div>
      <div class="podium-card poop">
        <h3>💩 Toilet Bowl Loser</h3>
        {#if loserTeam}
          <div class="meta-title">{loserTeam.name}</div>
          <div class="meta-sub">Manager: {loserTeam.managerNames || '—'}</div>
        {:else}<div class="meta-empty">Unresolved — check logs below</div>{/if}
      </div>
    </div>

    <!-- ── Final playoff standings ─────────────────────────────────────────── -->
    {#if placementsTable.length > 0}
      <h3>Final Playoff Standings</h3>
      <table class="data-table">
        <thead><tr><th>Place</th><th>Team</th></tr></thead>
        <tbody>
          {#each placementsTable as team}
            <tr>
              <td>{team.finalPlacement}</td>
              <td>{team.name} <span class="manager-tag">({team.managerNames})</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <!-- ── Season standings ────────────────────────────────────────────────── -->
    <h3>Standings</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Team</th>
          <th colspan="5">Regular Season</th>
          <th colspan="3">Playoffs (Winners Only)</th>
          <th>Streak</th>
        </tr>
        <tr class="subhead">
          <th></th>
          <th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th>
          <th>W</th><th>L</th><th>T</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each standings as team}
          <tr>
            <td>{team.name} <span class="manager-tag">({team.managerNames})</span></td>
            <td>{team.regularSeason.wins}</td>
            <td>{team.regularSeason.losses}</td>
            <td>{team.regularSeason.ties}</td>
            <td>{team.regularSeason.fptsFor.toFixed(2)}</td>
            <td>{team.regularSeason.fptsAgainst.toFixed(2)}</td>
            <td>{team.playoffs.wins}</td>
            <td>{team.playoffs.losses}</td>
            <td>{team.playoffs.ties}</td>
            <td>{team.regularSeason.streak.type ? `${team.regularSeason.streak.type}${team.regularSeason.streak.count}` : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <!-- ── All-time history ────────────────────────────────────────────────── -->
    <h3>All-Time History</h3>
    <div class="control-row">
      <button on:click={loadAllTimeHistory} disabled={loadingAllTime}>
        {loadingAllTime ? 'Loading every season...' : (allTimeHistory ? 'Reload All-Time History' : 'Load All-Time History')}
      </button>
    </div>
    {#if allTimeTotals.length > 0}
      <table class="data-table">
        <thead>
          <tr><th>Manager</th><th>Seasons</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>🏆</th><th>💩</th></tr>
        </thead>
        <tbody>
          {#each allTimeTotals as m}
            <tr>
              <td>{m.displayName}</td>
              <td>{m.seasonsPlayed}</td>
              <td>{m.regularSeason.wins}</td>
              <td>{m.regularSeason.losses}</td>
              <td>{m.regularSeason.ties}</td>
              <td>{m.regularSeason.fptsFor.toFixed(2)}</td>
              <td>{m.championships}</td>
              <td>{m.lastPlaceFinishes}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <!-- ── Rivalry lookup ──────────────────────────────────────────────────── -->
    {#if allTimeHistory}
      <h3>Rivalry Lookup</h3>
      <div class="control-row">
        <select bind:value={rivalryManagerA}>
          <option value="">Team A...</option>
          {#each rivalryOptions as opt}<option value={opt.managerId}>{opt.label}</option>{/each}
        </select>
        <select bind:value={rivalryManagerB}>
          <option value="">Team B...</option>
          {#each rivalryOptions as opt}<option value={opt.managerId}>{opt.label}</option>{/each}
        </select>
        <button on:click={computeRivalry} disabled={!rivalryManagerA || !rivalryManagerB}>Show Rivalry</button>
      </div>

      {#if rivalryResult}
        <div class="podium-card rivalry">
          <p><strong>Record:</strong> {rivalryResult.record.wins}-{rivalryResult.record.losses}-{rivalryResult.record.ties} ({rivalryResult.gamesPlayed} games)</p>
          <p><strong>Points:</strong> {rivalryResult.record.pointsFor.toFixed(2)} – {rivalryResult.record.pointsAgainst.toFixed(2)}</p>
          <p><strong>Streak:</strong> {rivalryResult.streak.type ? `${rivalryResult.streak.type}${rivalryResult.streak.count}` : '—'}</p>
          {#if rivalryResult.biggestBlowout}
            <p><strong>Biggest margin:</strong> {rivalryResult.biggestBlowout.year} Wk {rivalryResult.biggestBlowout.week} ({rivalryResult.biggestBlowout.margin.toFixed(2)} pts)</p>
          {/if}
          {#if rivalryResult.closestGame}
            <p><strong>Closest game:</strong> {rivalryResult.closestGame.year} Wk {rivalryResult.closestGame.week} ({rivalryResult.closestGame.margin.toFixed(2)} pts)</p>
          {/if}
        </div>

        {#if rivalryTradeHistory.length > 0}
          <h4>Trade History Between These Managers</h4>
          {#each rivalryTradeHistory as trade}
            {@const g = trade.grade}
            <div class="trade-card">
              <div class="trade-header">
                <span class="trade-date">{trade.date} — Season {trade.seasonKey || trade.season}</span>
                {#if trade.isComposite}
                  <span class="composite-badge">🔀 {trade.teams?.length}-Team Trade</span>
                {/if}
                {#if g && !trade.isComposite}
                  <span class="trade-grade-badge grade-{g.narrative?.grade}">
                    {tradeGradeEmoji(g.narrative?.grade)} {g.narrative?.grade?.toUpperCase()}
                  </span>
                {/if}
                {#if g?.hasDraftPicks}
                  <span class="draft-pick-badge">📋 Includes Draft Picks</span>
                {/if}
              </div>

              {#if !trade.isComposite && g?.narrative?.summary}
                <p class="trade-narrative">{g.narrative.summary}</p>
              {/if}

              {#if !trade.isComposite && g}
                <div class="trade-sides">
                  {#each trade.rosters as roster, idx}
                    {@const side = idx === 0 ? g.side0 : g.side1}
                    {@const isWinner = g.winner === idx}
                    <div class="trade-side {isWinner ? 'winner' : ''}">
                      <div class="side-manager">{isWinner ? '🏆 ' : ''}{managerDisplayName(trade.managerIds?.[idx])} received:</div>
                      <div class="side-totals">PAR: <strong>{fp(side?.parTotal)}</strong> | Raw: {fp(side?.rawTotal)}</div>
                      {#each (side?.players || []) as p}
                        <div class="player-row">
                          <span class="player-pos-tag">{p.position}</span>
                          <span class="player-name">{p.name}</span>
                          <span class="player-stat-detail">
                            {fp(p.par)} PAR | {fp(p.totalPts)} total / {fp(p.startedPts)} started |
                            {p.weeksStarted}/{p.weeks} wks
                            {#if p.baselineSource === 'personal'}<span class="baseline-tag">roster-adjusted</span>{/if}
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>

              {:else if trade.isComposite && g}
                <!-- Composite trade breakdown -->
                <div class="composite-teams">
                  {#each g.teamGrades as teamGrade}
                    {@const isWinner = g.winnerRoster === teamGrade.roster}
                    <div class="trade-side {isWinner ? 'winner' : ''}">
                      <div class="side-manager">{isWinner ? '🏆 ' : ''}{managerDisplayName(teamGrade.managerId)} received (net):</div>
                      <div class="side-totals">PAR: <strong>{fp(teamGrade.parTotal)}</strong> | Raw: {fp(teamGrade.rawTotal)}</div>
                      {#each (teamGrade.players || []) as p}
                        <div class="player-row">
                          <span class="player-pos-tag">{p.position}</span>
                          <span class="player-name">{p.name}</span>
                          <span class="player-stat-detail">
                            {fp(p.par)} PAR | {fp(p.totalPts)} total / {fp(p.startedPts)} started |
                            {p.weeksStarted}/{p.weeks} wks
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {:else if transactionHistory}
          <p class="meta-empty">No trades found between these two managers.</p>
        {:else}
          <p class="meta-empty">Load transaction history to see trades.</p>
        {/if}
      {:else if rivalryManagerA && rivalryManagerB}
        <div class="meta-empty">Click "Show Rivalry" to compute.</div>
      {/if}

      {#if allTimeDebug.length > 0}
        <div class="debug-terminal">
          <h4>All-Time Debug Logs</h4>
          <ul>{#each allTimeDebug as log}<li><code>{log}</code></li>{/each}</ul>
        </div>
      {/if}
    {/if}

    <!-- ── Transaction history ─────────────────────────────────────────────── -->
    <h3>Transaction History</h3>
    <div class="control-row">
      <button on:click={loadTransactionHistory} disabled={loadingTransactions}>
        {loadingTransactions ? 'Loading transactions...' : (transactionHistory ? 'Reload Transactions' : 'Load Transaction History')}
      </button>
    </div>

    {#if loadingTransactions}
      <div class="status-msg">Fetching and grading with PAR...</div>
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

      <h4>Season Transaction Totals</h4>
      <div class="control-row">
        <select bind:value={selectedTransactionSeason}
          on:change={() => {
            const snap = get(teamManagersStore) || {};
            seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, snap);
          }}>
          {#each Object.keys(transactionHistory.totals.seasons || {}).sort((a,b)=>Number(b)-Number(a)) as yr}
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

      <h4>All Transactions (PAR Graded)</h4>
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

          <!-- Summary row -->
          <div class="tx-summary" on:click={() => toggleTx(tx.id)} role="button" tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && toggleTx(tx.id)}>
            <div class="tx-meta">
              {#if tx.isComposite}
                <span class="tx-type-badge composite">🔀 {tx.teams?.length}-Team Trade</span>
              {:else}
                <span class="tx-type-badge {tx.type}">{tx.type}</span>
              {/if}
              <span class="tx-date">{tx.date}</span>
              <span class="tx-season">S{tx.seasonKey || tx.season} Wk{tx.leg}</span>
              {#if g?.hasDraftPicks}
                <span class="draft-pick-badge">📋 Picks</span>
              {/if}
            </div>
            <div class="tx-managers">
              {#if tx.isComposite}
                {(tx.teams || []).map((t) => managerDisplayName(t.managerId)).join(' → ')}
              {:else if tx.managerIds?.length}
                {tx.managerIds.map((id) => managerDisplayName(id)).join(' ↔ ')}
              {:else}—{/if}
            </div>

            {#if tx.isComposite && g}
              <div class="tx-grade">
                <span class="par-summary">
                  {(g.ranked || []).map((t) => `${managerDisplayName(t.managerId)}: ${fp(t.parTotal)}`).join(' | ')} PAR
                </span>
              </div>
            {:else if tx.type === 'trade' && g}
              <div class="tx-grade">
                <span class="trade-grade-badge grade-{g.narrative?.grade}">
                  {tradeGradeEmoji(g.narrative?.grade)} {g.narrative?.grade}
                </span>
                <span class="par-summary">
                  {managerDisplayName(tx.managerIds?.[0])}: {fp(g.side0?.parTotal)} |
                  {managerDisplayName(tx.managerIds?.[1])}: {fp(g.side1?.parTotal)} PAR
                </span>
              </div>
            {:else if tx.type === 'waiver' && g}
              <div class="tx-grade">
                <span class="waiver-grade-badge grade-{g.gradeLabel}">{gradeEmoji(g.gradeLabel)} {g.gradeLabel}</span>
                <span class="par-summary">{g.name} ({g.position}) — {fp(g.par)} PAR</span>
              </div>
            {/if}

            <span class="expand-toggle">{isExpanded ? '▲' : '▼'}</span>
          </div>

          <!-- Detail panel -->
          {#if isExpanded}
            <div class="tx-detail">
              {#if tx.isComposite && g}
                <!-- Composite trade detail -->
                <p class="narrative-text">
                  Multi-team trade involving {tx.teams?.length} managers.
                  {#if g.hasDraftPicks}Grade reflects player value only — draft picks excluded.{/if}
                </p>
                <div class="composite-teams">
                  {#each g.teamGrades as teamGrade}
                    {@const isWinner = g.winnerRoster === teamGrade.roster}
                    <div class="trade-side {isWinner ? 'winner' : ''}">
                      <div class="side-manager">{isWinner ? '🏆 ' : ''}{managerDisplayName(teamGrade.managerId)} received (net):</div>
                      <div class="side-totals">PAR: <strong>{fp(teamGrade.parTotal)}</strong> | Raw: {fp(teamGrade.rawTotal)} / {fp(teamGrade.rawStarted)} started</div>
                      {#each (teamGrade.players || []) as p}
                        <div class="player-row">
                          <span class="player-pos-tag">{p.position}</span>
                          <span class="player-name">{p.name}</span>
                          <span class="player-stat-detail">
                            {fp(p.par)} PAR | {fp(p.totalPts)} total / {fp(p.startedPts)} started |
                            {p.weeksStarted}/{p.weeks} wks | rep: {fp(p.baselineValue)}
                            {#if p.baselineSource === 'personal'}<span class="baseline-tag">roster-adj</span>{/if}
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>
                <!-- Show constituent trades for transparency -->
                <div class="constituent-note">
                  Constituent trade IDs: {tx.constituentTradeIds?.join(', ')}
                </div>

              {:else if tx.type === 'trade' && g}
                <p class="narrative-text">{g.narrative?.summary}</p>
                <div class="trade-sides">
                  {#each tx.rosters as roster, idx}
                    {@const side = idx === 0 ? g.side0 : g.side1}
                    {@const isWinner = g.winner === idx}
                    <div class="trade-side {isWinner ? 'winner' : ''}">
                      <div class="side-manager">{isWinner ? '🏆 ' : ''}{managerDisplayName(tx.managerIds?.[idx])} received:</div>
                      <div class="side-totals">
                        PAR: <strong>{fp(side?.parTotal)}</strong> |
                        Raw: {fp(side?.rawTotal)} total / {fp(side?.rawStarted)} started
                      </div>
                      {#each (side?.players || []) as p}
                        <div class="player-row">
                          <span class="player-pos-tag">{p.position}</span>
                          <span class="player-name">{p.name}</span>
                          <span class="player-stat-detail">
                            {fp(p.par)} PAR | {fp(p.totalPts)} total / {fp(p.startedPts)} started |
                            {p.weeksStarted}/{p.weeks} wks | baseline: {fp(p.baselineValue)}
                            {#if p.baselineSource === 'personal'}<span class="baseline-tag">roster-adjusted</span>{/if}
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/each}
                </div>
                {#if g.narrative?.flags?.length > 0}
                  <div class="flags">
                    {#each g.narrative.flags as flag}
                      <span class="flag flag-{flag.type}">
                        {flag.type === 'injury-suspected' ? '🚑 Injury suspected' : '📋 Underutilized'}: {flag.name}
                      </span>
                    {/each}
                  </div>
                {/if}

              {:else if tx.type === 'waiver' && g}
                <p class="narrative-text">{g.gradeSummary}</p>
                <div class="waiver-detail">
                  <div class="player-row">
                    <span class="player-pos-tag">{g.position}</span>
                    <span class="player-name">Added: {g.name}</span>
                    <span class="player-stat-detail">
                      {fp(g.par)} PAR | {fp(g.totalPts)} total / {fp(g.startedPts)} started |
                      {g.weeksStarted}/{g.weeks} wks | baseline: {fp(g.baselineValue)}
                      {#if g.baselineSource === 'personal'}<span class="baseline-tag">roster-adjusted</span>{/if}
                    </span>
                  </div>
                  {#if g.droppedName}
                    <div class="player-row dropped">
                      <span class="player-pos-tag">—</span>
                      <span class="player-name">Dropped: {g.droppedName}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      <div class="control-row" style="margin-top:1rem;">
        <button on:click={() => (showTransactionDebug = !showTransactionDebug)}>
          {showTransactionDebug ? 'Hide' : 'Show'} Transaction Debug Logs
        </button>
      </div>
      {#if showTransactionDebug && transactionDebug.length > 0}
        <div class="debug-terminal">
          <h4>Transaction Debug Logs</h4>
          <ul>{#each transactionDebug as log}<li><code>{log}</code></li>{/each}</ul>
        </div>
      {/if}
    {/if}

    <!-- ── Weekly results ──────────────────────────────────────────────────── -->
    <h3>Weekly Results</h3>
    <div class="control-row">
      <select bind:value={weekFilter}>
        <option value="all">All Weeks</option>
        <option value="regular">Regular Season Only</option>
        <option value="playoffs">All Playoffs</option>
        <option value="winners">Playoffs — Winners Bracket</option>
        <option value="losers">Playoffs — Losers Bracket</option>
      </select>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>Week</th><th>Team</th><th>Opponent</th><th>PF</th><th>PA</th><th>Result</th><th>Bracket</th></tr>
      </thead>
      <tbody>
        {#each filteredWeeklyResults as row}
          <tr>
            <td>{row.week}</td>
            <td>{nameForRoster(row.rosterId)}</td>
            <td>{nameForRoster(row.opponentRosterId)}</td>
            <td>{row.pointsFor.toFixed(2)}</td>
            <td>{row.pointsAgainst.toFixed(2)}</td>
            <td>{row.result}</td>
            <td>{row.bracket || (row.isPlayoffs ? 'unknown' : '—')}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="control-row">
      <button on:click={() => (showRawStandings = !showRawStandings)}>{showRawStandings ? 'Hide' : 'Show'} Raw Standings JSON</button>
      <button on:click={() => (showRawBrackets  = !showRawBrackets) }>{showRawBrackets  ? 'Hide' : 'Show'} Raw Bracket JSON</button>
    </div>
    {#if showRawStandings}<pre class="raw-json">{JSON.stringify(standings, null, 2)}</pre>{/if}
    {#if showRawBrackets}<pre class="raw-json">{JSON.stringify({ winnersBracket: rawWinnersBracket, losersBracket: rawLosersBracket }, null, 2)}</pre>{/if}

    {#if debugLogs.length > 0}
      <div class="debug-terminal">
        <h4>System Trace Logs</h4>
        <ul>{#each debugLogs as log}<li><code>{log}</code></li>{/each}</ul>
      </div>
    {/if}
  {/if}
</main>

<style>
  .container { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  .control-row { margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  select, button { padding: 0.5rem 1rem; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .manager-tag { font-size: 0.8em; color: #888; }
  .podium-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
  .podium-card { padding: 1.5rem; border-radius: 8px; border-left: 6px solid #ccc; background: #fcfcfc; box-shadow: 0 2px 4px rgba(0,0,0,.05); margin-bottom: 1.5rem; }
  .podium-card.gold    { border-left-color: #ffd700; background: #fffdf3; }
  .podium-card.poop    { border-left-color: #8b5a2b; background: #fbf7f3; }
  .podium-card.rivalry { border-left-color: #4a90d9; background: #f3f8fd; }
  .podium-card p { margin: 0.3rem 0; }
  .meta-title { font-size: 1.4rem; font-weight: 700; color: #222; }
  .meta-sub   { font-size: 0.95rem; color: #666; margin-top: 0.25rem; }
  .meta-empty { color: #999; font-style: italic; margin-bottom: 1rem; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.9rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: center; }
  .data-table th { background: #f5f5f5; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .subhead th { background: #ececec; font-weight: 600; }

  /* Trade cards (rivalry section) */
  .trade-card { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
  .trade-header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; padding: 0.75rem 1rem; background: #f9f9f9; border-bottom: 1px solid #eee; }
  .trade-date { font-size: 0.85em; color: #666; }
  .trade-narrative { margin: 0.5rem 1rem; font-style: italic; color: #444; font-size: 0.9em; }
  .trade-sides, .composite-teams { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1rem; }
  .trade-side { padding: 0.75rem; border-radius: 6px; background: #f5f5f5; border: 2px solid transparent; }
  .trade-side.winner { background: #f0fff4; border-color: #34d399; }
  .side-manager { font-weight: 700; margin-bottom: 0.35rem; }
  .side-totals  { font-size: 0.85em; color: #555; margin-bottom: 0.5rem; }

  /* Transaction cards */
  .tx-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden; }
  .tx-card.trade   { border-left: 4px solid #2563eb; }
  .tx-card.waiver  { border-left: 4px solid #16a34a; }
  .tx-card.composite { border-left: 4px solid #7c3aed; }
  .tx-summary { padding: 0.75rem 1rem; cursor: pointer; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; background: #fafafa; }
  .tx-summary:hover { background: #f0f0f0; }
  .tx-meta    { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .tx-managers { font-size: 0.9em; color: #444; flex: 1; }
  .tx-grade   { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .par-summary { font-size: 0.85em; color: #555; }
  .expand-toggle { margin-left: auto; color: #888; font-size: 0.8em; }
  .tx-detail  { padding: 0.75rem 1rem 1rem; border-top: 1px solid #eee; }
  .narrative-text { font-style: italic; color: #444; margin: 0 0 0.75rem; font-size: 0.9em; }

  .tx-type-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75em; font-weight: 700; text-transform: uppercase; }
  .tx-type-badge.trade     { background: #dbeafe; color: #1d4ed8; }
  .tx-type-badge.waiver    { background: #dcfce7; color: #15803d; }
  .tx-type-badge.composite { background: #ede9fe; color: #6d28d9; }
  .tx-date, .tx-season { font-size: 0.82em; color: #666; }
  .composite-badge { background: #ede9fe; color: #6d28d9; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8em; font-weight: 700; }
  .draft-pick-badge { background: #fef3c7; color: #92400e; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75em; }

  .trade-grade-badge, .waiver-grade-badge { padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8em; font-weight: 700; text-transform: capitalize; }
  .grade-lopsided { background: #fef2f2; color: #dc2626; }
  .grade-clear    { background: #f0fdf4; color: #16a34a; }
  .grade-close    { background: #fffbeb; color: #d97706; }
  .grade-even     { background: #f3f4f6; color: #6b7280; }
  .grade-elite    { background: #fef3c7; color: #92400e; }
  .grade-strong   { background: #d1fae5; color: #065f46; }
  .grade-solid    { background: #e0f2fe; color: #0369a1; }
  .grade-neutral  { background: #f3f4f6; color: #6b7280; }
  .grade-poor     { background: #fef2f2; color: #dc2626; }

  .player-row { display: flex; gap: 0.4rem; align-items: baseline; font-size: 0.85em; margin-top: 0.3rem; flex-wrap: wrap; }
  .player-row.dropped { opacity: 0.5; }
  .player-pos-tag { background: #e5e7eb; border-radius: 3px; padding: 0 0.3rem; font-size: 0.75em; font-weight: 700; flex-shrink: 0; }
  .player-name { font-weight: 600; }
  .player-stat-detail { color: #666; font-size: 0.85em; }
  .baseline-tag { background: #ddd6fe; color: #5b21b6; padding: 0 0.3rem; border-radius: 3px; font-size: 0.75em; margin-left: 0.25rem; }

  .waiver-detail { margin-top: 0.5rem; }
  .flags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
  .flag { padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8em; }
  .flag-injury-suspected { background: #fff7ed; color: #c2410c; }
  .flag-underutilized    { background: #faf5ff; color: #7e22ce; }
  .constituent-note { font-size: 0.75em; color: #aaa; margin-top: 0.5rem; padding: 0 0.25rem; }

  .raw-json { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; margin-bottom: 1rem; max-height: 400px; }
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; margin-top: 1rem; margin-bottom: 2rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem 0; color: #fff; }
  .debug-terminal ul  { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li  { margin-bottom: 0.25rem; }
</style>
