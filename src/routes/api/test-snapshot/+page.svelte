<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { getLeagueTeamManagers } from '$lib/utils/helperFunctions/leagueTeamManagers.js';
  import { getAllSeasonsHistory } from '$lib/utils/dataEngine/allTimeHistory.js';
  import { getAllDrafts } from '$lib/utils/dataEngine/allDrafts.js';
  import { gradeDraftPreSeason, gradeDraftEndOfSeason } from '$lib/utils/dataEngine/draftAnalysis.js';
  import { getSeasonStatTotals } from '$lib/utils/dataEngine/allPlayerSeasonStats.js';
  import { computeRoundBaselines } from '$lib/utils/dataEngine/draftBaselines.js';
  import { teamManagersStore } from '$lib/stores';

  let allTimeHistory   = null;
  let allDrafts        = [];
  let loadingDrafts    = false;
  let draftDebug       = [];
  let showDraftDebug   = false;

  let selectedDraftYear  = null;
  let selectedDraft      = null;
  let preSeasonGrade     = null;
  let endOfSeasonGrade   = null;
  let currentBaselines   = null;
  let activeTab          = 'end';

  $: draftYearOptions = allDrafts.map((d) => d.year).sort((a, b) => b - a);

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

  function injuryIcon(flag) {
    if (flag === 'major-injury') return '🚑';
    if (flag === 'injury')       return '🤕';
    return '';
  }

  async function loadDraftData() {
    loadingDrafts = true;
    draftDebug    = [];

    try {
      await getLeagueTeamManagers();

      if (!allTimeHistory) {
        draftDebug.push('Loading all-time history (PAR tables + season stats)...');
        allTimeHistory = await getAllSeasonsHistory();
        const years = Object.keys(allTimeHistory.parTablesBySeason || {});
        draftDebug.push(`Loaded ${years.length} seasons: ${years.join(', ')}`);
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
    currentBaselines = null;

    if (!selectedDraft) return;

    draftDebug.push(`--- Analyzing ${year} (${selectedDraft.picks.length} picks) ---`);

    preSeasonGrade = gradeDraftPreSeason(selectedDraft);

    const parTables = allTimeHistory?.parTablesBySeason?.[String(year)];
    if (!parTables) {
      draftDebug.push(`No PAR tables for ${year} — end-of-season grade unavailable.`);
      return;
    }

    const allSeasonStats    = allTimeHistory?.allSeasonStats || {};
    const parTablesBySeason = allTimeHistory?.parTablesBySeason || {};
    const allPlayersData    = allTimeHistory?.allPlayersData || {};

    draftDebug.push(`Computing round-based expected PAR for ${year}...`);

    currentBaselines = computeRoundBaselines(
      year, allDrafts, allSeasonStats, parTablesBySeason, allPlayersData
    );

    if (currentBaselines) {
      draftDebug.push(`Expected PAR baselines using seasons: ${currentBaselines.seasonYears.join(', ')}`);
      Object.entries(currentBaselines.expectedPAR)
        .sort(([a], [b]) => Number(a) - Number(b))
        .forEach(([r, val]) => {
          const raw = currentBaselines.raw[r];
          const n   = currentBaselines.sampleSizes[r];
          draftDebug.push(`  Round ${r}: expected PAR ${val.toFixed(1)} (raw: ${raw.toFixed(1)}, n=${n})`);
        });
    } else {
      draftDebug.push(`Could not compute round baselines for ${year}.`);
      return;
    }

    const scoringSettings = allTimeHistory?.sharedScoringSettings || null;
    draftDebug.push(`Fetching ${year} season stats...`);

    const statsResult = await getSeasonStatTotals(year, scoringSettings).catch((err) => {
      draftDebug.push(`Stats fetch failed: ${err.message}`);
      return null;
    });

    if (!statsResult) return;

    draftDebug.push(`${year}: ${Object.keys(statsResult.totals || {}).length} players with stats.`);

    endOfSeasonGrade = gradeDraftEndOfSeason(
      selectedDraft,
      statsResult.totals,
      statsResult.gamesPlayed,
      currentBaselines,
      parTables,
      allPlayersData
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
    <div class="status-msg">Loading drafts and computing adjusted PAR...</div>

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
          on:click={() => (activeTab = 'end')}>End-of-Season Grade</button>
        <button class="tab-btn {activeTab === 'pre' ? 'active' : ''}"
          on:click={() => (activeTab = 'pre')}>Pre-Season Grade</button>
      </div>
    </div>

    <!-- ── END-OF-SEASON ──────────────────────────────────────────────────── -->
    {#if activeTab === 'end'}
      {#if endOfSeasonGrade}

        <h3>{endOfSeasonGrade.year} — End-of-Season Draft Grade</h3>
        <div class="explainer">
          <strong>Adjusted PAR = Actual PAR − Expected PAR.</strong><br/>
          Actual PAR = actual season pts − positional replacement level (accounts for scarcity).<br/>
          Expected PAR = historical average Actual PAR for that round
          (from {endOfSeasonGrade.baselineSeasons?.join(' + ')} season data, smoothed so later
          rounds never exceed earlier rounds).<br/>
          Adjusted PAR near 0 = performed as historically expected for that round + position.
          🤕 = injury-affected (under 8 games played).
        </div>

        <!-- ── Reference panels ────────────────────────────────────────────── -->
        <div class="ref-grid">
          <div class="ref-panel">
            <div class="ref-title">
              📊 Expected PAR by Round
              <span class="ref-sub">(historical avg actual PAR, {endOfSeasonGrade.baselineSeasons?.join('+')} seasons)</span>
            </div>
            <div class="baseline-pills">
              {#each Object.entries(endOfSeasonGrade.expectedPARByRound || {}).sort(([a],[b]) => Number(a)-Number(b)) as [r, val]}
                <div class="baseline-pill">
                  <span class="bl-round">R{r}</span>
                  <span class="bl-pts">{signedFp(val)}</span>
                  <span class="bl-raw muted">raw: {signedFp(endOfSeasonGrade.rawExpectedPAR?.[r])}</span>
                  <span class="bl-n muted">n={endOfSeasonGrade.sampleSizes?.[r]}</span>
                </div>
              {/each}
            </div>
          </div>

          <div class="ref-panel">
            <div class="ref-title">
              🔄 Replacement Levels (this season)
              <span class="ref-sub">used to compute each pick's actual PAR</span>
            </div>
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

        <!-- ── Team rankings ────────────────────────────────────────────────── -->
        <h4>Team Draft Grades</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th><th>Manager</th><th>Grade</th>
              <th>Adjusted PAR</th><th>Excl. Injuries</th>
              <th>Actual Pts</th><th>Injuries</th>
              <th>Best Pick</th><th>Worst Pick</th>
            </tr>
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
                    <span class="vl-tag vl-steal">{signedFp(team.bestPick.adjustedPAR)}</span>
                  {:else}—{/if}
                </td>
                <td>
                  {#if team.worstPick}
                    {team.worstPick.playerName}
                    <span class="pos-tag">{team.worstPick.pos}</span>
                    R{team.worstPick.round}
                    {injuryIcon(team.worstPick.injuryFlag)}
                    <span class="vl-tag vl-bust">{signedFp(team.worstPick.adjustedPAR)}</span>
                  {:else}—{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- ── Steals and busts ─────────────────────────────────────────────── -->
        <div class="two-col">
          <div>
            <h4>🔥 Biggest Steals</h4>
            <table class="data-table">
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Pick</th><th>Actual</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each endOfSeasonGrade.leagueTopSteals as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td><span class="pos-tag">{pick.pos}</span></td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>{fp(pick.actualPts)}</td>
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
              <thead>
                <tr><th>Player</th><th>Pos</th><th>Rd</th><th>Pick</th><th>Actual</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th><th>Inj</th><th>Manager</th></tr>
              </thead>
              <tbody>
                {#each endOfSeasonGrade.leagueTopBusts as pick}
                  <tr>
                    <td>{pick.playerName}</td>
                    <td><span class="pos-tag">{pick.pos}</span></td>
                    <td>{pick.round}</td>
                    <td>#{pick.pickNo}</td>
                    <td>{fp(pick.actualPts)}</td>
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

        <!-- ── Per-team full breakdowns ──────────────────────────────────────── -->
        <h4>Full Breakdown by Team</h4>
        {#each endOfSeasonGrade.teamRankings as team}
          <div class="team-block">
            <div class="team-header">
              <span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span>
              <strong>{managerDisplayName(team.managerId)}</strong>
              <span class="header-stat">
                Adjusted PAR: <span class="{parClass(team.totalAdjustedPAR)}">{signedFp(team.totalAdjustedPAR)}</span>
              </span>
              <span class="header-stat muted">
                Actual PAR: {signedFp(team.totalActualPAR)} · {fp(team.totalActualPts)} pts
              </span>
              {#if team.injured.length > 0}
                <span class="header-stat muted">
                  🤕 {team.injured.length} injured ·
                  excl: <span class="{parClass(team.injuryExcludedPAR)}">{signedFp(team.injuryExcludedPAR)}</span>
                </span>
              {/if}
            </div>

            <div class="table-scroll">
              <table class="data-table mini">
                <thead>
                  <tr>
                    <th>Rd</th><th>Pick</th><th>Player</th><th>Pos</th>
                    <th>Actual Pts</th><th>Actual PAR</th><th>Exp PAR</th><th>Adj PAR</th>
                    <th>Games</th><th>Label</th>
                  </tr>
                </thead>
                <tbody>
                  {#each team.picks as pick}
                    <tr class="{pick.injuryFlag ? 'injury-row' : ''}">
                      <td>{pick.round}</td>
                      <td>#{pick.pickNo}</td>
                      <td>
                        {pick.playerName}
                        {#if pick.injuryFlag}
                          <span title="{pick.injuryFlag === 'major-injury'
                            ? 'Major injury — under 4 games played'
                            : 'Injury-affected — under 8 games played'}">
                            {injuryIcon(pick.injuryFlag)}
                          </span>
                        {/if}
                      </td>
                      <td><span class="pos-tag">{pick.pos}</span></td>
                      <td>{fp(pick.actualPts)}</td>
                      <td class="muted">{signedFp(pick.actualPAR)}</td>
                      <td class="muted">{signedFp(pick.expectedPAR)}</td>
                      <td class="{parClass(pick.adjustedPAR)}">
                        {pick.adjustedPAR != null ? signedFp(pick.adjustedPAR) : '—'}
                      </td>
                      <td class="{pick.injuryFlag ? 'negative' : 'muted'}">
                        {pick.gamesPlayed != null ? pick.gamesPlayed : '—'}
                      </td>
                      <td>
                        <span class="vl-tag {valueLabelClass(pick.valueLabel)}">{pick.valueLabel}</span>
                      </td>
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
                  <div class="pos-par {data.totalAdjustedPAR >= 0 ? 'positive' : 'negative'}">
                    {signedFp(data.totalAdjustedPAR)} Adj PAR
                  </div>
                </div>
              {/each}
            </div>

            <div class="round-breakdown">
              <span class="muted">Adjusted PAR by round:</span>
              {#each Object.entries(team.byRound).sort(([a],[b]) => Number(a)-Number(b)) as [rnd, data]}
                <span class="round-pill {data.totalAdjustedPAR >= 0 ? 'positive-bg' : 'negative-bg'}">
                  R{rnd}: {signedFp(data.totalAdjustedPAR)}
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
            End-of-season grade not available for {selectedDraftYear} — check debug logs.
          {/if}
        </div>
      {/if}

    <!-- ── PRE-SEASON TAB ─────────────────────────────────────────────────── -->
    {:else if activeTab === 'pre'}
      {#if preSeasonGrade}
        <h3>{preSeasonGrade.year} — Pre-Season Draft Grade</h3>
        <div class="explainer">
          Grades based on positional scarcity within the draft itself.
          <strong>vs Market</strong> = picks earlier/later than the average for that
          positional slot. Positive = got the position cheaper than average.
        </div>

        <h4>Team Grades</h4>
        <table class="data-table">
          <thead>
            <tr><th>Rank</th><th>Manager</th><th>Grade</th><th>Avg vs Market</th><th>Best Pick</th><th>Worst Pick</th></tr>
          </thead>
          <tbody>
            {#each preSeasonGrade.teamRankings as team, idx}
              <tr>
                <td>#{idx + 1}</td>
                <td><strong>{managerDisplayName(team.managerId)}</strong></td>
                <td><span class="grade-badge {gradeColor(team.grade)}">{team.grade}</span></td>
                <td class="{(parseFloat(team.avgVsMarket) || 0) >= 0 ? 'positive' : 'negative'}">
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
              <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>At Pick</th><th>Avg At Slot</th><th>Value</th><th>Manager</th></tr></thead>
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
              <thead><tr><th>Player</th><th>Pos</th><th>Rd</th><th>At Pick</th><th>Avg At Slot</th><th>Reach</th><th>Manager</th></tr></thead>
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
  .muted { color: #888; font-size: 0.86em; }
  .explainer { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.87rem; color: #0c4a6e; line-height: 1.6; }

  .tab-group { display: flex; gap: 0.5rem; }
  .tab-btn { padding: 0.4rem 1rem; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 0.9rem; }
  .tab-btn.active { background: #2563eb; color: white; border-color: #2563eb; }

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

  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.85rem; }
  .data-table.mini { font-size: 0.79rem; }
  .data-table th, .data-table td { border: 1px solid #ddd; padding: 0.3rem 0.45rem; text-align: center; }
  .data-table th { background: #f5f5f5; font-weight: 600; }
  .data-table td:first-child, .data-table th:first-child { text-align: left; }
  .injury-row { background: #fff7ed; }
  .table-scroll { overflow-x: auto; }

  .team-block { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 1.25rem; overflow: hidden; }
  .team-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: #f9f9f9; border-bottom: 1px solid #eee; flex-wrap: wrap; }
  .header-stat { font-size: 0.88em; }

  .grade-badge { padding: 0.18rem 0.55rem; border-radius: 4px; font-weight: 700; font-size: 0.84em; }
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

  .pos-tag { background: #e5e7eb; border-radius: 3px; padding: 0.08rem 0.3rem; font-size: 0.74em; font-weight: 700; margin: 0 0.15rem; }

  .pos-breakdown { display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.6rem 1rem; background: #fafafa; border-top: 1px solid #eee; }
  .pos-card { background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 0.35rem 0.55rem; min-width: 65px; text-align: center; }
  .pos-label { font-weight: 700; font-size: 0.78em; color: #374151; }
  .pos-stat  { font-size: 0.76em; color: #555; }
  .pos-par   { font-size: 0.8em; font-weight: 700; }

  .round-breakdown { display: flex; gap: 0.4rem; flex-wrap: wrap; padding: 0.5rem 1rem; background: #f8f8f8; border-top: 1px solid #eee; font-size: 0.83em; align-items: center; }
  .round-pill { padding: 0.15rem 0.45rem; border-radius: 3px; font-size: 0.85em; font-weight: 600; }
  .positive-bg { background: #d1fae5; color: #065f46; }
  .negative-bg { background: #fef2f2; color: #dc2626; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }

  .positive { color: #16a34a; font-weight: 700; }
  .negative { color: #dc2626; font-weight: 700; }
  .injury-count { color: #d97706; font-weight: 600; font-size: 0.88em; }

  .debug-terminal { background: #1e1e1e; color: #00ff00; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.8em; margin-top: 1rem; }
  .debug-terminal h4 { margin: 0 0 0.5rem; color: #fff; }
  .debug-terminal ul { margin: 0; padding-left: 1.2rem; }
  .debug-terminal li { margin-bottom: 0.18rem; }
</style>
