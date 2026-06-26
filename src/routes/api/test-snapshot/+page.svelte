<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getAllSeasonsHistory } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getAllDrafts } from '$lib/utils/dataEngine/allDrafts.js';
  import { gradeDraftPreSeason, gradeDraftEndOfSeason } from '$lib/utils/dataEngine/draftAnalysis.js';
  import { getSeasonStatTotals } from '$lib/utils/dataEngine/allPlayerSeasonStats.js';
  import { teamManagersStore } from '$lib/stores';

  let allTimeHistory  = null;
  let allDrafts       = [];
  let loadingDrafts   = false;
  let draftDebug      = [];

  let selectedDraftYear = null;
  let selectedDraft     = null;
  let preSeasonGrade    = null;
  let endOfSeasonGrade  = null;
  let showDraftDebug    = false;
  let activeTab         = 'pre'; // 'pre' | 'end'

  $: draftYearOptions = allDrafts.map((d) => d.year).sort((a, b) => b - a);

  function managerDisplayName(managerId) {
    if (!managerId) return '?';
    const snap = get(teamManagersStore) || {};
    return snap?.users?.[managerId]?.display_name || `Manager ${managerId}`;
  }

  function fp(val, d = 1) {
    return typeof val === 'number' ? val.toFixed(d) : '—';
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
    if (label.includes('steal') || label === 'value')       return 'positive';
    if (label.includes('bust')  || label.includes('reach')) return 'negative';
    return 'neutral';
  }

  async function loadDraftData() {
    loadingDrafts = true;
    draftDebug = [];

    try {
      await getLeagueTeamManagers();

      if (!allTimeHistory) {
        draftDebug.push('Loading all-time history for player data...');
        allTimeHistory = await getAllSeasonsHistory();
        draftDebug.push(`Player database: ${Object.keys(allTimeHistory.allPlayersData || {}).length} players.`);
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
    selectedDraft     = allDrafts.find((d) => d.year === year) || null;
    preSeasonGrade    = null;
    endOfSeasonGrade  = null;

    if (!selectedDraft) return;

    draftDebug.push(`Analyzing ${year} draft (${selectedDraft.picks.length} picks)...`);

    // Pre-season grade — no stats needed
    preSeasonGrade = gradeDraftPreSeason(selectedDraft);
    draftDebug.push(`Pre-season grade computed for ${year}.`);

    // End-of-season grade — needs actual season stats
    draftDebug.push(`Fetching ${year} season stats for end-of-season grade...`);
    const scoringSettings = allTimeHistory?.parTablesBySeason?.[String(year)]
      ? null // scoring settings handled inside allTimeHistory
      : null;

    // Get scoring settings from the season's league data
    const seasonOutput = allTimeHistory?.seasons?.find((s) => String(s.year) === String(year));
    const scoring = seasonOutput?.scoringSettings || null;

    const seasonStats = await getSeasonStatTotals(year, scoring).catch((err) => {
      draftDebug.push(`Season stats fetch failed for ${year}: ${err.message}`);
      return null;
    });

    if (seasonStats) {
      const statCount = Object.keys(seasonStats).length;
      draftDebug.push(`${year} stats: ${statCount} players with data.`);
      endOfSeasonGrade = gradeDraftEndOfSeason(
        selectedDraft,
        seasonStats,
        allTimeHistory?.allPlayersData || {}
      );
    } else {
      draftDebug.push(`No season stats for ${year} — end-of-season grade unavailable.`);
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
      {loadingDrafts ? 'Loading drafts...' : (allDrafts.length > 0 ? 'Reload Draft Data' : 'Load Draft Data')}
    </button>
  </div>

  {#if loadingDrafts}
    <div class="status-msg">Fetching draft data and season stats...</div>
  {:else if allDrafts.length > 0}

    <!-- Season picker -->
    <div class="control-row">
      <label><strong>Select season:</strong></label>
      <select bind:value={selectedDraftYear}
        on:change={async () => { await analyzeDraft(selectedDraftYear); }}>
        {#each draftYearOptions as yr}
          <option value={yr}>{yr}</option>
        {/each}
      </select>

      {#if selectedDraft}
        <div class="tab-group">
          <button class="tab-btn {activeTab === 'pre' ? 'active' : ''}"
            on:click={() => (activeTab = 'pre')}>
            Pre-Season Grade
          </button>
          <button class="tab-btn {activeTab === 'end' ? 'active' : ''}"
            on:click={() => (activeTab = 'end')}>
            End-of-Season Grade
          </button>
        </div>
      {/if}
    </div>

    <!-- ── PRE-SEASON GRADE ──────────────────────────────────────────────── -->
    {#if activeTab === 'pre' && preSeasonGrade}
      <h3>{preSeasonGrade.year} Pre-Season Draft Grade</h3>
      <p class="sub">
        Grades based on positional scarcity — how early/late each team got players
        relative to when that positional slot typically went in the draft.
        <strong>+vsMarket</strong> = got earlier than average (good value).
        <strong>−vsMarket</strong> = got later than average (reach).
      </p>

      <!-- Team rankings -->
      <h4>Team Draft Grades</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Manager</th>
            <th>Grade</th>
            <th>Avg vs Market</th>
            <th>Best Pick</th>
            <th>Worst Pick</th>
          </tr>
        </thead>
        <tbody>
          {#each preSeasonGrade.teamRankings as team, idx}
            <tr>
              <td>#{idx + 1}</td>
              <td>{managerDisplayName(team.managerId)}</td>
              <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
              <td class="{team.avgVsMarket >= 0 ? 'positive' : 'negative'}">
                {team.avgVsMarket >= 0 ? '+' : ''}{fp(team.avgVsMarket)} picks
              </td>
              <td>
                {#if team.bestValuePick}
                  {team.bestValuePick.playerName} ({team.bestValuePick.pos}, R{team.bestValuePick.round})
                  <span class="val-tag steal">+{fp(team.bestValuePick.vsMarket)}</span>
                {:else}—{/if}
              </td>
              <td>
                {#if team.worstValuePick}
                  {team.worstValuePick.playerName} ({team.worstValuePick.pos}, R{team.worstValuePick.round})
                  <span class="val-tag reach">{fp(team.worstValuePick.vsMarket)}</span>
                {:else}—{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- League-wide steals -->
      <h4>Biggest Steals League-Wide</h4>
      <table class="data-table">
        <thead>
          <tr><th>Player</th><th>Pos</th><th>Round</th><th>Pick</th><th>Avg Pick at Slot</th><th>Value</th><th>Manager</th></tr>
        </thead>
        <tbody>
          {#each preSeasonGrade.leagueTopSteals as pick}
            <tr>
              <td>{pick.playerName}</td>
              <td>{pick.pos}</td>
              <td>{pick.round}</td>
              <td>#{pick.pickNo}</td>
              <td>#{fp(pick.avgPickAtRank, 0)}</td>
              <td class="positive">+{fp(pick.vsMarket)} picks early</td>
              <td>{managerDisplayName(pick.managerId)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- League-wide reaches -->
      <h4>Biggest Reaches League-Wide</h4>
      <table class="data-table">
        <thead>
          <tr><th>Player</th><th>Pos</th><th>Round</th><th>Pick</th><th>Avg Pick at Slot</th><th>Reach</th><th>Manager</th></tr>
        </thead>
        <tbody>
          {#each preSeasonGrade.leagueTopReaches as pick}
            <tr>
              <td>{pick.playerName}</td>
              <td>{pick.pos}</td>
              <td>{pick.round}</td>
              <td>#{pick.pickNo}</td>
              <td>#{fp(pick.avgPickAtRank, 0)}</td>
              <td class="negative">{fp(pick.vsMarket)} picks late</td>
              <td>{managerDisplayName(pick.managerId)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- Full pick-by-pick breakdown — expandable per team -->
      <h4>Full Pick Breakdown</h4>
      {#each preSeasonGrade.teamRankings as team}
        <div class="team-block">
          <div class="team-header">
            <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
            <strong>{managerDisplayName(team.managerId)}</strong>
            <span class="muted">Avg vs market: {team.avgVsMarket >= 0 ? '+' : ''}{fp(team.avgVsMarket)} picks</span>
          </div>
          <table class="data-table mini">
            <thead>
              <tr><th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th><th>Pos Rank</th><th>Avg Pick</th><th>vs Market</th><th>Label</th></tr>
            </thead>
            <tbody>
              {#each team.picks.sort((a,b) => a.pickNo - b.pickNo) as pick}
                <tr>
                  <td>{pick.round}</td>
                  <td>#{pick.pickNo}</td>
                  <td>{pick.playerName}</td>
                  <td>{pick.pos}</td>
                  <td>#{pick.positionalRank}</td>
                  <td>#{fp(pick.avgPickAtRank, 0)}</td>
                  <td class="{(pick.vsMarket || 0) >= 0 ? 'positive' : 'negative'}">
                    {(pick.vsMarket || 0) >= 0 ? '+' : ''}{fp(pick.vsMarket)}
                  </td>
                  <td><span class="val-tag {valueLabelClass(pick.valueLabel)}">{pick.valueLabel}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}

    <!-- ── END-OF-SEASON GRADE ───────────────────────────────────────────── -->
    {:else if activeTab === 'end' && endOfSeasonGrade}
      <h3>{endOfSeasonGrade.year} End-of-Season Draft Grade</h3>
      <p class="sub">
        Grades based on actual season performance vs expected points for each pick slot.
        <strong>PAR</strong> = actual pts − expected pts for that pick number.
        Positive = outperformed slot (steal). Negative = underperformed (bust).
      </p>

      <!-- Team rankings -->
      <h4>Team Draft Grades</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Manager</th>
            <th>Grade</th>
            <th>Total PAR</th>
            <th>Total Actual Pts</th>
            <th>Best Pick</th>
            <th>Worst Pick</th>
          </tr>
        </thead>
        <tbody>
          {#each endOfSeasonGrade.teamRankings as team, idx}
            <tr>
              <td>#{idx + 1}</td>
              <td>{managerDisplayName(team.managerId)}</td>
              <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
              <td class="{(team.totalPAR || 0) >= 0 ? 'positive' : 'negative'}">
                {(team.totalPAR || 0) >= 0 ? '+' : ''}{fp(team.totalPAR)}
              </td>
              <td>{fp(team.totalActualPts)}</td>
              <td>
                {#if team.bestPick}
                  {team.bestPick.playerName} (R{team.bestPick.round})
                  <span class="val-tag steal">+{fp(team.bestPick.par)} PAR</span>
                {:else}—{/if}
              </td>
              <td>
                {#if team.worstPick}
                  {team.worstPick.playerName} (R{team.worstPick.round})
                  <span class="val-tag reach">{fp(team.worstPick.par)} PAR</span>
                {:else}—{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- League steals and busts -->
      <div class="two-col">
        <div>
          <h4>🔥 Biggest Steals</h4>
          <table class="data-table">
            <thead>
              <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Actual</th><th>Expected</th><th>PAR</th><th>Manager</th></tr>
            </thead>
            <tbody>
              {#each endOfSeasonGrade.leagueTopSteals as pick}
                <tr>
                  <td>{pick.playerName}</td>
                  <td>{pick.pos}</td>
                  <td>{pick.round}</td>
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
          <h4>💀 Biggest Busts</h4>
          <table class="data-table">
            <thead>
              <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Actual</th><th>Expected</th><th>PAR</th><th>Manager</th></tr>
            </thead>
            <tbody>
              {#each endOfSeasonGrade.leagueTopBusts as pick}
                <tr>
                  <td>{pick.playerName}</td>
                  <td>{pick.pos}</td>
                  <td>{pick.round}</td>
                  <td>{fp(pick.actualPts)}</td>
                  <td>{fp(pick.expectedPts)}</td>
                  <td class="negative">{fp(pick.par)}</td>
                  <td>{managerDisplayName(pick.managerId)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Full per-team breakdown -->
      <h4>Full Pick Breakdown</h4>
      {#each endOfSeasonGrade.teamRankings as team}
        <div class="team-block">
          <div class="team-header">
            <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
            <strong>{managerDisplayName(team.managerId)}</strong>
            <span class="muted">
              Total PAR: <span class="{(team.totalPAR || 0) >= 0 ? 'positive' : 'negative'}">
                {(team.totalPAR || 0) >= 0 ? '+' : ''}{fp(team.totalPAR)}
              </span>
              · {fp(team.totalActualPts)} actual pts
            </span>
          </div>
          <table class="data-table mini">
            <thead>
              <tr><th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th><th>Actual</th><th>Expected</th><th>PAR</th><th>Label</th></tr>
            </thead>
            <tbody>
              {#each team.picks.sort((a,b) => a.pickNo - b.pickNo) as pick}
                <tr>
                  <td>{pick.round}</td>
                  <td>#{pick.pickNo}</td>
                  <td>{pick.playerName}</td>
                  <td>{pick.pos}</td>
                  <td>{fp(pick.actualPts)}</td>
                  <td>{fp(pick.expectedPts)}</td>
                  <td class="{(pick.par || 0) >= 0 ? 'positive' : 'negative'}">
                    {(pick.par || 0) >= 0 ? '+' : ''}{fp(pick.par)}
                  </td>
                  <td><span class="val-tag {valueLabelClass(pick.valueLabel)}">{pick.valueLabel}</span></td>
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
        </div>
      {/each}

    {:else if activeTab === 'end' && !endOfSeasonGrade}
      <div class="status-msg">
        End-of-season grade unavailable — season stats could not be loaded for {selectedDraftYear}.
      </div>
    {/if}

    <!-- Debug -->
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
  .status-msg { padding: 2rem; background: #f0f0f0; border-radius: 8px; text-align: center; font-style: italic; }
  .sub { font-size: 0.88rem; color: #555; margin: -0.5rem 0 1.25rem; }
  .muted { color: #888; font-size: 0.87em; }

  /* Tabs */
  .tab-group { display: flex; gap: 0.5rem; }
  .tab-btn { padding: 0.4rem 1rem; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.9rem; }
  .tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }

  /* Tables */
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.88rem; }
  .data-table.mini { font-size: 0.82rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.35rem 0.5rem; text-align: center; }
  .data-table th { background: #f5f5f5; font-weight: 600; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }

  /* Team blocks */
  .team-block { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1.25rem; overflow: hidden; }
  .team-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.65rem 1rem; background: #f9f9f9; border-bottom: 1px solid #eee; flex-wrap: wrap; }

  /* Grade badges */
  .grade-badge { padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: 700; font-size: 0.85em; }
  .grade-a { background: #d1fae5; color: #065f46; }
  .grade-b { background: #e0f2fe; color: #0369a1; }
  .grade-c { background: #fef3c7; color: #92400e; }
  .grade-d { background: #fed7aa; color: #9a3412; }
  .grade-f { background: #fef2f2; color: #dc2626; }

  /* Value tags */
  .val-tag { display: inline-block; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.78em; font-weight: 600; margin-left: 0.25rem; }
  .val-tag.steal, .val-tag.positive { background: #d1fae5; color: #065f46; }
  .val-tag.reach, .val-tag.negative { background: #fef2f2; color: #dc2626; }
  .val-tag.neutral { background: #f3f4f6; color: #6b7280; }

  /* Positional breakdown */
  .pos-breakdown { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.75rem 1rem; background: #fafafa; border-top: 1px solid #eee; }
  .pos-card { background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.4rem 0.6rem; min-width: 70px; text-align: center; }
  .pos-label { font-weight: 700; font-size: 0.8em; color: #374151; }
  .pos-stat { font-size: 0.78em; color: #555; }
  .pos-par { font-size: 0.82em; font-weight: 700; }

  /* Two-col layout */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }

  /* PAR colors */
  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }
  .neutral  { color: #6b7280; }

  /* Debug */
  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.8em; margin-top: 1rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.18rem; }
</style>
