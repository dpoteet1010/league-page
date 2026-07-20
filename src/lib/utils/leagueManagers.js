// leagueManagers.js
//
// Real names, nicknames, and bios for each NLFL manager.
// Used in all LLM exports so articles feel personal and specific.
//
// TO FIND SLEEPER USER IDs: load the page, click "Show Global Debug" —
// manager IDs appear next to their display names in the output.

export const MANAGERS = {
  // 'sleeperUserId': { ... }
  //
  // EXAMPLE — replace with your actual data:
  // '123456789012345678': {
  //   name:     'Rob',
  //   nickname: 'Haskin',        // what people actually call them in the group chat
  //   bio:      'Rob is a die-hard Chiefs fan from KC. Won the league in 2024. Has a bad habit of reaching for RBs in the first round and then complaining about injuries all season. Works in finance and thinks that makes him smarter at fantasy than everyone else.',
  //   rivalId:  '987654321098765432',  // Sleeper ID of their designated rival
  // },
};

/**
 * Returns the real name for a manager, falling back to Sleeper display name.
 */
export function getRealName(managerId, managersSnapshot) {
  if (!managerId) return '?';
  if (MANAGERS[managerId]?.name) return MANAGERS[managerId].name;
  return managersSnapshot?.users?.[managerId]?.display_name || `Manager ${managerId}`;
}

/**
 * Returns the nickname (for casual mentions), falling back to real name.
 */
export function getNickname(managerId, managersSnapshot) {
  if (!managerId) return '?';
  if (MANAGERS[managerId]?.nickname) return MANAGERS[managerId].nickname;
  return getRealName(managerId, managersSnapshot);
}

/**
 * Builds a manager roster section for LLM exports.
 * Includes real name, Sleeper username, bio, and rival name.
 */
export function buildManagerRosterSection(managersSnapshot) {
  const lines = [];
  lines.push('## Manager Roster & Bios');
  lines.push('*Use these real names and personal details to make recaps specific and personal.*');
  lines.push('');

  const users = managersSnapshot?.users || {};

  Object.entries(users).forEach(([id, user]) => {
    const data        = MANAGERS[id];
    const realName    = data?.name     || user.display_name;
    const nickname    = data?.nickname || realName;
    const bio         = data?.bio      || null;
    const sleeperName = user.display_name;
    const rivalId     = data?.rivalId  || null;
    const rivalName   = rivalId ? (MANAGERS[rivalId]?.name || users[rivalId]?.display_name || '?') : null;

    lines.push(`### ${realName}`);
    if (nickname !== realName) lines.push(`**Nickname**: ${nickname}`);
    lines.push(`**Sleeper username**: ${sleeperName}`);
    if (rivalName) lines.push(`**Rival**: ${rivalName}`);
    if (bio) {
      lines.push(`**Bio**: ${bio}`);
    } else {
      lines.push(`**Bio**: No bio provided.`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
