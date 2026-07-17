// leagueManagers.js
//
// Maps Sleeper user IDs to real names for use in LLM-generated recaps.
// Sleeper user IDs are permanent — update this if someone joins or leaves.
// Real names are used in all exported files so the LLM uses them in articles.
//
// To find a user's Sleeper ID: it appears in the debug logs when you load
// manager grades, or in the all-time history global debug output.

export const MANAGER_REAL_NAMES = {
  // Sleeper userId → real first name (or nickname your league uses)
  // Examples — replace with your actual IDs and names:
  // '123456789': 'Rob',
  // '987654321': 'James',
  // '111222333': 'Jared',
  // etc.
};

/**
 * Returns a manager's real name if mapped, otherwise their Sleeper display name.
 * Use this everywhere you'd use mdn() or mgrName() in exports.
 */
export function getRealName(managerId, managersSnapshot) {
  if (!managerId) return '?';
  // Check real name mapping first
  if (MANAGER_REAL_NAMES[managerId]) return MANAGER_REAL_NAMES[managerId];
  // Fall back to Sleeper display name
  return managersSnapshot?.users?.[managerId]?.display_name || `Manager ${managerId}`;
}
