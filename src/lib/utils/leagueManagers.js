// leagueManagers.js
//
// Real names, nicknames, and bios for each NLFL manager.
// Used in all LLM exports so articles feel personal and specific.
//
// TO FIND SLEEPER USER IDs: load the page, click "Show Global Debug" —
// manager IDs appear next to their display names in the output.

export const MANAGERS = {
  '862540586538921984': {
    name:     'Newman',
    bio:      'Newman is a big gambling addict, espcially poker and sports. He goes to the casino all the time for poker. He also is an assistant volleyball coach for CBC (an all boys high school).',
  },
    '997207542067429376': {
    name:     'Alec',
    bio:      'Alec is a huge Green Bay Packers and Milwaukee Bucks fan. Alec is the resident asshole and loves to piss people off and ragebait.',
  },
    '1002297734663237632': {
    name:     'Jared',
    bio:      'Jared is a big dude (tall and fat). He is super sensitive about everything, which makes it fun to mess with him. He also cannot get women and is incredibly desperate.',
  },
    '1128923498258219008': {
    name:     'Harrison',
    bio:      'Harrison is a sports nerd and also is into sports cards. His Mom is called Lisa, and Newman likes to make jokes about dating his mom.',
  },
    '1129950475123781632': {
    name:     'Haskin',
    bio:      'Haskin is married and is a bit of an awkward guy. He is crazy ass at golf and does not participate much in our group chat. He is a New Orleans Saints fan and Ohio State fan. It is fun to make fun of him about Ohio State especially.',
  },
    '1137981174678462464': {
    name:     'James',
    bio:      'James is married and has a kid. James is a Las Vegas Raiders fan, so his team has always been ass.',
  },
    '1211171582181912576': {
    name:     'The Dictator',
    bio:      'I am the owner of the league and get called The Dictator. I am a diehard Seahawks and Celtics fan. I love to stir the pot and shit talk. I am very type A and love planning everyhting. ',
  },
    '1227657139674173440': {
    name:     'Siampos',
    bio:      'A Seattle Seahwaks and Boston Celtics fan. Siampos is technically Greek, but we make Jew jokes about him.',
  },
    '1227846679458230272': {
    name:     'Lukas',
    bio:      'Just got married, and he does not really follow football. Lukas is German, so German jokes are a great idea especially if it is against Jews. Lukas is a huge alcoholic as well.',
  },
    '1228199076927909888': {
    name:     'Berra',
    bio:      'Berra is a short fat leprechaun (has red hair). Making fun of him for being a ginger is a great idea. Berra is a huge sports nerd, but he is super argumentative and has anger issues. He is a Green Pay Packers fan and basically sucks the dick of Patrick Mahomes. Berra also is insanely unathletic, is terrible at golf and all sports, and cannot get women either.',
  },
    '1262835899889102848': {
    name:     'Mendez',
    bio:      'Is a Kansas City Chiefs fan, Mendez is Mexican and our only non-white person in our league which brings lovely diversity. Mendez is super athletic as well.',
  },
    '1248510597402742784': {
    name:     'Stolze',
    bio:      'Is a Jayson Tatum fan and a big fan of Duke University. Stolze is a former collegiate golfer and is also athletic and good at sports. Stolze has a very sarcastic personality and loves to fuck with everyone.',
  },
    '1129215612842016768': {
    name:     'Tyler',
    bio:      'No longer in the league, but he is a massive alcoholic and former drug addict. He has been to the hospital multiple times for alcohol/drug overdoses, including on James bachelor trip. He is also super racist.',
  },
    '732863490657738752': {
    name:     'Corzine',
    bio:      'No longer in the league, but Corzine is married and was always a pretty quiet and reserved guy.',
  },
    '1': {
    name:     'D Kim',
    bio:      'No longer in the league, but D Kim is Asian and basically just stopped participating in the league.',
  },
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
