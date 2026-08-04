// vibesGradesStore.js
//
// Persists the LLM-issued, vibes-based draft grades (recorded manually by
// the commissioner after publishing the Draft Grades article) in
// localStorage, so they can later be compared against that year's
// data-based end-of-season draft grade once the season is over.
//
// Shape: { [year]: { [managerId]: 'B+' } }

const STORAGE_KEY = 'nlfl_vibes_draft_grades';

function safeParse(json, fallback) {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Loads all recorded vibes grades, keyed by year. */
export function loadVibesGrades() {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  return safeParse(raw, {});
}

/** Saves the full vibes-grades object (all years) to localStorage. */
export function saveVibesGrades(allYears) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allYears || {}));
  } catch (e) {
    console.error('Failed to save vibes grades:', e);
  }
}

/** Saves/overwrites just one year's grades, preserving other years. */
export function saveVibesGradesForYear(year, gradesForYear) {
  const all = loadVibesGrades();
  all[String(year)] = gradesForYear || {};
  saveVibesGrades(all);
  return all;
}

/** Convenience getter for one year. */
export function getVibesGradesForYear(year) {
  const all = loadVibesGrades();
  return all[String(year)] || {};
}
