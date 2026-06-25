<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getAllSeasonsHistory, getAllTimeTotals } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getTransactionHistory, getAllTimeTransactionTotals, getSeasonTransactionTotals } from '$lib/utils/dataEngine/allTransactions.js';
  import { gradeTradeByPAR, gradeWaiverByPAR, gradeCompositeTrade } from '$lib/utils/dataEngine/parGrading.js';
  import { teamManagersStore } from '$lib/stores';

  let allTimeHistory = null;
  let transactionHistory = null;
  let loadingTransactions = false;
  let transactionDebug = [];
  let gradedTransactions = [];
  let allTimeTransactionTotals = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals = [];
  let txFilter = 'all';
  let showTransactionDebug = false;
  let expandedTx = new Set();
  let showValidationGuide = true;

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

  function managerDisplayName(managerId) {
    if (!managerId) return '?';
    const snap = get(teamManagersStore) || {};
    return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
  }

  function fp(val, d = 1) { return typeof val === 'number' ? val.toFixed(d) : '—'; }
  function parClass(val) { return typeof val === 'number' ? (val >= 0 ? 'positive' : 'negative') : ''; }

  function tradeGradeEmoji(grade) {
    return { lopsided: '💥', clear: '✅', close: '⚖️', even: '🤝' }[grade] || '?';
  }
  function waiverGradeEmoji(label) {
    return { elite: '🔥', strong: '✅', solid: '👍', breakeven: '➖', poor: '❌' }[label] || '?';
  }

  function toggleTx(id) {
    const next = new Set(expandedTx);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedTx = next;
  }

  async function loadTransactionHistory() {
    loadingTransactions = true;
    transactionDebug = [];
    gradedTransactions = [];

    try {
      if (!allTimeHistory) {
        transactionDebug.push('Loading all-time history for PAR data...');
        await getLeagueTeamManagers();
        allTimeHistory = await getAllSeasonsHistory();
        const seasonCount = Object.keys(allTimeHistory.parTablesBySeason || {}).length;
        transactionDebug.push(`Loaded ${seasonCount} seasons. Player results: ${allTimeHistory.playerResults?.length ?? 0} rows.`);

        // Log replacement players for each season so you can validate
        Object.entries(allTimeHistory.parTablesBySeason || {}).forEach(([year, tables]) => {
          transactionDebug.push(`[${year}] Replacement levels:`);
          Object.entries(tables.replacementPlayerNames || {}).forEach(([pos, name]) => {
            transactionDebug.push(`  ${pos}: ${name} (${fp(tables.replacementLevels[pos])} season pts)`);
          });
        });
      }

      const playerResults = allTimeHistory.playerResults || [];
      const txResult = await getTransactionHistory(undefined, playerResults);
      transactionHistory = txResult;
      transactionDebug.push(...txResult.debug);

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
      transactionDebug.push(`Graded ${gradedTransactions.length} transactions total (${compositeCount} composite).`);
    } catch (e) {
      console.error('Critical error:', e);
      transactionDebug.push(`Crash: ${e.message}`);
    } finally {
      loadingTransactions = false;
    }
  }

  onMount(async () => {
    await getLeagueTeamManagers().catch((err) => {
      transactionDebug = [`getLeagueTeamManagers failed: ${err.message}`];
    });
  });
</script>

<main class="container">
  <h2>Transaction Analysis Panel</h2>

  <!-- ── Validation guide ────────────────────────────────────────────────── -->
  <div class="guide-toggle">
    <button class="link-btn" on:click={() => (showValidationGuide = !showValidationGuide)}>
      {showValidationGuide ? '▲ Hide' : '▼ Show'} Validation Guide
    </button>
  </div>
  {#if showValidationGuide}
    <div class="validation-guide">
      <h4>How to validate trades</h4>
      <ul>
        <li><strong>Pre-trade roster at position</strong> — lists every player at that position on the roster before the trade. Verify the ★ marginal player is actually the Nth-best starter (not your star). For 2 RB slots → should be your 2nd-best RB.</li>
        <li><strong>Week-by-week table</strong> — shows acquired player vs marginal player actual points each week. Cross-check 2-3 weeks against Sleeper.</li>
        <li><strong>PAR = acquired total − marginal total</strong> during those same weeks. Positive = good acquisition.</li>
        <li><strong>Red flags</strong>: marginal player looks like a star → slot count wrong. Any player shows 0 every week but played → playerResults gap.</li>
      </ul>
      <h4>How to validate waivers</h4>
      <ul>
        <li><strong>Replacement player</strong> — should be roughly the 12th-13th best player at that position across the league (borderline starter, not a star). Check the name in debug logs under "Replacement levels."</li>
        <li><strong>Week-by-week table</strong> — pickup points vs replacement player points each week.</li>
        <li><strong>PAR = pickup total − replacement total</strong> during hold weeks. Positive = above replacement = helped team.</li>
        <li><strong>Season pts (context)</strong> — replacement player's full-season total, shown for reference only.</li>
      </ul>
      <h4>Grade thresholds</h4>
      <p>Waivers: Elite (&gt;30 PAR) / Strong (&gt;15) / Solid (&gt;5) / Break-even (-5 to 5) / Poor (&lt;-5)</p>
      <p>Trades: Lopsided (&gt;40 PAR diff) / Clear (&gt;20) / Close (≤20) / Even (tied)</p>
    </div>
  {/if}

  <!-- ── Load button ─────────────────────────────────────────────────────── -->
  <div class="control-row">
    <button on:click={loadTransactionHistory} disabled={loadingTransactions}>
      {loadingTransactions ? 'Loading...' : (transactionHistory ? 'Reload Transactions' : 'Load Transaction History')}
    </button>
  </div>

  {#if loadingTransactions}
    <div class="status-msg">Loading and grading all transactions...</div>
  {:else if transactionHistory}

    <!-- All-time counts -->
    <h3>All-Time Transaction Totals</h3>
    <table class="data-table">
      <thead><tr><th>Manager</th><th>Trades</th><th>Waivers</th><th>Total</th></tr></thead>
      <tbody>
        {#each allTimeTransactionTotals as m}
          <tr><td>{m.displayName}</td><td>{m.trades}</td><td>{m.waivers}</td><td>{m.total}</td></tr>
        {/each}
      </tbody>
    </table>

    <!-- Per-season counts -->
    <h3>Season Transaction Totals</h3>
    <div class="control-row">
      <select bind:value={selectedTransactionSeason}
        on:change={() => {
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

    <!-- Graded transactions -->
    <h3>Transactions
      <span class="count-badge">{filteredTransactions.length}</span>
    </h3>
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

        <!-- Summary row — always visible -->
        <div class="tx-summary" on:click={() => toggleTx(tx.id)} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && toggleTx(tx.id)}>
          <div class="tx-meta">
            {#if tx.isComposite}
              <span class="tx-type-badge composite">🔀 {tx.teams?.length}-Team</span>
            {:else}
              <span class="tx-type-badge {tx.type}">{tx.type}</span>
            {/if}
            <span class="tx-info">{tx.date} · S{tx.seasonKey || tx.season} Wk{tx.leg}</span>
            {#if tx.seq != null}<span class="seq-badge">seq:{tx.seq}</span>{/if}
            {#if g?.hasDraftPicks}<span class="pick-badge">📋 Picks</span>{/if}
          </div>

          <div class="tx-managers">
            {#if tx.isComposite}
              {(tx.teams || []).map((t) => managerDisplayName(t.managerId)).join(' → ')}
            {:else if tx.managerIds?.length}
              {tx.managerIds.map((id) => managerDisplayName(id)).join(' ↔ ')}
            {:else}—{/if}
          </div>

          {#if tx.isComposite && g}
            <span class="par-summary">{(g.ranked || []).map((t) => `${managerDisplayName(t.managerId)}: ${fp(t.parTotal)} PAR`).join(' | ')}</span>
          {:else if tx.type === 'trade' && g}
            <span class="trade-grade-badge grade-{g.narrative?.grade}">{tradeGradeEmoji(g.narrative?.grade)} {g.narrative?.grade}</span>
            <span class="par-summary">
              {managerDisplayName(tx.managerIds?.[0])}: {fp(g.side0?.parTotal)} | {managerDisplayName(tx.managerIds?.[1])}: {fp(g.side1?.parTotal)} PAR
            </span>
          {:else if tx.type === 'waiver' && g}
            <span class="waiver-grade-badge grade-{g.gradeLabel}">{waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}</span>
            <span class="par-summary">{g.name} ({g.position}) · {fp(g.par)} PAR · {g.weeks} wk(s)</span>
          {/if}

          <span class="expand-toggle">{isExpanded ? '▲' : '▼'}</span>
        </div>

        <!-- Expanded detail -->
        {#if isExpanded}
          <div class="tx-detail">

            {#if tx.isComposite && g}
              <p class="narrative-text">
                Multi-team trade — net movements shown (pass-through players cancelled out).
                {g.hasDraftPicks ? ' Includes draft picks — player value only.' : ''}
              </p>
              <div class="trade-sides">
                {#each g.teamGrades as teamGrade}
                  {@const isWinner = g.winnerRoster === teamGrade.roster}
                  <div class="trade-side {isWinner ? 'winner' : ''}">
                    <div class="side-header">{isWinner ? '🏆 ' : ''}{managerDisplayName(teamGrade.managerId)} received (net):</div>
                    <div class="side-par">Total PAR: <span class="{parClass(teamGrade.parTotal)}">{fp(teamGrade.parTotal)}</span></div>
                    {#each (teamGrade.players || []) as p}
                      <div class="player-block">
                        <div class="player-name-row">
                          <span class="pos-tag">{p.position}</span>
                          <strong>{p.name}</strong>
                          <span class="{parClass(p.par)}">{fp(p.par)} PAR</span>
                        </div>
                        <div class="player-stats">
                          {fp(p.totalPts)} total / {fp(p.startedPts)} started · {p.weeksStarted}/{p.weeks} wks
                        </div>
                        <div class="baseline-row">
                          vs {p.marginalPlayerName}
                          {#if p.marginalRank}<span class="rank-tag">#{p.marginalRank} starter</span>{/if}
                          <span class="source-tag">{p.baselineSource}</span>:
                          {fp(p.baselineTotal)} pts (baseline)
                        </div>
                        {#if p.weekBreakdown?.length > 0}
                          <table class="week-table">
                            <thead><tr><th>Wk</th><th>Acquired</th><th>Marginal</th><th>PAR</th></tr></thead>
                            <tbody>
                              {#each p.weekBreakdown as row}
                                <tr>
                                  <td>{row.week}</td>
                                  <td>{fp(row.acquiredPts)}</td>
                                  <td>{fp(row.marginalPts)}</td>
                                  <td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
              <div class="constituent-note">Constituent IDs: {tx.constituentTradeIds?.join(', ')}</div>

            {:else if tx.type === 'trade' && g}
              <p class="narrative-text">{g.narrative?.summary}</p>
              <div class="trade-sides">
                {#each tx.rosters as roster, idx}
                  {@const side = idx === 0 ? g.side0 : g.side1}
                  {@const isWinner = g.winner === idx}
                  <div class="trade-side {isWinner ? 'winner' : ''}">
                    <div class="side-header">{isWinner ? '🏆 ' : ''}{managerDisplayName(tx.managerIds?.[idx])} received:</div>
                    <div class="side-par">
                      Total PAR: <span class="{parClass(side?.parTotal)}">{fp(side?.parTotal)}</span>
                      · Raw: {fp(side?.rawTotal)} total / {fp(side?.rawStarted)} started
                    </div>

                    {#each (side?.players || []) as p}
                      <div class="player-block">
                        <!-- Player outcome -->
                        <div class="player-name-row">
                          <span class="pos-tag">{p.position}</span>
                          <strong>{p.name}</strong>
                          <span class="{parClass(p.par)}">{fp(p.par)} PAR</span>
                        </div>
                        <div class="player-stats">
                          {fp(p.totalPts)} total / {fp(p.startedPts)} started · {p.weeksStarted}/{p.weeks} wks ({(p.startedPct * 100).toFixed(0)}% start rate)
                        </div>

                        <!-- Baseline calculation -->
                        <div class="baseline-section">
                          <div class="baseline-header">📊 Baseline</div>
                          <div class="baseline-row">
                            <span class="bl-label">Compared against:</span>
                            <strong>{p.marginalPlayerName}</strong>
                            {#if p.marginalRank}
                              <span class="rank-tag">#{p.marginalRank} of {p.dedicatedSlots} dedicated {p.position} starter(s)</span>
                            {/if}
                            <span class="source-tag">{p.baselineSource}</span>
                          </div>
                          {#if p.allPlayersPreTrade?.length > 0}
                            <div class="pre-trade-roster">
                              <span class="bl-label">Pre-trade {p.position} roster ({p.weeksBeforeTrade} wks of data):</span>
                              {#each p.allPlayersPreTrade as player, i}
                                <span class="roster-player {i === (p.marginalRank - 1) ? 'is-marginal' : ''}">
                                  {i === (p.marginalRank - 1) ? '★ ' : ''}{player.name} ({fp(player.pts)} pts)
                                </span>
                              {/each}
                            </div>
                          {:else if p.weeksBeforeTrade === 0}
                            <div class="baseline-row"><span class="bl-note">Week 1 trade — no pre-trade data, using league replacement</span></div>
                          {/if}
                          <div class="baseline-row">
                            <span class="bl-label">Baseline total (actual points, same weeks):</span>
                            <strong>{fp(p.baselineTotal)} pts</strong>
                          </div>
                          <div class="baseline-row formula">
                            PAR: {fp(p.totalPts)} acquired − {fp(p.baselineTotal)} baseline = <strong class="{parClass(p.par)}">{fp(p.par)}</strong>
                          </div>
                        </div>

                        <!-- Week-by-week table -->
                        {#if p.weekBreakdown?.length > 0}
                          <div class="week-breakdown">
                            <div class="bl-label">Week-by-week (acquired vs marginal player):</div>
                            <table class="week-table">
                              <thead>
                                <tr>
                                  <th>Wk</th>
                                  <th>{p.name.split(' ')[0]}</th>
                                  <th>Started?</th>
                                  <th>{p.marginalPlayerName.split(' ')[0]}</th>
                                  <th>PAR</th>
                                </tr>
                              </thead>
                              <tbody>
                                {#each p.weekBreakdown as row}
                                  <tr>
                                    <td>{row.week}</td>
                                    <td>{fp(row.acquiredPts)}</td>
                                    <td>{row.acquiredStarted > 0 ? '✓' : '—'}</td>
                                    <td>{fp(row.marginalPts)}</td>
                                    <td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td>
                                  </tr>
                                {/each}
                                <tr class="totals-row">
                                  <td>Total</td>
                                  <td>{fp(p.totalPts)}</td>
                                  <td>—</td>
                                  <td>{fp(p.baselineTotal)}</td>
                                  <td class="{parClass(p.par)}">{fp(p.par)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        {:else}
                          <div class="baseline-row"><span class="bl-note">⚠ No hold weeks found — player may not appear in playerResults for this roster/season</span></div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>

              {#if g.narrative?.flags?.length > 0}
                <div class="flags">
                  {#each g.narrative.flags as flag}
                    <span class="flag flag-{flag.type}">
                      {flag.type === 'injury-suspected' ? '🚑' : '📋'} {flag.type}: {flag.name}
                    </span>
                  {/each}
                </div>
              {/if}

            {:else if tx.type === 'waiver' && g}
              <p class="narrative-text">{g.gradeSummary}</p>

              <div class="waiver-layout">
                <!-- Pickup info -->
                <div class="waiver-section">
                  <div class="section-label">📥 Pickup</div>
                  <div class="player-name-row">
                    <span class="pos-tag">{g.position}</span>
                    <strong>{g.name}</strong>
                    <span class="waiver-grade-badge grade-{g.gradeLabel}">{waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}</span>
                  </div>
                  <div class="player-stats">
                    {fp(g.totalPts)} total / {fp(g.startedPts)} started · {g.weeksStarted}/{g.weeks} wks
                    {#if g.isStream}<span class="stream-tag">stream</span>{/if}
                  </div>
                  {#if g.droppedName}
                    <div class="dropped-row">Dropped: {g.droppedName}</div>
                  {/if}
                </div>

                <!-- Replacement info -->
                <div class="waiver-section">
                  <div class="section-label">📊 Replacement Level</div>
                  <div class="player-name-row">
                    <span class="pos-tag">{g.position}</span>
                    <strong>{g.replacementPlayerName}</strong>
                    <span class="rank-tag">Nth best {g.position} across league</span>
                  </div>
                  <div class="player-stats">
                    Full-season total (context): {fp(g.replacementSeasonPts)} pts
                  </div>
                  <div class="player-stats">
                    During your hold weeks: <strong>{fp(g.replacementActualPts)} pts</strong>
                  </div>
                </div>

                <!-- PAR -->
                <div class="waiver-section">
                  <div class="section-label">🎯 Result</div>
                  <div class="formula">
                    {fp(g.totalPts)} pickup − {fp(g.replacementActualPts)} replacement =
                    <strong class="{parClass(g.par)}">{fp(g.par)} PAR</strong>
                  </div>
                </div>
              </div>

              <!-- Week-by-week -->
              {#if g.weekBreakdown?.length > 0}
                <div class="week-breakdown">
                  <div class="bl-label">Week-by-week (pickup vs replacement player):</div>
                  <table class="week-table">
                    <thead>
                      <tr>
                        <th>Wk</th>
                        <th>{g.name.split(' ')[0]}</th>
                        <th>Started?</th>
                        <th>{g.replacementPlayerName.split(' ')[0]}</th>
                        <th>PAR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each g.weekBreakdown as row}
                        <tr>
                          <td>{row.week}</td>
                          <td>{fp(row.pickupPts)}</td>
                          <td>{row.pickupStarted > 0 ? '✓' : '—'}</td>
                          <td>{fp(row.replacementPts)}</td>
                          <td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td>
                        </tr>
                      {/each}
                      <tr class="totals-row">
                        <td>Total</td>
                        <td>{fp(g.totalPts)}</td>
                        <td>—</td>
                        <td>{fp(g.replacementActualPts)}</td>
                        <td class="{parClass(g.par)}">{fp(g.par)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              {:else}
                <div class="baseline-row"><span class="bl-note">⚠ No hold weeks found in playerResults — check data completeness for this season</span></div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    <div class="control-row" style="margin-top:1rem;">
      <button on:click={() => (showTransactionDebug = !showTransactionDebug)}>
        {showTransactionDebug ? 'Hide' : 'Show'} Debug Logs
      </button>
    </div>
    {#if showTransactionDebug && transactionDebug.length > 0}
      <div class="debug-terminal">
        <h4>Debug Logs</h4>
        <ul>{#each transactionDebug as log}<li><code>{log}</code></li>{/each}</ul>
      </div>
    {/if}
  {/if}
</main>

<style>
  .container { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  .control-row { margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  select, button { padding: 0.5rem 1rem; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { background: none; border: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 0.9rem; text-decoration: underline; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .count-badge { background: #e5e7eb; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.8rem; color: #555; margin-left: 0.5rem; font-weight: normal; }

  /* Validation guide */
  .guide-toggle { margin-bottom: 0.5rem; }
  .validation-guide { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 2rem; font-size: 0.88rem; }
  .validation-guide h4 { margin: 0.75rem 0 0.25rem; color: #0369a1; }
  .validation-guide h4:first-child { margin-top: 0; }
  .validation-guide ul { margin: 0 0 0.5rem; padding-left: 1.5rem; }
  .validation-guide li { margin-bottom: 0.3rem; }
  .validation-guide p { margin: 0.25rem 0; }

  /* Tables */
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.9rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: center; }
  .data-table th { background: #f5f5f5; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }

  /* Transaction cards */
  .tx-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.75rem; overflow: hidden; }
  .tx-card.trade     { border-left: 4px solid #2563eb; }
  .tx-card.waiver    { border-left: 4px solid #16a34a; }
  .tx-card.composite { border-left: 4px solid #7c3aed; }
  .tx-summary { padding: 0.75rem 1rem; cursor: pointer; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; background: #fafafa; }
  .tx-summary:hover { background: #f0f0f0; }
  .tx-meta    { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
  .tx-managers { font-size: 0.88em; color: #444; flex: 1; min-width: 120px; }
  .par-summary { font-size: 0.83em; color: #555; }
  .expand-toggle { margin-left: auto; color: #888; font-size: 0.8em; flex-shrink: 0; }
  .tx-detail  { padding: 1rem; border-top: 1px solid #eee; }
  .narrative-text { font-style: italic; color: #444; margin: 0 0 1rem; font-size: 0.9em; background: #f9f9f9; padding: 0.5rem 0.75rem; border-radius: 4px; }

  /* Badges */
  .tx-type-badge { padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.73em; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
  .tx-type-badge.trade     { background: #dbeafe; color: #1d4ed8; }
  .tx-type-badge.waiver    { background: #dcfce7; color: #15803d; }
  .tx-type-badge.composite { background: #ede9fe; color: #6d28d9; }
  .tx-info   { font-size: 0.82em; color: #666; }
  .seq-badge { font-size: 0.72em; background: #f3f4f6; color: #888; padding: 0.1rem 0.35rem; border-radius: 3px; }
  .pick-badge { background: #fef3c7; color: #92400e; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.75em; }
  .stream-tag { background: #e0f2fe; color: #0369a1; padding: 0 0.3rem; border-radius: 3px; font-size: 0.78em; margin-left: 0.25rem; }
  .rank-tag { background: #e0f2fe; color: #0369a1; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.78em; }
  .source-tag { background: #f3f4f6; color: #6b7280; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.75em; font-style: italic; }
  .trade-grade-badge, .waiver-grade-badge { padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.8em; font-weight: 700; text-transform: capitalize; }

  /* Grade colors */
  .grade-lopsided  { background: #fef2f2; color: #dc2626; }
  .grade-clear     { background: #f0fdf4; color: #16a34a; }
  .grade-close     { background: #fffbeb; color: #d97706; }
  .grade-even      { background: #f3f4f6; color: #6b7280; }
  .grade-elite     { background: #fef3c7; color: #92400e; }
  .grade-strong    { background: #d1fae5; color: #065f46; }
  .grade-solid     { background: #e0f2fe; color: #0369a1; }
  .grade-breakeven { background: #f3f4f6; color: #6b7280; }
  .grade-poor      { background: #fef2f2; color: #dc2626; }

  /* Trade layout */
  .trade-sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
  .trade-side { padding: 0.75rem; border-radius: 6px; background: #f8f8f8; border: 2px solid transparent; }
  .trade-side.winner { background: #f0fff4; border-color: #34d399; }
  .side-header { font-weight: 700; margin-bottom: 0.4rem; font-size: 0.95em; }
  .side-par { font-size: 0.88em; color: #555; margin-bottom: 0.75rem; }

  /* Player blocks */
  .player-block { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem; margin-top: 0.5rem; }
  .player-name-row { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.3rem; }
  .pos-tag { background: #e5e7eb; border-radius: 3px; padding: 0.1rem 0.35rem; font-size: 0.75em; font-weight: 700; }
  .player-stats { font-size: 0.83em; color: #555; margin-bottom: 0.4rem; }
  .dropped-row { font-size: 0.83em; color: #999; margin-top: 0.25rem; }

  /* Baseline section */
  .baseline-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.6rem 0.75rem; margin: 0.4rem 0; font-size: 0.83em; }
  .baseline-header { font-weight: 700; color: #475569; margin-bottom: 0.35rem; }
  .baseline-row { display: flex; gap: 0.4rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.2rem; }
  .bl-label { color: #64748b; flex-shrink: 0; }
  .bl-note { color: #f59e0b; font-style: italic; }
  .formula { font-family: monospace; font-size: 0.9em; background: #f1f5f9; padding: 0.3rem 0.5rem; border-radius: 3px; margin-top: 0.25rem; }

  /* Pre-trade roster */
  .pre-trade-roster { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; margin: 0.3rem 0; }
  .roster-player { background: #f1f5f9; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.82em; }
  .roster-player.is-marginal { background: #fef3c7; color: #92400e; font-weight: 700; }

  /* Week table */
  .week-breakdown { margin-top: 0.5rem; }
  .week-table { width: 100%; border-collapse: collapse; font-size: 0.82em; margin-top: 0.25rem; }
  .week-table th, .week-table td { border: 1px solid #e5e7eb; padding: 0.25rem 0.4rem; text-align: center; }
  .week-table th { background: #f1f5f9; font-weight: 600; }
  .week-table .totals-row td { background: #f8fafc; font-weight: 700; }

  /* Waiver layout */
  .waiver-layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
  .waiver-section { background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.75rem; }
  .section-label { font-weight: 700; color: #475569; font-size: 0.85em; margin-bottom: 0.4rem; }

  /* Misc */
  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }
  .flags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
  .flag { padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.8em; }
  .flag-injury-suspected { background: #fff7ed; color: #c2410c; }
  .flag-underutilized    { background: #faf5ff; color: #7e22ce; }
  .constituent-note { font-size: 0.75em; color: #aaa; margin-top: 0.5rem; }
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; margin-top: 1rem; font-size: 0.82em; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul  { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li  { margin-bottom: 0.2rem; }
</style>
