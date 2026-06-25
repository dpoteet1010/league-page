<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getAllSeasonsHistory } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getTransactionHistory, getAllTimeTransactionTotals, getSeasonTransactionTotals } from '$lib/utils/dataEngine/allTransactions.js';
  import { gradeTradeByPAR, gradeWaiverByPAR, gradeCompositeTrade } from '$lib/utils/dataEngine/parGrading.js';
  import { teamManagersStore } from '$lib/stores';

  let allTimeHistory   = null;
  let transactionHistory = null;
  let loadingTransactions = false;
  let transactionDebug = [];
  let gradedTransactions = [];
  let allTimeTransactionTotals = [];
  let selectedTransactionSeason = '';
  let seasonTransactionTotals = [];
  let txFilter = 'all';
  let showTransactionDebug = false;
  let showValidationGuide = true;
  let expandedTx = new Set();

  $: filteredTransactions = gradedTransactions
    .filter((tx) => !tx.isPartOfComposite)
    .filter((tx) => {
      if (txFilter === 'trade')  return tx.type === 'trade';
      if (txFilter === 'waiver') return tx.type === 'waiver';
      return true;
    });

  $: if (transactionHistory && selectedTransactionSeason) {
    const snap = get(teamManagersStore) || {};
    seasonTransactionTotals = getSeasonTransactionTotals(
      transactionHistory.totals, selectedTransactionSeason, snap
    );
  }

  function managerDisplayName(managerId) {
    if (!managerId) return '?';
    const snap = get(teamManagersStore) || {};
    return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
  }

  function fp(val, d = 1) {
    return typeof val === 'number' ? val.toFixed(d) : '—';
  }

  function parClass(val) {
    if (typeof val !== 'number') return '';
    return val >= 0 ? 'positive' : 'negative';
  }

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
        transactionDebug.push('Loading all-time history...');
        await getLeagueTeamManagers();
        allTimeHistory = await getAllSeasonsHistory();
        const seasonCount = Object.keys(allTimeHistory.parTablesBySeason || {}).length;
        transactionDebug.push(`Loaded ${seasonCount} seasons. Player results: ${allTimeHistory.playerResults?.length ?? 0} rows.`);

        // Log replacement players per season for validation
        Object.entries(allTimeHistory.parTablesBySeason || {}).forEach(([year, tables]) => {
          transactionDebug.push(`[${year}] Replacement players (Nth best at position, FLEX ignored):`);
          Object.entries(tables.replacementPlayerNames || {}).forEach(([pos, name]) => {
            transactionDebug.push(`  ${pos}: ${name} — ${fp(tables.replacementLevels[pos])} season pts → ${fp((tables.replacementLevels[pos] || 0) / 17)} pts/wk`);
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

      const availableSeasons = Object.keys(txResult.totals.seasons || {})
        .sort((a, b) => Number(b) - Number(a));
      if (availableSeasons.length > 0) {
        selectedTransactionSeason = availableSeasons[0];
        seasonTransactionTotals = getSeasonTransactionTotals(
          txResult.totals, selectedTransactionSeason, snap
        );
      }

      const compositeCount = gradedTransactions.filter((tx) => tx.isComposite).length;
      transactionDebug.push(`Graded ${gradedTransactions.length} transactions (${compositeCount} composite).`);
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
  <div class="guide-row">
    <button class="link-btn" on:click={() => (showValidationGuide = !showValidationGuide)}>
      {showValidationGuide ? '▲ Hide' : '▼ Show'} Validation Guide
    </button>
  </div>

  {#if showValidationGuide}
    <div class="validation-guide">
      <h4>PAR Formula (identical for trades and waivers)</h4>
      <p><code>baseline = (replacementSeasonTotal / 17) × weeksHeld</code></p>
      <p><code>PAR = playerActualPts − baseline</code></p>
      <p>weeksHeld = actual weeks player appeared on that roster in playerResults after the transaction.</p>

      <h4>How to validate trades</h4>
      <ul>
        <li><strong>Replacement player</strong> — should be a borderline starter (not a star, not a zero). Check debug logs for "Replacement players" per season. E.g. for RB with 12 teams × 2 slots = 24th best RB in the league.</li>
        <li><strong>Rep pts/wk</strong> — replacement season total ÷ 17. Should be consistent across all weeks.</li>
        <li><strong>Week-by-week table</strong> — actual player pts vs rep pts/wk each week. Verify a few against Sleeper scores.</li>
        <li><strong>PAR = total actual − total baseline.</strong> If baseline seems too high (star-level), PAR table data may have a gap for that season.</li>
      </ul>

      <h4>How to validate waivers</h4>
      <ul>
        <li><strong>Same replacement player</strong> as trades — 12th best K, 24th best RB etc. Same baseline rate.</li>
        <li><strong>Streaming waivers (1-2 wks)</strong> — baseline is small (1-2 × rep/wk) so PAR reflects actual vs a small bar. A 2-wk stream needs to beat ~2 × rep/wk to grade positive.</li>
        <li><strong>0 weeks held</strong> — player never appeared in playerResults for that roster. Check data completeness.</li>
      </ul>

      <h4>Grade thresholds (waivers)</h4>
      <p>Elite (&gt;30 PAR) · Strong (&gt;15) · Solid (&gt;5) · Breakeven (−5 to 5) · Poor (&lt;−5)</p>
      <h4>Grade thresholds (trades)</h4>
      <p>Lopsided (&gt;40 PAR diff) · Clear (&gt;20) · Close (≤20) · Even (tied)</p>
    </div>
  {/if}

  <!-- ── Load button ─────────────────────────────────────────────────────── -->
  <div class="control-row">
    <button on:click={loadTransactionHistory} disabled={loadingTransactions}>
      {loadingTransactions
        ? 'Loading...'
        : transactionHistory ? 'Reload Transactions' : 'Load Transaction History'}
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
          <tr>
            <td>{m.displayName}</td>
            <td>{m.trades}</td>
            <td>{m.waivers}</td>
            <td>{m.total}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <!-- Per-season counts -->
    <h3>Season Transaction Totals</h3>
    <div class="control-row">
      <select bind:value={selectedTransactionSeason}
        on:change={() => {
          const snap = get(teamManagersStore) || {};
          seasonTransactionTotals = getSeasonTransactionTotals(
            transactionHistory.totals, selectedTransactionSeason, snap
          );
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

    <!-- Graded transactions -->
    <h3>
      All Transactions
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
      {@const g  = tx.grade}
      {@const isExpanded = expandedTx.has(tx.id)}

      <div class="tx-card {tx.type} {tx.isComposite ? 'composite' : ''}">

        <!-- Summary row -->
        <div class="tx-summary"
          on:click={() => toggleTx(tx.id)}
          role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && toggleTx(tx.id)}>

          <div class="tx-meta">
            {#if tx.isComposite}
              <span class="badge composite">🔀 {tx.teams?.length}-Team</span>
            {:else}
              <span class="badge {tx.type}">{tx.type}</span>
            {/if}
            <span class="tx-info">{tx.date} · S{tx.seasonKey || tx.season} Wk{tx.leg}</span>
            {#if g?.hasDraftPicks}<span class="badge pick">📋 Picks</span>{/if}
          </div>

          <div class="tx-managers">
            {#if tx.isComposite}
              {(tx.teams || []).map((t) => managerDisplayName(t.managerId)).join(' → ')}
            {:else if tx.managerIds?.length}
              {tx.managerIds.map((id) => managerDisplayName(id)).join(' ↔ ')}
            {:else}—{/if}
          </div>

          {#if tx.isComposite && g}
            <span class="par-line">
              {(g.ranked || []).map((t) => `${managerDisplayName(t.managerId)}: ${fp(t.parTotal)} PAR`).join(' | ')}
            </span>
          {:else if tx.type === 'trade' && g}
            <span class="grade-badge grade-{g.narrative?.grade}">
              {tradeGradeEmoji(g.narrative?.grade)} {g.narrative?.grade}
            </span>
            <span class="par-line">
              {managerDisplayName(tx.managerIds?.[0])}: {fp(g.side0?.parTotal)} |
              {managerDisplayName(tx.managerIds?.[1])}: {fp(g.side1?.parTotal)} PAR
            </span>
          {:else if tx.type === 'waiver' && g}
            <span class="grade-badge grade-{g.gradeLabel}">
              {waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}
            </span>
            <span class="par-line">
              {g.name} ({g.position}) · {fp(g.par)} PAR · {g.weeksHeld} wk(s)
            </span>
          {:else if tx.type === 'trade' && !g}
            <span class="par-line muted">No grade (missing PAR tables for this season)</span>
          {:else if tx.type === 'waiver' && !g}
            <span class="par-line muted">No grade</span>
          {/if}

          <span class="expand-toggle">{isExpanded ? '▲' : '▼'}</span>
        </div>

        <!-- Expanded detail -->
        {#if isExpanded}
          <div class="tx-detail">

            <!-- ── COMPOSITE TRADE ─────────────────────────────────────── -->
            {#if tx.isComposite && g}
              <p class="narrative">
                Multi-team trade — net movements shown (pass-through players cancelled out).
                {g.hasDraftPicks ? ' Includes draft picks — player value only.' : ''}
              </p>
              <div class="sides">
                {#each g.teamGrades as team}
                  {@const isWinner = g.winnerRoster === team.roster}
                  <div class="side {isWinner ? 'winner' : ''}">
                    <div class="side-header">{isWinner ? '🏆 ' : ''}{managerDisplayName(team.managerId)} received (net):</div>
                    <div class="side-total">PAR: <span class="{parClass(team.parTotal)}">{fp(team.parTotal)}</span> · Raw: {fp(team.rawTotal)}</div>
                    {#each (team.players || []) as p}
                      <div class="player-block">
                        <div class="p-name-row">
                          <span class="pos">{p.position}</span>
                          <strong>{p.name}</strong>
                          <span class="{parClass(p.par)}">{fp(p.par)} PAR</span>
                        </div>
                        <div class="p-stats">{fp(p.totalPts)} pts · {p.weeksStarted}/{p.weeksHeld} wks started</div>
                        <div class="baseline-info">
                          vs <strong>{p.repName}</strong> ·
                          rep: {fp(p.repSeasonTotal)}/season ÷ 17 = {fp(p.repPerWeek)}/wk ·
                          baseline ({p.weeksHeld} wks): {fp(p.baseline)}
                        </div>
                        {#if p.weekBreakdown?.length > 0}
                          <table class="wk-table">
                            <thead>
                              <tr><th>Wk</th><th>Player</th><th>Started?</th><th>Rep/wk</th><th>PAR</th></tr>
                            </thead>
                            <tbody>
                              {#each p.weekBreakdown as row}
                                <tr>
                                  <td>{row.week}</td>
                                  <td>{fp(row.playerPts)}</td>
                                  <td>{row.startedPts > 0 ? '✓' : '—'}</td>
                                  <td>{fp(row.repBaseline)}</td>
                                  <td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td>
                                </tr>
                              {/each}
                              <tr class="totals">
                                <td>Total</td>
                                <td>{fp(p.totalPts)}</td>
                                <td>—</td>
                                <td>{fp(p.baseline)}</td>
                                <td class="{parClass(p.par)}">{fp(p.par)}</td>
                              </tr>
                            </tbody>
                          </table>
                        {:else}
                          <div class="warn">⚠ No hold weeks found in playerResults</div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
              <div class="constituent">Constituent IDs: {tx.constituentTradeIds?.join(', ')}</div>

            <!-- ── STANDARD TRADE ──────────────────────────────────────── -->
            {:else if tx.type === 'trade' && g}
              <p class="narrative">{g.narrative?.summary}</p>
              <div class="sides">
                {#each tx.rosters as roster, idx}
                  {@const side     = idx === 0 ? g.side0 : g.side1}
                  {@const isWinner = g.winner === idx}
                  <div class="side {isWinner ? 'winner' : ''}">
                    <div class="side-header">{isWinner ? '🏆 ' : ''}{managerDisplayName(tx.managerIds?.[idx])} received:</div>
                    <div class="side-total">
                      PAR: <span class="{parClass(side?.parTotal)}">{fp(side?.parTotal)}</span>
                      · Raw: {fp(side?.rawTotal)} total / {fp(side?.rawStarted)} started
                    </div>

                    {#each (side?.players || []) as p}
                      <div class="player-block">
                        <div class="p-name-row">
                          <span class="pos">{p.position}</span>
                          <strong>{p.name}</strong>
                          <span class="{parClass(p.par)}">{fp(p.par)} PAR</span>
                        </div>
                        <div class="p-stats">
                          {fp(p.totalPts)} total / {fp(p.startedPts)} started ·
                          {p.weeksStarted}/{p.weeksHeld} wks started
                          ({p.weeksHeld > 0 ? (p.startedPct * 100).toFixed(0) : 0}% start rate)
                        </div>

                        <!-- Baseline section -->
                        <div class="baseline-box">
                          <div class="bl-header">📊 PAR Baseline</div>
                          <div class="bl-row">
                            <span class="bl-label">Replacement player:</span>
                            <strong>{p.repName}</strong>
                            <span class="tag">{p.position} replacement</span>
                          </div>
                          <div class="bl-row">
                            <span class="bl-label">Their season total:</span>
                            <span>{fp(p.repSeasonTotal)} pts over 17 weeks</span>
                            <span class="muted">= {fp(p.repPerWeek)} pts/wk</span>
                          </div>
                          <div class="bl-row">
                            <span class="bl-label">Prorated baseline:</span>
                            <span>{fp(p.repPerWeek)} pts/wk × {p.weeksHeld} wks held = <strong>{fp(p.baseline)} pts</strong></span>
                          </div>
                          <div class="formula">
                            PAR: {fp(p.totalPts)} actual − {fp(p.baseline)} baseline =
                            <strong class="{parClass(p.par)}">{fp(p.par)}</strong>
                          </div>
                        </div>

                        <!-- Week-by-week table -->
                        {#if p.weekBreakdown?.length > 0}
                          <div class="wk-section">
                            <div class="bl-label">Week-by-week — player actual vs replacement rate ({fp(p.repPerWeek)} pts/wk):</div>
                            <table class="wk-table">
                              <thead>
                                <tr>
                                  <th>Wk</th>
                                  <th>{p.name.split(' ').pop()}</th>
                                  <th>Started?</th>
                                  <th>Rep/wk</th>
                                  <th>PAR</th>
                                </tr>
                              </thead>
                              <tbody>
                                {#each p.weekBreakdown as row}
                                  <tr>
                                    <td>{row.week}</td>
                                    <td>{fp(row.playerPts)}</td>
                                    <td>{row.startedPts > 0 ? '✓' : '—'}</td>
                                    <td>{fp(row.repBaseline)}</td>
                                    <td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td>
                                  </tr>
                                {/each}
                                <tr class="totals">
                                  <td>Total</td>
                                  <td>{fp(p.totalPts)}</td>
                                  <td>—</td>
                                  <td>{fp(p.baseline)}</td>
                                  <td class="{parClass(p.par)}">{fp(p.par)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        {:else}
                          <div class="warn">⚠ No hold weeks found — player may not appear in playerResults for this roster/year. Check data completeness.</div>
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

            <!-- ── WAIVER ───────────────────────────────────────────────── -->
            {:else if tx.type === 'waiver' && g}
              <p class="narrative">{g.gradeSummary}</p>

              <div class="waiver-grid">
                <!-- Pickup -->
                <div class="w-section">
                  <div class="w-header">📥 Pickup</div>
                  <div class="p-name-row">
                    <span class="pos">{g.position}</span>
                    <strong>{g.name}</strong>
                    <span class="grade-badge grade-{g.gradeLabel}">{waiverGradeEmoji(g.gradeLabel)} {g.gradeLabel}</span>
                    {#if g.isStream}<span class="tag stream">stream</span>{/if}
                  </div>
                  <div class="p-stats">
                    {fp(g.totalPts)} total / {fp(g.startedPts)} started ·
                    {g.weeksStarted}/{g.weeksHeld} wks started
                  </div>
                  {#if g.droppedName}
                    <div class="dropped">Dropped: {g.droppedName}</div>
                  {/if}
                </div>

                <!-- Replacement -->
                <div class="w-section">
                  <div class="w-header">📊 Replacement Level</div>
                  <div class="p-name-row">
                    <span class="pos">{g.position}</span>
                    <strong>{g.repName}</strong>
                    <span class="tag">Nth best {g.position}</span>
                  </div>
                  <div class="p-stats">Season total: {fp(g.repSeasonTotal)} pts ÷ 17 = {fp(g.repPerWeek)} pts/wk</div>
                  <div class="p-stats">Prorated baseline ({g.weeksHeld} wks): <strong>{fp(g.baseline)}</strong></div>
                </div>

                <!-- Result -->
                <div class="w-section">
                  <div class="w-header">🎯 Result</div>
                  <div class="formula">
                    {fp(g.totalPts)} pickup − {fp(g.baseline)} baseline =
                    <strong class="{parClass(g.par)}">{fp(g.par)} PAR</strong>
                  </div>
                  {#if g.weeksHeld === 0}
                    <div class="warn" style="margin-top:0.5rem;">⚠ 0 weeks held — player not found in playerResults for this roster/season</div>
                  {/if}
                </div>
              </div>

              <!-- Week-by-week table -->
              {#if g.weekBreakdown?.length > 0}
                <div class="wk-section">
                  <div class="bl-label">Week-by-week — pickup actual vs replacement rate ({fp(g.repPerWeek)} pts/wk):</div>
                  <table class="wk-table">
                    <thead>
                      <tr>
                        <th>Wk</th>
                        <th>{g.name.split(' ').pop()}</th>
                        <th>Started?</th>
                        <th>Rep/wk</th>
                        <th>PAR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each g.weekBreakdown as row}
                        <tr>
                          <td>{row.week}</td>
                          <td>{fp(row.playerPts)}</td>
                          <td>{row.startedPts > 0 ? '✓' : '—'}</td>
                          <td>{fp(row.repBaseline)}</td>
                          <td class="{parClass(row.weekPAR)}">{fp(row.weekPAR)}</td>
                        </tr>
                      {/each}
                      <tr class="totals">
                        <td>Total</td>
                        <td>{fp(g.totalPts)}</td>
                        <td>—</td>
                        <td>{fp(g.baseline)}</td>
                        <td class="{parClass(g.par)}">{fp(g.par)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              {:else}
                <div class="warn">⚠ No hold weeks found — check playerResults data for this season.</div>
              {/if}

            {:else}
              <div class="warn">No grade available — PAR tables may be missing for season {tx.seasonKey || tx.season}.</div>
            {/if}

          </div>
        {/if}
      </div>
    {/each}

    <!-- Debug toggle -->
    <div class="control-row" style="margin-top:1rem;">
      <button on:click={() => (showTransactionDebug = !showTransactionDebug)}>
        {showTransactionDebug ? 'Hide' : 'Show'} Debug Logs
      </button>
    </div>
    {#if showTransactionDebug && transactionDebug.length > 0}
      <div class="debug-terminal">
        <h4>Debug Logs</h4>
        <ul>
          {#each transactionDebug as log}
            <li><code>{log}</code></li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</main>

<style>
  .container { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, -apple-system, sans-serif; }
  .control-row { margin-bottom: 1.5rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .guide-row { margin-bottom: 0.5rem; }
  select, button { padding: 0.5rem 1rem; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; }
  button { cursor: pointer; background: #f5f5f5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { background: none; border: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 0.88rem; text-decoration: underline; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .count-badge { background: #e5e7eb; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.78rem; color: #555; margin-left: 0.5rem; font-weight: normal; }

  /* Validation guide */
  .validation-guide { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 2rem; font-size: 0.87rem; }
  .validation-guide h4 { margin: 0.75rem 0 0.2rem; color: #0369a1; }
  .validation-guide h4:first-child { margin-top: 0; }
  .validation-guide ul { margin: 0.1rem 0 0.5rem; padding-left: 1.5rem; }
  .validation-guide li { margin-bottom: 0.25rem; }
  .validation-guide p { margin: 0.2rem 0; }
  .validation-guide code { background: #e0f2fe; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }

  /* Data tables */
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.9rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: center; }
  .data-table th { background: #f5f5f5; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }

  /* Transaction cards */
  .tx-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.6rem; overflow: hidden; }
  .tx-card.trade     { border-left: 4px solid #2563eb; }
  .tx-card.waiver    { border-left: 4px solid #16a34a; }
  .tx-card.composite { border-left: 4px solid #7c3aed; }

  .tx-summary { padding: 0.65rem 1rem; cursor: pointer; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; background: #fafafa; }
  .tx-summary:hover { background: #f0f0f0; }
  .tx-meta { display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
  .tx-managers { font-size: 0.87em; color: #444; flex: 1; min-width: 100px; }
  .tx-info { font-size: 0.81em; color: #666; }
  .par-line { font-size: 0.83em; color: #555; }
  .par-line.muted { color: #aaa; font-style: italic; }
  .expand-toggle { margin-left: auto; color: #888; font-size: 0.78em; flex-shrink: 0; }

  .tx-detail { padding: 1rem; border-top: 1px solid #eee; }
  .narrative { font-style: italic; color: #444; margin: 0 0 1rem; font-size: 0.89em; background: #f9f9f9; padding: 0.5rem 0.75rem; border-radius: 4px; }

  /* Badges */
  .badge { padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72em; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
  .badge.trade     { background: #dbeafe; color: #1d4ed8; }
  .badge.waiver    { background: #dcfce7; color: #15803d; }
  .badge.composite { background: #ede9fe; color: #6d28d9; }
  .badge.pick      { background: #fef3c7; color: #92400e; }
  .grade-badge { padding: 0.18rem 0.5rem; border-radius: 4px; font-size: 0.79em; font-weight: 700; text-transform: capitalize; }
  .grade-lopsided  { background: #fef2f2; color: #dc2626; }
  .grade-clear     { background: #f0fdf4; color: #16a34a; }
  .grade-close     { background: #fffbeb; color: #d97706; }
  .grade-even      { background: #f3f4f6; color: #6b7280; }
  .grade-elite     { background: #fef3c7; color: #92400e; }
  .grade-strong    { background: #d1fae5; color: #065f46; }
  .grade-solid     { background: #e0f2fe; color: #0369a1; }
  .grade-breakeven { background: #f3f4f6; color: #6b7280; }
  .grade-poor      { background: #fef2f2; color: #dc2626; }
  .tag  { background: #e5e7eb; color: #374151; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.76em; }
  .tag.stream { background: #e0f2fe; color: #0369a1; }

  /* Trade sides */
  .sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
  .side { padding: 0.75rem; border-radius: 6px; background: #f8f8f8; border: 2px solid transparent; }
  .side.winner { background: #f0fff4; border-color: #34d399; }
  .side-header { font-weight: 700; margin-bottom: 0.35rem; font-size: 0.93em; }
  .side-total { font-size: 0.85em; color: #555; margin-bottom: 0.6rem; }

  /* Player blocks */
  .player-block { background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.65rem; margin-top: 0.5rem; }
  .p-name-row { display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.25rem; }
  .pos { background: #e5e7eb; border-radius: 3px; padding: 0.1rem 0.35rem; font-size: 0.73em; font-weight: 700; }
  .p-stats { font-size: 0.82em; color: #555; margin-bottom: 0.3rem; }
  .dropped { font-size: 0.81em; color: #999; margin-top: 0.15rem; }

  /* Baseline */
  .baseline-info { font-size: 0.8em; color: #64748b; margin: 0.2rem 0; }
  .baseline-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.55rem 0.7rem; margin: 0.4rem 0; font-size: 0.82em; }
  .bl-header { font-weight: 700; color: #475569; margin-bottom: 0.3rem; font-size: 0.9em; }
  .bl-row { display: flex; gap: 0.35rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 0.18rem; }
  .bl-label { color: #64748b; flex-shrink: 0; }
  .muted { color: #94a3b8; font-size: 0.9em; }
  .formula { font-family: monospace; font-size: 0.88em; background: #f1f5f9; padding: 0.3rem 0.5rem; border-radius: 3px; margin-top: 0.25rem; }

  /* Week tables */
  .wk-section { margin-top: 0.5rem; }
  .wk-table { width: 100%; border-collapse: collapse; font-size: 0.81em; margin-top: 0.2rem; }
  .wk-table th, .wk-table td { border: 1px solid #e5e7eb; padding: 0.22rem 0.4rem; text-align: center; }
  .wk-table th { background: #f1f5f9; font-weight: 600; }
  .wk-table .totals td { background: #f8fafc; font-weight: 700; }

  /* Waiver layout */
  .waiver-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
  .w-section { background: #f8f8f8; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.65rem; }
  .w-header { font-weight: 700; color: #475569; font-size: 0.83em; margin-bottom: 0.35rem; }

  /* Misc */
  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }
  .warn { color: #d97706; font-size: 0.82em; font-style: italic; margin-top: 0.25rem; }
  .flags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
  .flag { padding: 0.18rem 0.5rem; border-radius: 4px; font-size: 0.79em; }
  .flag-injury-suspected { background: #fff7ed; color: #c2410c; }
  .flag-underutilized    { background: #faf5ff; color: #7e22ce; }
  .constituent { font-size: 0.74em; color: #aaa; margin-top: 0.5rem; }
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; margin-top: 1rem; font-size: 0.8em; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul  { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li  { margin-bottom: 0.18rem; }
</style>
