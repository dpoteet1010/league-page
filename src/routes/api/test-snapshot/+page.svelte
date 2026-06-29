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
  let showDraftDebug   = false;

  let selectedDraftYear = null;
  let selectedDraft     = null;
  let preSeasonGrade    = null;
  let endOfSeasonGrade  = null;
  let activeTab         = 'end';

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

  function injuryIcon(flag) {
    if (flag === 'major-injury') return '🚑';
    if (flag === 'injury')       return '🤕';
    return '';
  }

  function signedFp(val, d = 1) {
    const n = typeof val === 'string' ? parseFloat(val) : val;
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(d);
  }

  async function loadDraftData() {
    loadingDrafts = true;
    draftDebug = [];

    try {
      await getLeagueTeamManagers();

      if (!allTimeHistory) {
        draftDebug.push('Loading all-time history (needed for replacement levels)...');
        allTimeHistory = await getAllSeasonsHistory();
        draftDebug.push(`Player database: ${Object.keys(allTimeHistory.allPlayersData || {}).length} players.`);
        draftDebug.push(`PAR tables built for seasons: ${Object.keys(allTimeHistory.parTablesBySeason || {}).join(', ')}`);
      }

      draftDebug.push('Fetching draft data...');
      allDrafts = await getAllDrafts(allTimeHistory.allPlayersData || {});
      draftDebug.push(`Loaded ${allDrafts.length} draft(s): ${allDrafts.map((d) => d.year).join(', ')}`);

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

    draftDebug.push(`--- Analyzing ${year} draft (${selectedDraft.picks.length} picks) ---`);

    // Pre-season: no external data needed
    preSeasonGrade = gradeDraftPreSeason(selectedDraft);

    // End-of-season: needs stats + PAR tables
    const parTables = allTimeHistory?.parTablesBySeason?.[String(year)];
    if (!parTables) {
      draftDebug.push(`No PAR tables for ${year} — end-of-season grade unavailable.`);
      return;
    }

    const scoringSettings = allTimeHistory?.sharedScoringSettings || null;
    draftDebug.push(`Fetching ${year} season stats...`);

    const statsResult = await getSeasonStatTotals(year, scoringSettings).catch((err) => {
      draftDebug.push(`Stats fetch failed: ${err.message}`);
      return null;
    });

    if (!statsResult) return;

    draftDebug.push(`${year} stats: ${Object.keys(statsResult.totals || {}).length} players.`);

    endOfSeasonGrade = gradeDraftEndOfSeason(
      selectedDraft,
      statsResult.totals,
      statsResult.gamesPlayed,
      parTables,
      allTimeHistory?.allPlayersData || {}
    );

    if (endOfSeasonGrade) {
      draftDebug.push(...(endOfSeasonGrade.debug || []));
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
      {loadingDrafts
        ? 'Loading...'
        : allDrafts.length > 0 ? 'Reload Draft Data' : 'Load Draft Data'}
    </button>
  </div>

  {#if loadingDrafts}
    <div class="status-msg">Loading drafts and computing PAR grades...</div>

  {:else if allDrafts.length > 0}

    <!-- Season + tab selector -->
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
          on:click={() => (activeTab = 'end')}>End-of-Season Grade</button>
        <button class="tab-btn {activeTab === 'pre' ? 'active' : ''}"
          on:click={() => (activeTab = 'pre')}>Pre-Season Grade</button>
      </div>
    </div>

    <!-- ── END-OF-SEASON TAB ─────────────────────────────────────────────── -->
    {#if activeTab === 'end'}
      {#if endOfSeasonGrade}

        <h3>{endOfSeasonGrade.year} — End-of-Season Draft Grade</h3>
        <div class="explainer">
          <strong>PAR</strong> = actual season points − replacement level for that position.
          Replacement level is the same baseline used for trade/waiver grading
          (Nth-best player at each position, where N = total starting slots across the league).
          Grade labels adjust by round — negative PAR in round 1 is a bust; negative PAR in
          round 12 is expected. 🤕 = injury-affected (under 8 games) — still counts as underperformance.
        </div>

        <!-- Replacement level reference -->
        <div class="rep-levels">
          <span class="rep-label">Replacement levels used:</span>
          {#each Object.entries(endOfSeasonGrade.replacementLevels || {}) as [pos, pts]}
            <span class="rep-pill">
              {pos}: {fp(pts)} pts
              <span class="rep-name">({endOfSeasonGrade.replacementNames?.[pos] || '?'})</span>
            </span>
          {/each}
        </div>

        <!-- Team rankings -->
        <h4>Team Draft Grades</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th><th>Manager</th><th>Grade</th>
              <th>Total PAR</th><th>Excl. Injuries</th>
              <th>Actual Pts</th><th>Injured Picks</th>
              <th>Best Pick</th><th>Worst Pick</th>
            </tr>
          </thead>
          <tbody>
            {#each endOfSeasonGrade.teamRankings as team, idx}
              <tr>
                <td>#{idx + 1}</td>
                <td><strong>{managerDisplayName(team.managerId)}</strong></td>
                <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                <td class="{parClass(team.totalPAR)}">{signedFp(team.totalPAR)}</td>
                <td class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</td>
                <td>{fp(team.totalActualPts)}</td>
                <td>
                  {#if team.injured.length > 0}
                    <span class="injury-count">🤕 {team.injured.length}</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.bestPick}
                    {team.bestPick.playerName}
                    <span class="pos-tag">{team.bestPick.pos}</span>
                    R{team.bestPick.round}
                    <span class="vl-tag vl-steal">{signedFp(team.bestPick.par)} PAR</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.worstPick}
                    {team.worstPick.playerName}
                    <span class="pos-tag">{team.worstPick.pos}</span>
                    R{team.worstPick.round}
                    {injuryIcon(team.worstPick.injuryFlag)}
                    <span class="vl-tag vl-bust">{signedFp(team.worstPick.par)} PAR</span>
                  {:else}—{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Steals and busts -->
        <div class="two-col">
          <div>
            <h4>🔥 Biggest Steals</h4>
            <table class="data-table">
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Pick</th><th>Actual</th><th>Rep Level</th><th>PAR</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each endOfSeasonGrade.leagueTopSteals as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td>{pick.pos}</td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>{fp(pick.actualPts)}</td>
                    <td>{fp(pick.repLevel)}</td>
                    <td class="positive">{signedFp(pick.par)}</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div>
            <h4>💀 Biggest Busts</h4>
            <table class="data-table">
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Pick</th><th>Actual</th><th>Rep Level</th><th>PAR</th><th>Inj</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each endOfSeasonGrade.leagueTopBusts as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td>{pick.pos}</td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>{fp(pick.actualPts)}</td>
                    <td>{fp(pick.repLevel)}</td>
                    <td class="negative">{signedFp(pick.par)}</td>
                    <td>{injuryIcon(pick.injuryFlag) || '—'}</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Per-team full breakdowns -->
        <h4>Full Breakdown by Team</h4>
        {#each endOfSeasonGrade.teamRankings as team}
          <div class="team-block">
            <!-- Team header -->
            <div class="team-header">
              <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
              <strong>{managerDisplayName(team.managerId)}</strong>
              <span class="header-par">
                PAR: <span class="{parClass(team.totalPAR)}">{signedFp(team.totalPAR)}</span>
              </span>
              {#if team.injured.length > 0}
                <span class="muted">
                  · 🤕 {team.injured.length} inj-affected
                  · excl. injuries: <span class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</span>
                </span>
              {/if}
            </div>

            <!-- Pick table -->
            <div class="table-scroll">
              <table class="data-table mini">
                <thead>
                  <tr>
                    <th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th>
                    <th>Actual Pts</th><th>Rep Level</th><th>PAR</th>
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
                          <span title="{pick.injuryFlag === 'major-injury'
                            ? 'Major injury — played under 4 games'
                            : 'Injury-affected — played under 8 games'}">
                            {injuryIcon(pick.injuryFlag)}
                          </span>
                        {/if}
                      </td>
                      <td><span class="pos-tag">{pick.pos}</span></td>
                      <td>{fp(pick.actualPts)}</td>
                      <td class="muted">{fp(pick.repLevel)}</td>
                      <td class="{parClass(pick.par)}">
                        {pick.par != null ? signedFp(pick.par) : '—'}
                      </td>
                      <td class="{pick.injuryFlag ? 'negative' : 'muted'}">
                        {pick.gamesPlayed != null ? pick.gamesPlayed : '—'}
                      </td>
                      <td>
                        <span class="vl-tag {valueLabelClass(pick.valueLabel)}">
                          {pick.valueLabel}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Positional breakdown -->
            <div class="pos-breakdown">
              {#each Object.entries(team.byPosition).sort(([a],[b]) => a.localeCompare(b)) as [pos, data]}
                <div class="pos-card">
                  <div class="pos-label">{pos}</div>
                  <div class="pos-stat">{data.picks} picks</div>
                  <div class="pos-stat">{fp(data.totalActualPts)} pts</div>
                  <div class="pos-par {data.totalPAR >= 0 ? 'positive' : 'negative'}">
                    {signedFp(data.totalPAR)} PAR
                  </div>
                </div>
              {/each}
            </div>

            <!-- Round-by-round PAR -->
            <div class="round-breakdown">
              <span class="muted">PAR by round:</span>
              {#each Object.entries(team.byRound).sort(([a],[b]) => Number(a) - Number(b)) as [rnd, data]}
                <span class="round-pill {data.totalPAR >= 0 ? 'positive-bg' : 'negative-bg'}">
                  R{rnd}: {signedFp(data.totalPAR)}
                </span>
              {/each}
            </div>
          </div>
        {/each}

      {:else}
        <div class="status-msg">
          {#if !allTimeHistory}
            Click "Load Draft Data" to begin.
          {:else}
            End-of-season grade not available for {selectedDraftYear} —
            check debug logs for details.
          {/if}
        </div>
      {/if}

    <!-- ── PRE-SEASON TAB ────────────────────────────────────────────────── -->
    {:else if activeTab === 'pre'}
      {#if preSeasonGrade}
        <h3>{preSeasonGrade.year} — Pre-Season Draft Grade</h3>
        <div class="explainer">
          Grades based on positional scarcity within the draft itself.
          <strong>vs Market</strong> = how many picks earlier/later than the average
          for that positional slot across the league. Positive = better value than average.
        </div>

        <h4>Team Grades</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th><th>Manager</th><th>Grade</th>
              <th>Avg vs Market</th><th>Best Pick</th><th>Worst Pick</th>
            </tr>
          </thead>
          <tbody>
            {#each preSeasonGrade.teamRankings as team, idx}
              <tr>
                <td>#{idx + 1}</td>
                <td><strong>{managerDisplayName(team.managerId)}</strong></td>
                <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                <td class="{(team.avgVsMarket || 0) >= 0 ? 'positive' : 'negative'}">
                  {signedFp(team.avgVsMarket)} picks
                </td>
                <td>
                  {#if team.bestValuePick}
                    {team.bestValuePick.playerName}
                    <span class="pos-tag">{team.bestValuePick.pos}</span>
                    R{team.bestValuePick.round}
                    <span class="vl-tag vl-steal">{signedFp(team.bestValuePick.vsMarket)}</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.worstValuePick}
                    {team.worstValuePick.playerName}
                    <span class="pos-tag">{team.worstValuePick.pos}</span>
                    R{team.worstValuePick.round}
                    <span class="vl-tag vl-bust">{signedFp(team.worstValuePick.vsMarket)}</span>
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
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Picked At</th><th>Avg At Slot</th><th>Value</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each preSeasonGrade.leagueTopSteals as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td>{pick.pos}</td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>#{fp(pick.avgPickAtRank, 0)}</td>
                    <td class="positive">{signedFp(pick.vsMarket)} picks</td>
                    <td>{managerDisplayName(pick.managerId)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div>
            <h4>Biggest Reaches</h4>
            <table class="data-table">
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Picked At</th><th>Avg At Slot</th><th>Reach</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each preSeasonGrade.leagueTopReaches as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td>{pick.pos}</td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>#{fp(pick.avgPickAtRank, 0)}</td>
                    <td class="negative">{signedFp(pick.vsMarket)} picks</td>
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

    <!-- Debug -->
    <div class="control-row" style="margin-top:1rem;">
      <button on:click={() => (showDraftDebug = !showDraftDebug)}>
        {showDraftDebug ? 'Hide' : 'Show'} Debug Logs
      </button>
    </div>
    {#if showDraftDebug && draftDebug.length > 0}
      <div class="debug-terminal">
        <h4>Debug Logs</h4>
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
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .muted { color: #888; font-size: 0.87em; }
  .explainer { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.87rem; color: #0c4a6e; }

  /* Tabs */
  .tab-group { display: flex; gap: 0.5rem; }
  .tab-btn { padding: 0.4rem 1rem; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.9rem; }
  .tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }

  /* Replacement levels */
  .rep-levels { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 1.25rem; font-size: 0.85rem; }
  .rep-label  { font-weight: 600; color: #374151; }
  .rep-pill   { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.2rem 0.5rem; }
  .rep-name   { color: #888; font-size: 0.9em; }

  /* Tables */
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.87rem; }
  .data-table.mini { font-size: 0.81rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.32rem 0.5rem; text-align: center; }
  .data-table th { background: #f5f5f5; font-weight: 600; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .injury-row { background: #fff7ed; }
  .table-scroll { overflow-x: auto; }

  /* Team blocks */
  .team-block { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1.25rem; overflow: hidden; }
  .team-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: #f9f9f9; border-bottom: 1px solid #eee; flex-wrap: wrap; }
  .header-par { font-size: 0.92em; }

  /* Grades */
  .grade-badge { padding: 0.18rem 0.55rem; border-radius: 4px; font-weight: 700; font-size: 0.84em; }
  .grade-a { background: #d1fae5; color: #065f46; }
  .grade-b { background: #e0f2fe; color: #0369a1; }
  .grade-c { background: #fef3c7; color: #92400e; }
  .grade-d { background: #fed7aa; color: #9a3412; }
  .grade-f { background: #fef2f2; color: #dc2626; }

  /* Value label tags */
  .vl-tag       { display: inline-block; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.77em; font-weight: 600; margin-left: 0.2rem; }
  .vl-steal     { background: #d1fae5; color: #065f46; }
  .vl-value     { background: #e0f2fe; color: #0369a1; }
  .vl-neutral   { background: #f3f4f6; color: #6b7280; }
  .vl-slight-bust { background: #fff7ed; color: #c2410c; }
  .vl-bust      { background: #fef2f2; color: #dc2626; }
  .vl-reach     { background: #fff7ed; color: #c2410c; }

  /* Position tag */
  .pos-tag { background: #e5e7eb; border-radius: 3px; padding: 0.08rem 0.3rem; font-size: 0.74em; font-weight: 700; margin: 0 0.15rem; }

  /* Positional breakdown */
  .pos-breakdown { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.6rem 1rem; background: #fafafa; border-top: 1px solid #eee; }
  .pos-card { background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.35rem 0.55rem; min-width: 65px; text-align: center; }
  .pos-label { font-weight: 700; font-size: 0.78em; color: #374151; }
  .pos-stat  { font-size: 0.76em; color: #555; }
  .pos-par   { font-size: 0.8em; font-weight: 700; }

  /* Round breakdown */
  .round-breakdown { display: flex; gap: 0.4rem; flex-wrap: wrap; padding: 0.5rem 1rem; background: #f8f8f8; border-top: 1px solid #eee; font-size: 0.83em; align-items: center; }
  .round-pill { padding: 0.15rem 0.45rem; border-radius: 3px; font-size: 0.85em; font-weight: 600; }
  .positive-bg { background: #d1fae5; color: #065f46; }
  .negative-bg { background: #fef2f2; color: #dc2626; }

  /* Injury */
  .injury-count { color: #d97706; font-weight: 600; font-size: 0.88em; }

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
