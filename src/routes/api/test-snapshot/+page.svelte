<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getAllSeasonsHistory } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getAllDrafts } from '$lib/utils/dataEngine/allDrafts.js';
  import { gradeDraftPreSeason, gradeDraftEndOfSeason } from '$lib/utils/dataEngine/draftAnalysis.js';
  import { getSeasonStatTotals } from '$lib/utils/dataEngine/allPlayerSeasonStats.js';
  import { teamManagersStore } from '$lib/stores';

  let allTimeHistory   = null;
  let allDrafts        = [];
  let loadingDrafts    = false;
  let draftDebug       = [];
  let showSimDebug     = false;
  let showDraftDebug   = false;

  let selectedDraftYear = null;
  let selectedDraft     = null;
  let preSeasonGrade    = null;
  let endOfSeasonGrade  = null;
  let activeTab         = 'end'; // start on end-of-season since that's the focus

  $: draftYearOptions = allDrafts.map((d) => d.year).sort((a, b) => b - a);

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
    if (label.includes('steal') || label === 'value') return 'vl-steal';
    if (label.includes('bust'))                        return 'vl-bust';
    if (label.includes('reach'))                       return 'vl-reach';
    return 'vl-neutral';
  }

  function injuryIcon(flag) {
    if (flag === 'major-injury') return '🚑';
    if (flag === 'injury')       return '🤕';
    return '';
  }

  async function loadDraftData() {
    loadingDrafts = true;
    draftDebug = [];

    try {
      await getLeagueTeamManagers();

      if (!allTimeHistory) {
        draftDebug.push('Loading all-time history...');
        allTimeHistory = await getAllSeasonsHistory();
        draftDebug.push(`Player database: ${Object.keys(allTimeHistory.allPlayersData || {}).length} players.`);
      }

      draftDebug.push('Fetching draft data...');
      allDrafts = await getAllDrafts(allTimeHistory.allPlayersData || {});
      draftDebug.push(`Loaded ${allDrafts.length} draft(s): ${allDrafts.map((d) => d.year).join(', ')}`);
      draftDebug.push(`League settings per draft:`);
      allDrafts.forEach((d) => {
        draftDebug.push(`  ${d.year}: QB×${d.leagueSettings?.QB} RB×${d.leagueSettings?.RB} WR×${d.leagueSettings?.WR} TE×${d.leagueSettings?.TE} FLEX×${d.leagueSettings?.FLEX} K×${d.leagueSettings?.K} DEF×${d.leagueSettings?.DEF} Rounds:${d.rounds}`);
      });

      if (allDrafts.length > 0) {
        selectedDraftYear = allDrafts[0].year;
        await analyzeDraft(selectedDraftYear);
      }
    } catch (e) {
      console.error('Draft load error:', e);
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

    draftDebug.push(`Analyzing ${year} draft — ${selectedDraft.picks.length} picks, ${selectedDraft.rounds} rounds, ${selectedDraft.numTeams} teams.`);

    // Pre-season grade (no stats needed)
    preSeasonGrade = gradeDraftPreSeason(selectedDraft);
    draftDebug.push(`Pre-season grade ready for ${year}.`);

    // End-of-season grade — needs actual stats
    const seasonOutput   = allTimeHistory?.seasons?.find((s) => String(s.year) === String(year));
    const scoringSettings = allTimeHistory?.sharedScoringSettings || seasonOutput?.scoringSettings || null;

    draftDebug.push(`Fetching ${year} season stats for end-of-season grade...`);

    const statsResult = await getSeasonStatTotals(year, scoringSettings).catch((err) => {
      draftDebug.push(`Stats fetch failed for ${year}: ${err.message}`);
      return null;
    });

    if (statsResult) {
      const statCount = Object.keys(statsResult.totals || {}).length;
      draftDebug.push(`${year} stats: ${statCount} players. Games played tracked: ${Object.keys(statsResult.gamesPlayed || {}).length} players.`);

      endOfSeasonGrade = gradeDraftEndOfSeason(
        selectedDraft,
        statsResult.totals,
        statsResult.gamesPlayed,
        allTimeHistory?.allPlayersData || {}
      );

      if (endOfSeasonGrade) {
        draftDebug.push(`End-of-season grade ready. Simulation debug:`);
        draftDebug.push(...(endOfSeasonGrade.simulationDebug || []));
      }
    } else {
      draftDebug.push(`No stats for ${year} — end-of-season grade unavailable.`);
    }
  }

  onMount(async () => {
    await getLeagueTeamManagers().catch(() => {});
  });
</script>

<main class="container">
  <h2>Draft Analysis</h2>

  <div class="control-row">
    <button on:click={loadDraftData} disabled={loadingDrafts}>
      {loadingDrafts ? 'Loading...' : (allDrafts.length > 0 ? 'Reload Draft Data' : 'Load Draft Data')}
    </button>
  </div>

  {#if loadingDrafts}
    <div class="status-msg">Fetching drafts and simulating optimal outcomes...</div>
  {:else if allDrafts.length > 0}

    <div class="control-row">
      <label><strong>Season:</strong></label>
      <select bind:value={selectedDraftYear}
        on:change={async () => { await analyzeDraft(selectedDraftYear); }}>
        {#each draftYearOptions as yr}
          <option value={yr}>{yr}</option>
        {/each}
      </select>

      <div class="tab-group">
        <button class="tab-btn {activeTab === 'end' ? 'active' : ''}"
          on:click={() => (activeTab = 'end')}>
          End-of-Season Grade
        </button>
        <button class="tab-btn {activeTab === 'pre' ? 'active' : ''}"
          on:click={() => (activeTab = 'pre')}>
          Pre-Season Grade
        </button>
      </div>
    </div>

    <!-- ── END-OF-SEASON GRADE ───────────────────────────────────────────── -->
    {#if activeTab === 'end'}
      {#if endOfSeasonGrade}
        <h3>{endOfSeasonGrade.year} Draft — End-of-Season Grade</h3>
        <div class="explainer">
          <strong>Method:</strong> Simulates an optimal snake draft using actual season production
          (rounds 1-2 = RB/WR only, rounds 3-5 = adds QB/TE, rounds 6+ = all skill, last 2 = K/DEF).
          <strong>PAR</strong> = actual pts − expected pts at that pick slot.
          Positive = outperformed draft slot. Negative = underperformed.
          🤕 = played fewer than 8 games (injury-affected but still counted as underperformance).
        </div>

        <!-- Team rankings table -->
        <h4>Team Draft Grades</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th><th>Manager</th><th>Grade</th>
              <th>Total PAR</th><th>Inj-Adj PAR</th>
              <th>Actual Pts</th><th>Expected Pts</th>
              <th>Injured Picks</th><th>Best Pick</th><th>Worst Pick</th>
            </tr>
          </thead>
          <tbody>
            {#each endOfSeasonGrade.teamRankings as team, idx}
              <tr>
                <td>#{idx + 1}</td>
                <td>{managerDisplayName(team.managerId)}</td>
                <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                <td class="{parClass(team.totalPAR)}">
                  {(team.totalPAR || 0) >= 0 ? '+' : ''}{fp(team.totalPAR)}
                </td>
                <td class="{parClass(team.injuryAdjustedPAR)}">
                  {(parseFloat(team.injuryAdjustedPAR) || 0) >= 0 ? '+' : ''}{team.injuryAdjustedPAR}
                </td>
                <td>{fp(team.totalActualPts)}</td>
                <td>{fp(team.totalExpectedPts)}</td>
                <td>
                  {#if team.injured.length > 0}
                    <span class="injury-count">🤕 {team.injured.length}</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.bestPick}
                    {team.bestPick.playerName} (R{team.bestPick.round})
                    <span class="vl-tag vl-steal">+{fp(team.bestPick.par)}</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.worstPick}
                    {team.worstPick.playerName} (R{team.worstPick.round})
                    {#if team.worstPick.injuryFlag}
                      <span class="injury-tag">{injuryIcon(team.worstPick.injuryFlag)}</span>
                    {/if}
                    <span class="vl-tag vl-bust">{fp(team.worstPick.par)}</span>
                  {:else}—{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Steals and busts side by side -->
        <div class="two-col">
          <div>
            <h4>🔥 Biggest Steals (League-Wide)</h4>
            <table class="data-table">
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Pick</th><th>Actual</th><th>Expected</th><th>PAR</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each endOfSeasonGrade.leagueTopSteals as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td>{pick.pos}</td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>{fp(pick.actualPts)}</td>
                    <td>{fp(pick.expectedPts)}</td>
                    <td class="positive">+{fp(pick.par)}</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div>
            <h4>💀 Biggest Busts (League-Wide)</h4>
            <table class="data-table">
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Pick</th><th>Actual</th><th>Expected</th><th>PAR</th><th>Inj?</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each endOfSeasonGrade.leagueTopBusts as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td>{pick.pos}</td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>{fp(pick.actualPts)}</td>
                    <td>{fp(pick.expectedPts)}</td>
                    <td class="negative">{fp(pick.par)}</td>
                    <td>{injuryIcon(pick.injuryFlag) || '—'}</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Per-team full breakdowns -->
        <h4>Full Pick Breakdown by Team</h4>
        {#each endOfSeasonGrade.teamRankings as team}
          <div class="team-block">
            <div class="team-header">
              <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
              <strong>{managerDisplayName(team.managerId)}</strong>
              <span class="muted">
                PAR: <span class="{parClass(team.totalPAR)}">{(team.totalPAR || 0) >= 0 ? '+' : ''}{fp(team.totalPAR)}</span>
                · {fp(team.totalActualPts)} actual / {fp(team.totalExpectedPts)} expected
                {#if team.injured.length > 0}
                  · <span class="injury-count">🤕 {team.injured.length} injury-affected pick(s)</span>
                  · Inj-adj PAR: <span class="{parClass(team.injuryAdjustedPAR)}">{team.injuryAdjustedPAR}</span>
                {/if}
              </span>
            </div>

            <!-- Pick table -->
            <table class="data-table mini">
              <thead>
                <tr>
                  <th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th>
                  <th>Actual</th><th>Expected</th><th>PAR</th>
                  <th>Games</th><th>Label</th>
                </tr>
              </thead>
              <tbody>
                {#each team.picks.sort((a, b) => a.pickNo - b.pickNo) as pick}
                  <tr class="{pick.injuryFlag ? 'injury-row' : ''}">
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>
                      {pick.playerName}
                      {#if pick.injuryFlag}
                        <span title="{pick.injuryFlag === 'major-injury' ? 'Major injury — played <4 games' : 'Injury-affected — played <8 games'}">
                          {injuryIcon(pick.injuryFlag)}
                        </span>
                      {/if}
                    </td>
                    <td>{pick.pos}</td>
                    <td>{fp(pick.actualPts)}</td>
                    <td>{fp(pick.expectedPts)}</td>
                    <td class="{parClass(pick.par)}">
                      {pick.par != null ? ((pick.par || 0) >= 0 ? '+' : '') + fp(pick.par) : '—'}
                    </td>
                    <td class="{pick.injuryFlag ? 'negative' : ''}">
                      {pick.gamesPlayed != null ? pick.gamesPlayed : '—'}
                    </td>
                    <td><span class="vl-tag {valueLabelClass(pick.valueLabel)}">{pick.valueLabel}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>

            <!-- Positional breakdown -->
            <div class="pos-breakdown">
              {#each Object.entries(team.positionalBreakdown).sort(([a],[b]) => a.localeCompare(b)) as [pos, data]}
                <div class="pos-card">
                  <div class="pos-label">{pos}</div>
                  <div class="pos-stat">{data.picks} picks</div>
                  <div class="pos-stat">{fp(data.totalPts)} pts</div>
                  <div class="pos-par {data.totalPAR >= 0 ? 'positive' : 'negative'}">
                    {data.totalPAR >= 0 ? '+' : ''}{fp(data.totalPAR)} PAR
                  </div>
                </div>
              {/each}
            </div>

            <!-- Round-by-round PAR -->
            <div class="round-breakdown">
              <span class="muted" style="margin-right:0.5rem;">PAR by round:</span>
              {#each Object.entries(team.byRound).sort(([a],[b]) => Number(a)-Number(b)) as [rnd, data]}
                <span class="round-pill {data.totalPAR >= 0 ? 'positive-bg' : 'negative-bg'}">
                  R{rnd}: {data.totalPAR >= 0 ? '+' : ''}{fp(data.totalPAR)}
                </span>
              {/each}
            </div>
          </div>
        {/each}

        <!-- Expected curve reference -->
        <h4>Expected Points Curve (Optimal Simulation)</h4>
        <p class="muted">
          The baseline each pick is compared against. Phase 1 (picks 1-24): RB/WR only.
          Phase 2 (picks 25-60): adds QB/TE. Phase 3 (picks 61+): all skill positions.
          Last 2 rounds: adds K/DEF.
        </p>
        <table class="data-table mini">
          <thead>
            <tr>
              {#each [1,2,3,4,5,6,7,8,9,10,11,12] as col}
                <th>Pick {col}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each Array.from({length: endOfSeasonGrade.totalPicks / 12}, (_, r) => r) as row}
              <tr>
                {#each Array.from({length: 12}, (_, c) => row * 12 + c + 1) as pickNo}
                  <td class="curve-cell">
                    <div class="curve-pick">#{pickNo}</div>
                    <div class="curve-pts">{fp(endOfSeasonGrade.expectedCurve[pickNo])}</div>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Simulation debug -->
        <div class="control-row" style="margin-top:0.5rem;">
          <button class="link-btn" on:click={() => (showSimDebug = !showSimDebug)}>
            {showSimDebug ? 'Hide' : 'Show'} Simulation Debug (first/last round picks)
          </button>
        </div>
        {#if showSimDebug}
          <div class="debug-terminal">
            <h4>Simulation Log</h4>
            <ul>
              {#each (endOfSeasonGrade.simulationDebug || []) as line}
                <li><code>{line}</code></li>
              {/each}
            </ul>
          </div>
        {/if}

      {:else}
        <div class="status-msg">
          End-of-season grade not yet available for {selectedDraftYear}.
          {#if !allTimeHistory}Click "Load Draft Data" to begin.{/if}
        </div>
      {/if}

    <!-- ── PRE-SEASON GRADE ──────────────────────────────────────────────── -->
    {:else if activeTab === 'pre'}
      {#if preSeasonGrade}
        <h3>{preSeasonGrade.year} Draft — Pre-Season Grade</h3>
        <div class="explainer">
          Grades based on positional scarcity within the draft itself.
          <strong>vs Market</strong> = how many picks earlier/later than average for that positional slot.
          Positive = got the player cheaper than market value.
        </div>

        <h4>Team Draft Grades</h4>
        <table class="data-table">
          <thead>
            <tr><th>Rank</th><th>Manager</th><th>Grade</th><th>Avg vs Market</th><th>Best Pick</th><th>Worst Pick</th></tr>
          </thead>
          <tbody>
            {#each preSeasonGrade.teamRankings as team, idx}
              <tr>
                <td>#{idx + 1}</td>
                <td>{managerDisplayName(team.managerId)}</td>
                <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                <td class="{(team.avgVsMarket || 0) >= 0 ? 'positive' : 'negative'}">
                  {(team.avgVsMarket || 0) >= 0 ? '+' : ''}{fp(team.avgVsMarket)} picks
                </td>
                <td>
                  {#if team.bestValuePick}
                    {team.bestValuePick.playerName} ({team.bestValuePick.pos}, R{team.bestValuePick.round})
                    <span class="vl-tag vl-steal">+{fp(team.bestValuePick.vsMarket)}</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.worstValuePick}
                    {team.worstValuePick.playerName} ({team.worstValuePick.pos}, R{team.worstValuePick.round})
                    <span class="vl-tag vl-bust">{fp(team.worstValuePick.vsMarket)}</span>
                  {:else}—{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <div class="two-col">
          <div>
            <h4>Best Value Picks</h4>
            <table class="data-table">
              <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Picked</th><th>Avg At Slot</th><th>Value</th><th>Manager</th></tr></thead>
              <tbody>
                {#each preSeasonGrade.leagueTopSteals as pick}
                  <tr>
                    <td>{pick.playerName}</td><td>{pick.pos}</td>
                    <td>{pick.round}</td><td>#{pick.pickNo}</td>
                    <td>#{fp(pick.avgPickAtRank, 0)}</td>
                    <td class="positive">+{fp(pick.vsMarket)} picks early</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div>
            <h4>Biggest Reaches</h4>
            <table class="data-table">
              <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>Picked</th><th>Avg At Slot</th><th>Reach</th><th>Manager</th></tr></thead>
              <tbody>
                {#each preSeasonGrade.leagueTopReaches as pick}
                  <tr>
                    <td>{pick.playerName}</td><td>{pick.pos}</td>
                    <td>{pick.round}</td><td>#{pick.pickNo}</td>
                    <td>#{fp(pick.avgPickAtRank, 0)}</td>
                    <td class="negative">{fp(pick.vsMarket)} picks late</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {:else}
        <div class="status-msg">Pre-season grade not available for {selectedDraftYear}.</div>
      {/if}
    {/if}

    <!-- Debug toggles -->
    <div class="control-row" style="margin-top:1rem;">
      <button on:click={() => (showDraftDebug = !showDraftDebug)}>
        {showDraftDebug ? 'Hide' : 'Show'} Debug Logs
      </button>
    </div>
    {#if showDraftDebug && draftDebug.length > 0}
      <div class="debug-terminal">
        <h4>Draft Debug Logs</h4>
        <ul>{#each draftDebug as log}<li><code>{log}</code></li>{/each}</ul>
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
  .link-btn { background: none; border: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 0.88rem; text-decoration: underline; }
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .muted { color: #888; font-size: 0.87em; }
  .explainer { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.87rem; color: #0c4a6e; }

  /* Tabs */
  .tab-group { display: flex; gap: 0.5rem; }
  .tab-btn { padding: 0.4rem 1rem; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.9rem; }
  .tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }

  /* Tables */
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.87rem; }
  .data-table.mini { font-size: 0.81rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.32rem 0.5rem; text-align: center; }
  .data-table th { background: #f5f5f5; font-weight: 600; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .injury-row { background: #fff7ed; }

  /* Team blocks */
  .team-block { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1.25rem; overflow: hidden; }
  .team-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: #f9f9f9; border-bottom: 1px solid #eee; flex-wrap: wrap; }

  /* Grade badges */
  .grade-badge { padding: 0.18rem 0.55rem; border-radius: 4px; font-weight: 700; font-size: 0.84em; }
  .grade-a { background: #d1fae5; color: #065f46; }
  .grade-b { background: #e0f2fe; color: #0369a1; }
  .grade-c { background: #fef3c7; color: #92400e; }
  .grade-d { background: #fed7aa; color: #9a3412; }
  .grade-f { background: #fef2f2; color: #dc2626; }

  /* Value label tags */
  .vl-tag { display: inline-block; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.77em; font-weight: 600; margin-left: 0.2rem; }
  .vl-steal { background: #d1fae5; color: #065f46; }
  .vl-bust  { background: #fef2f2; color: #dc2626; }
  .vl-reach { background: #fff7ed; color: #c2410c; }
  .vl-neutral { background: #f3f4f6; color: #6b7280; }

  /* Injury */
  .injury-count { color: #d97706; font-weight: 600; font-size: 0.88em; }
  .injury-tag   { margin-left: 0.2rem; }

  /* Positional breakdown */
  .pos-breakdown { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.65rem 1rem; background: #fafafa; border-top: 1px solid #eee; }
  .pos-card { background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.35rem 0.55rem; min-width: 65px; text-align: center; }
  .pos-label { font-weight: 700; font-size: 0.78em; color: #374151; }
  .pos-stat  { font-size: 0.76em; color: #555; }
  .pos-par   { font-size: 0.8em; font-weight: 700; }

  /* Round breakdown */
  .round-breakdown { display: flex; gap: 0.4rem; flex-wrap: wrap; padding: 0.5rem 1rem; background: #f8f8f8; border-top: 1px solid #eee; font-size: 0.82em; align-items: center; }
  .round-pill { padding: 0.15rem 0.45rem; border-radius: 3px; font-size: 0.85em; }
  .positive-bg { background: #d1fae5; color: #065f46; }
  .negative-bg { background: #fef2f2; color: #dc2626; }

  /* Expected curve table */
  .curve-cell { padding: 0.2rem !important; min-width: 55px; }
  .curve-pick { font-size: 0.72em; color: #999; }
  .curve-pts  { font-size: 0.85em; font-weight: 600; }

  /* Two-column layout */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }

  /* PAR colors */
  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }

  /* Debug */
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.8em; margin-top: 1rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.18rem; }
</style>
