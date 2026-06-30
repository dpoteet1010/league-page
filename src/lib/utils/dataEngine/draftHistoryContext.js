// draftHistoryContext.js
//
// Builds LLM-ready text summarizing draft history (with actual outcomes
// where known) and the current draft to grade. Paste output into Claude/
// ChatGPT alongside a prompt asking for post-draft grades — this is how
// post-draft qualitative grading works now, since real-time projections
// aren't programmatically available to us.

export function buildDraftHistoryContext(allDrafts, allSeasonStats, managerDisplayNameFn) {
  const sorted = [...allDrafts].sort((a, b) => a.year - b.year);
  const byManager = {};

  sorted.forEach((draft) => {
    const stats = allSeasonStats?.[String(draft.year)]?.totals || {};
    draft.picks.forEach((pick) => {
      const mgrId = pick.managerId || 'unknown';
      if (!byManager[mgrId]) byManager[mgrId] = [];
      const actualPts = stats[String(pick.playerId)];
      byManager[mgrId].push({
        year: draft.year, round: pick.round, pickNo: pick.pickNo,
        playerName: pick.playerName, position: pick.position || '?',
        actualPts: actualPts != null ? Number(actualPts.toFixed(1)) : null
      });
    });
  });

  const lines = ['=== LEAGUE DRAFT HISTORY (context for grading the current draft) ===', ''];

  Object.entries(byManager).forEach(([mgrId, picks]) => {
    lines.push(`--- ${managerDisplayNameFn(mgrId)} ---`);
    const byYear = {};
    picks.forEach((p) => { (byYear[p.year] ??= []).push(p); });
    Object.entries(byYear).sort(([a], [b]) => Number(a) - Number(b)).forEach(([year, yrPicks]) => {
      lines.push(`  ${year} Draft:`);
      yrPicks.sort((a, b) => a.round - b.round || a.pickNo - b.pickNo).forEach((p) => {
        const result = p.actualPts != null ? `${p.actualPts} pts (final)` : 'season in progress';
        lines.push(`    R${p.round} (#${p.pickNo}): ${p.playerName} (${p.position}) — ${result}`);
      });
    });
    lines.push('');
  });

  return { text: lines.join('\n'), byManager };
}

export function buildCurrentDraftSummary(draft, managerDisplayNameFn) {
  if (!draft) return '';
  const lines = [`=== ${draft.year} DRAFT TO GRADE (no results exist yet) ===`, ''];
  const byManager = {};
  draft.picks.forEach((pick) => {
    const mgrId = pick.managerId || 'unknown';
    (byManager[mgrId] ??= []).push(pick);
  });
  Object.entries(byManager).forEach(([mgrId, picks]) => {
    lines.push(`${managerDisplayNameFn(mgrId)}:`);
    picks.sort((a, b) => a.round - b.round || a.pickNo - b.pickNo).forEach((p) => {
      lines.push(`  R${p.round} (#${p.pickNo}): ${p.playerName} (${p.position || '?'})`);
    });
    lines.push('');
  });
  return lines.join('\n');
}

export const DRAFT_GRADING_PROMPT_TEMPLATE = `
You are grading fantasy football drafts. Below is the league's draft history
(with actual season outcomes where known) followed by the current draft to grade.

Using the historical context to understand draft tendencies, value, and risk
profiles, grade each manager's CURRENT draft on a scale of 0-100, considering:
- Value relative to draft position (reaches vs. value picks)
- Roster construction and balance across positions
- Risk profile (rookies, injury-prone players, unproven talent) vs. safe floor picks
- Historical patterns: has this manager drafted well in the past? Do they have a type?

For each manager, provide:
1. Overall grade (0-100)
2. One-sentence summary of their draft strategy
3. Best pick and biggest risk pick

--- HISTORICAL CONTEXT ---
{{HISTORY}}

--- CURRENT DRAFT TO GRADE ---
{{CURRENT_DRAFT}}
`.trim();
