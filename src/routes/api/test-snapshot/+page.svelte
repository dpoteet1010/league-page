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
  import { gradeTradeWinner, gradeWaiverPickup } from '$lib/utils/dataEngine/transactionGrading.js';
  import { teamManagersStore, leagueData } from '$lib/stores';

  // ── Season selector ──────────────────────────────────────────────────────────
  let selectedLeagueID = '';
  let loading = false;
  let debugLogs = [];

  // ── Season view state ────────────────────────────────────────────────────────
  let standings = [];
  let weeklyResults = [];
  let podiums = { championId: null, lastPlaceId: null };
  let rawWinnersBracket = [];
  let rawLosersBracket = [];
  let currentManagersForYear = {};

  let showRawStandings = false;
  let showRawBrackets = false;
  let weekFilter = 'all'; // 'all' | 'regular' | 'playoffs' | 'winners' | 'losers'

  // ── All-time / rivalry state ─────────────────────────────────────────────────
  let allTimeHistory = null;
  let loadingAllTime = false;
  let allTimeDebug = [];
  let allTimeTotals = [];
  let rivalryManagerA = '';
  let rivalryManagerB = '';
  let rivalryResult = null;

  // ── Transaction state ────────────────────────────────────────────────────────
  let transactionHistory = null;
  let loadingTransactions = false;
  let transactionDebug = [];
  let gradedTransactions = [];
  let allTimeTransactionTotals = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals = [];
  let rivalryTradeHistory = [];
  let txFilter = 'all'; // 'all' | 'trade' | 'waiver'
  let showTransactionDebug = false;

  // ── Reactive: season picker ──────────────────────────────────────────────────
  $: seasons = Object.keys($teamManagersStore?.teamManagersMap || {})
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => {
      const matchedLeagueID = Object.keys($leagueData || {}).find((key) => $leagueData[key]?.season == year);
      return { year, id: matchedLeagueID || year };
    });

  $: champTeam = podiums.championId != null ? standings.find((s) => s.rosterId === Number(podiums.championId)) : null;
  $: loserTeam = podiums.lastPlaceId != null ? standings.find((s) => s.rosterId === Number(podiums.lastPlaceId)) : null;
  $: placementsTable = standings.filter((s) => s.finalPlacement != null).sort((a, b) => a.finalPlacement - b.finalPlacement);

  $: rivalryOptions = standings
    .map((team) => {
      const managerId = currentManagersForYear[team.rosterId]?.managerId;
      return managerId != null ? { managerId, label: team.name } : null;
    })
    .filter(Boolean);

  $: filteredWeeklyResults = weeklyResults.filter((r) => {
    if (weekFilter === 'regular') return !r.isPlayoffs;
    if (weekFilter === 'playoffs') return r.isPlayoffs;
    if (weekFilter === 'winners') return r.bracket === 'winners';
    if (weekFilter === 'losers') return r.bracket === 'losers';
    return true;
  });

  $: filteredTransactions = gradedTransactions.filter((tx) => {
    if (txFilter === 'trade') return tx.type === 'trade';
    if (txFilter === 'waiver') return tx.type === 'waiver';
    return true;
  });

  // Recompute season transaction totals whenever the season filter changes
  $: if (transactionHistory && selectedTransactionSeason) {
    const managersSnapshot = get(teamManagersStore) || {};
    seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, managersSnapshot);
  }

  // Recompute rivalry trade history whenever rivalry or transaction data changes
  $: if (rivalryResult && transactionHistory && rivalryManagerA && rivalryManagerB) {
    rivalryTradeHistory = getTradeHistory(transactionHistory.transactions, rivalryManagerA, rivalryManagerB);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
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
        name: teamInfo?.team?.name || `Team ${rosterId}`,
        avatar: teamInfo?.team?.avatar || '',
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
    const managersSnapshot = get(teamManagersStore) || {};
    return managersSnapshot?.users?.[managerId]?.display_name || `Manager ${managerId}`;
  }

  function formatPoints(pts) {
    return typeof pts === 'number' ? pts.toFixed(2) : '—';
  }

  // ── Season loader ────────────────────────────────────────────────────────────
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
        getSpecificYearMatchups(leagueId).catch((err) => {
          debugLogs.push(`getSpecificYearMatchups failed: ${err.message}`);
          return null;
        }),
        getLeagueData(leagueId).catch((err) => {
          debugLogs.push(`getLeagueData note: ${err.message}`);
          return null;
        })
      ]);

      debugLogs.push(`matchupWeeks count: ${matchupsData?.matchupWeeks?.length ?? 'N/A'}`);
      debugLogs.push(...(matchupsData?.debug || []));

      const managersSnapshot = get(teamManagersStore) || {};
      const allMetadata = get(leagueData) || {};
      const year = resolveYear(leagueId, allMetadata);
      debugLogs.push(`Resolved year for manager lookup: ${year}`);

      const managersForYear = buildManagersForYear(managersSnapshot, year);
      currentManagersForYear = managersForYear;
      const numRosters = Object.keys(managersForYear).length;
      debugLogs.push(`Managers resolved for ${year}: ${numRosters}`);

      if (!matchupsData) {
        debugLogs.push('No matchupsData returned — cannot run getLeagueState.');
        return;
      }

      const playoffData = await getLeaguePlayoffs(leagueId);
      rawWinnersBracket = playoffData.winnersBracket;
      rawLosersBracket = playoffData.losersBracket;
      debugLogs.push(...playoffData.debug);

      const result = getLeagueState(matchupsData, managersForYear, allMetadata?.[leagueId] || null, {
        winnersBracket: playoffData.winnersBracket,
        losersBracket: playoffData.losersBracket,
        numRosters
      });

      standings = result.standings;
      weeklyResults = result.weeklyResults;
      podiums = result.podiums;
      debugLogs.push(...result.debug);
    } catch (e) {
      console.error('Critical error building league state:', e);
      debugLogs.push(`Catch block crash: ${e.message}`);
    } finally {
      loading = false;
    }
  }

  // ── All-time history loader ──────────────────────────────────────────────────
  async function loadAllTimeHistory() {
    loadingAllTime = true;
    allTimeDebug = [];
    try {
      allTimeHistory = await getAllSeasonsHistory();
      allTimeDebug = allTimeHistory.debug;
      allTimeTotals = getAllTimeTotals(allTimeHistory.managers);
    } catch (e) {
      allTimeDebug = [`Critical error: ${e.message}`];
    } finally {
      loadingAllTime = false;
    }
  }

  // ── Transaction loader ───────────────────────────────────────────────────────
  async function loadTransactionHistory() {
    loadingTransactions = true;
    transactionDebug = [];
    gradedTransactions = [];
    allTimeTransactionTotals = [];
    seasonTransactionTotals = [];

    try {
      // Need player results for grading — load all-time history first if not yet done
      if (!allTimeHistory) {
        transactionDebug.push('Loading all-time history for player results (needed for grading)...');
        allTimeHistory = await getAllSeasonsHistory();
        allTimeTotals = getAllTimeTotals(allTimeHistory.managers);
        transactionDebug.push(`All-time history loaded: ${allTimeHistory.playerResults?.length ?? 0} player-week rows.`);
      }

      const txResult = await getTransactionHistory();
      transactionHistory = txResult;
      transactionDebug.push(...txResult.debug);

      const managersSnapshot = get(teamManagersStore) || {};

      // Grade every transaction using the player results we already have
      const playerResults = allTimeHistory.playerResults || [];
      gradedTransactions = txResult.transactions.map((tx) => {
        if (tx.type === 'trade') {
          return { ...tx, grade: gradeTradeWinner(tx, playerResults) };
        } else if (tx.type === 'waiver') {
          return { ...tx, grade: gradeWaiverPickup(tx, playerResults) };
        }
        return tx;
      });

      allTimeTransactionTotals = getAllTimeTransactionTotals(txResult.totals, managersSnapshot);

      // Default season filter to the most recent season we have
      const availableSeasons = Object.keys(txResult.totals.seasons || {}).sort((a, b) => Number(b) - Number(a));
      if (availableSeasons.length > 0) {
        selectedTransactionSeason = availableSeasons[0];
        seasonTransactionTotals = getSeasonTransactionTotals(txResult.totals, selectedTransactionSeason, managersSnapshot);
      }

      transactionDebug.push(`Graded ${gradedTransactions.length} transactions.`);
    } catch (e) {
      console.error('Critical error loading transactions:', e);
      transactionDebug.push(`Catch block crash: ${e.message}`);
    } finally {
      loadingTransactions = false;
    }
  }

  // ── Rivalry ──────────────────────────────────────────────────────────────────
  function computeRivalry() {
    if (!allTimeHistory || !rivalryManagerA || !rivalryManagerB) return;
    rivalryResult = getRivalry(allTimeHistory.weeklyResults, rivalryManagerA, rivalryManagerB);
    if (transactionHistory) {
      rivalryTradeHistory = getTradeHistory(transactionHistory.transactions, rivalryManagerA, rivalryManagerB);
    }
  }

  // ── Mount ────────────────────────────────────────────────────────────────────
  onMount(async () => {
    loading = true;
    const managers = await getLeagueTeamManagers().catch((err) => {
      debugLogs = [...debugLogs, `getLeagueTeamManagers failed: ${err.message}`];
      return null;
    });

    const years = Object.keys(managers?.teamManagersMap || {}).sort((a, b) => Number(b) - Number(a));
    if (years.length > 0) {
      const firstYear = years[0];
      const allMetadata = get(leagueData) || {};
      const idMatch = Object.keys(allMetadata).find((key) => allMetadata[key]?.season == firstYear);
      selectedLeagueID = idMatch || firstYear;
      await loadSeasonData(selectedLeagueID);
    } else {
      debugLogs = [...debugLogs, 'getLeagueTeamManagers returned no years — teamManagersMap is empty.'];
      loading = false;
    }
  });
</script>

<main class="container">
  <h2>League State Validation Panel</h2>

  <!-- ── Season selector ──────────────────────────────────────────────────── -->
  {#if seasons.length > 0}
    <div class="control-row">
      <label for="season-select"><strong>Select target season:</strong></label>
      <select id="season-select" bind:value={selectedLeagueID} on:change={() => loadSeasonData(selectedLeagueID)} disabled={loading}>
        {#each seasons as season}
          <option value={season.id}>{season.year}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if loading}
    <div class="status-msg">Crunching matchups...</div>
  {:else}

    <!-- ── Podiums ─────────────────────────────────────────────────────────── -->
    <div class="podium-grid">
      <div class="podium-card gold">
        <h3>🏆 League Champion</h3>
        {#if champTeam}
          <div class="meta-title">{champTeam.name}</div>
          <div class="meta-sub">Manager: {champTeam.managerNames || '—'}</div>
        {:else}
          <div class="meta-empty">Unresolved — check logs / raw bracket JSON below</div>
        {/if}
      </div>
      <div class="podium-card poop">
        <h3>💩 Toilet Bowl Loser</h3>
        {#if loserTeam}
          <div class="meta-title">{loserTeam.name}</div>
          <div class="meta-sub">Manager: {loserTeam.managerNames || '—'}</div>
        {:else}
          <div class="meta-empty">Unresolved — check logs / raw bracket JSON below</div>
        {/if}
      </div>
    </div>

    <!-- ── Final playoff standings ────────────────────────────────────────── -->
    {#if placementsTable.length > 0}
      <h3>Final Playoff Standings (Winners + Losers Bracket)</h3>
      <table class="data-table">
        <thead>
          <tr><th>Place</th><th>Team</th></tr>
        </thead>
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

    <!-- ── Season standings ───────────────────────────────────────────────── -->
    <h3>Standings</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Team</th>
          <th colspan="5">Regular Season</th>
          <th colspan="3">Playoffs (Winners Bracket Only)</th>
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

    <!-- ── All-time history ───────────────────────────────────────────────── -->
    <h3>All-Time History</h3>
    <div class="control-row">
      <button on:click={loadAllTimeHistory} disabled={loadingAllTime}>
        {loadingAllTime ? 'Loading every season...' : (allTimeHistory ? 'Reload All-Time History' : 'Load All-Time History')}
      </button>
    </div>

    {#if allTimeTotals.length > 0}
      <table class="data-table">
        <thead>
          <tr><th>Manager</th><th>Seasons</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>Championships</th><th>Last Place</th></tr>
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

    <!-- ── Rivalry lookup ─────────────────────────────────────────────────── -->
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
          <p><strong>All-time record:</strong> {rivalryResult.record.wins}-{rivalryResult.record.losses}-{rivalryResult.record.ties} ({rivalryResult.gamesPlayed} games)</p>
          <p><strong>Points:</strong> {rivalryResult.record.pointsFor.toFixed(2)} – {rivalryResult.record.pointsAgainst.toFixed(2)}</p>
          <p><strong>Current streak:</strong> {rivalryResult.streak.type ? `${rivalryResult.streak.type}${rivalryResult.streak.count}` : '—'}</p>
          {#if rivalryResult.biggestBlowout}
            <p><strong>Biggest margin:</strong> {rivalryResult.biggestBlowout.year} Week {rivalryResult.biggestBlowout.week} ({rivalryResult.biggestBlowout.margin.toFixed(2)} pts)</p>
          {/if}
          {#if rivalryResult.closestGame}
            <p><strong>Closest game:</strong> {rivalryResult.closestGame.year} Week {rivalryResult.closestGame.week} ({rivalryResult.closestGame.margin.toFixed(2)} pts)</p>
          {/if}
        </div>

        <!-- Trade history between these two managers -->
        {#if rivalryTradeHistory.length > 0}
          <h4>Trade History Between These Managers</h4>
          <table class="data-table">
            <thead>
              <tr><th>Date</th><th>Season</th><th>Winner (Total Pts)</th><th>Loser (Total Pts)</th><th>Decided By</th></tr>
            </thead>
            <tbody>
              {#each rivalryTradeHistory as trade}
                {@const grade = trade.grade}
                {@const winnerIdx = grade?.winner}
                {@const side0Manager = managerDisplayName(trade.managerIds?.[0])}
                {@const side1Manager = managerDisplayName(trade.managerIds?.[1])}
                <tr>
                  <td>{trade.date}</td>
                  <td>{trade.seasonKey || trade.season}</td>
                  <td>
                    {#if grade && winnerIdx === 0}
                      <strong>{side0Manager}</strong> ({formatPoints(grade.side0?.totalPts)} pts)
                    {:else if grade && winnerIdx === 1}
                      <strong>{side1Manager}</strong> ({formatPoints(grade.side1?.totalPts)} pts)
                    {:else}
                      Too close to call
                    {/if}
                  </td>
                  <td>
                    {#if grade && winnerIdx === 0}
                      {side1Manager} ({formatPoints(grade.side1?.totalPts)} pts)
                    {:else if grade && winnerIdx === 1}
                      {side0Manager} ({formatPoints(grade.side0?.totalPts)} pts)
                    {:else}
                      —
                    {/if}
                  </td>
                  <td>{grade ? `${formatPoints(Math.abs((grade.side0?.totalPts || 0) - (grade.side1?.totalPts || 0)))} pts difference` : 'Not graded'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if transactionHistory}
          <p class="meta-empty">No trades found between these two managers.</p>
        {:else}
          <p class="meta-empty">Load transaction history to see trades between these managers.</p>
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

    <!-- ── Transaction history ────────────────────────────────────────────── -->
    <h3>Transaction History</h3>
    <div class="control-row">
      <button on:click={loadTransactionHistory} disabled={loadingTransactions}>
        {loadingTransactions ? 'Loading transactions...' : (transactionHistory ? 'Reload Transactions' : 'Load Transaction History')}
      </button>
    </div>

    {#if loadingTransactions}
      <div class="status-msg">Fetching transactions and grading trades/waivers...</div>
    {:else if transactionHistory}

      <!-- All-time transaction counts -->
      <h4>All-Time Transaction Totals</h4>
      <table class="data-table">
        <thead>
          <tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr>
        </thead>
        <tbody>
          {#each allTimeTransactionTotals as m}
            <tr>
              <td>{m.displayName}</td>
              <td>{m.trades}</td>
              <td>{m.waivers}</td>
              <td>{m.total}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- Per-season transaction counts -->
      <h4>Season Transaction Totals</h4>
      <div class="control-row">
        <label for="tx-season-select">Season:</label>
        <select id="tx-season-select" bind:value={selectedTransactionSeason}
          on:change={() => {
            const managersSnapshot = get(teamManagersStore) || {};
            seasonTransactionTotals = getSeasonTransactionTotals(transactionHistory.totals, selectedTransactionSeason, managersSnapshot);
          }}>
          {#each Object.keys(transactionHistory.totals.seasons || {}).sort((a,b) => Number(b)-Number(a)) as yr}
            <option value={yr}>{yr}</option>
          {/each}
        </select>
      </div>
      {#if seasonTransactionTotals.length > 0}
        <table class="data-table">
          <thead>
            <tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr>
          </thead>
          <tbody>
            {#each seasonTransactionTotals as m}
              <tr>
                <td>{m.displayName}</td>
                <td>{m.trades}</td>
                <td>{m.waivers}</td>
                <td>{m.total}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <!-- Full graded transaction list -->
      <h4>All Transactions (Graded)</h4>
      <div class="control-row">
        <label for="tx-filter">Filter:</label>
        <select id="tx-filter" bind:value={txFilter}>
          <option value="all">All</option>
          <option value="trade">Trades Only</option>
          <option value="waiver">Waivers Only</option>
        </select>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Season</th>
            <th>Type</th>
            <th>Managers</th>
            <th>Total Pts (Primary)</th>
            <th>Started Pts</th>
            <th>Winner / Grade</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredTransactions as tx}
            {@const grade = tx.grade}
            <tr>
              <td>{tx.date}</td>
              <td>{tx.seasonKey || tx.season}</td>
              <td class="tx-type {tx.type}">{tx.type}</td>
              <td>
                {#if tx.managerIds?.length}
                  {tx.managerIds.map(id => managerDisplayName(id)).join(' ↔ ')}
                {:else}
                  —
                {/if}
              </td>
              <td>
                {#if tx.type === 'trade' && grade}
                  {formatPoints(grade.side0?.totalPts)} vs {formatPoints(grade.side1?.totalPts)}
                {:else if tx.type === 'waiver' && grade}
                  {formatPoints(grade.totalPts)}
                {:else}
                  —
                {/if}
              </td>
              <td>
                {#if tx.type === 'trade' && grade}
                  {formatPoints(grade.side0?.startedPts)} vs {formatPoints(grade.side1?.startedPts)}
                {:else if tx.type === 'waiver' && grade}
                  {formatPoints(grade.startedPts)} ({grade.games} games started)
                {:else}
                  —
                {/if}
              </td>
              <td>
                {#if tx.type === 'trade' && grade}
                  {#if grade.winner === 0}
                    🏆 {managerDisplayName(tx.managerIds?.[0])}
                  {:else if grade.winner === 1}
                    🏆 {managerDisplayName(tx.managerIds?.[1])}
                  {:else}
                    Even
                  {/if}
                {:else if tx.type === 'waiver' && grade}
                  {#if grade.totalPts > 50}
                    ✅ Strong pickup
                  {:else if grade.totalPts > 15}
                    👍 Solid pickup
                  {:else if grade.totalPts > 0}
                    ➖ Minimal value
                  {:else}
                    ❌ No contribution
                  {/if}
                {:else}
                  —
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- Transaction debug toggle -->
      <div class="control-row">
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

    <!-- ── Weekly results ─────────────────────────────────────────────────── -->
    <h3>Weekly Results (raw engine output)</h3>
    <div class="control-row">
      <label for="week-filter">Filter:</label>
      <select id="week-filter" bind:value={weekFilter}>
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

    <!-- ── Raw JSON toggles ───────────────────────────────────────────────── -->
    <div class="control-row">
      <button on:click={() => (showRawStandings = !showRawStandings)}>{showRawStandings ? 'Hide' : 'Show'} Raw Standings JSON</button>
      <button on:click={() => (showRawBrackets = !showRawBrackets)}>{showRawBrackets ? 'Hide' : 'Show'} Raw Bracket JSON</button>
    </div>
    {#if showRawStandings}
      <pre class="raw-json">{JSON.stringify(standings, null, 2)}</pre>
    {/if}
    {#if showRawBrackets}
      <pre class="raw-json">{JSON.stringify({ winnersBracket: rawWinnersBracket, losersBracket: rawLosersBracket }, null, 2)}</pre>
    {/if}

    <!-- ── Season debug logs ──────────────────────────────────────────────── -->
    {#if debugLogs.length > 0}
      <div class="debug-terminal">
        <h4>System Trace Logs</h4>
        <ul>
          {#each debugLogs as log}
            <li><code>{log}</code></li>
          {/each}
        </ul>
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
  .manager-tag { font-size: 0.8em; color: #888; font-weight: normal; }
  .podium-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
  .podium-card { padding: 1.5rem; border-radius: 8px; border-left: 6px solid #ccc; background: #fcfcfc; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 1.5rem; }
  .podium-card.gold { border-left-color: #ffd700; background: #fffdf3; }
  .podium-card.poop { border-left-color: #8b5a2b; background: #fbf7f3; }
  .podium-card.rivalry { border-left-color: #4a90d9; background: #f3f8fd; }
  .podium-card h3 { margin: 0 0 0.5rem 0; font-size: 1.1rem; }
  .podium-card p { margin: 0.3rem 0; }
  .meta-title { font-size: 1.4rem; font-weight: 700; color: #222; }
  .meta-sub { font-size: 0.95rem; color: #666; margin-top: 0.25rem; }
  .meta-empty { color: #999; font-style: italic; margin-bottom: 1rem; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.9rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: center; }
  .data-table th { background: #f5f5f5; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .subhead th { background: #ececec; font-weight: 600; }
  .tx-type { font-weight: 600; text-transform: capitalize; }
  .tx-type.trade { color: #2563eb; }
  .tx-type.waiver { color: #16a34a; }
  .raw-json { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; margin-bottom: 1rem; max-height: 400px; }
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; margin-top: 1rem; margin-bottom: 2rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem 0; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.25rem; }
</style>
