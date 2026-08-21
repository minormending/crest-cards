import { writeFile, mkdir } from 'node:fs/promises';

// Every icon used by Crest Cards, as <author>/<name> in the game-icons repo.
// The key is the local filename; the value is the upstream path, which is also
// the attribution record — the author is the first segment.
const ICONS = {
  // attack types
  'sword':'lorc/broadsword','axe':'lorc/battle-axe','lance':'lorc/spear-hook',
  'bow':'lorc/high-shot','ember':'lorc/small-fire','gale':'lorc/whirlwind','frost':'lorc/frozen-orb',
  // stats
  'hp':'lorc/heart-inside','str':'lorc/fist','mag':'lorc/magic-swirl',
  'def':'lorc/checked-shield','res':'lorc/spiral-shell','spd':'lorc/walking-boot',
  // ui
  'crown':'lorc/crown','hourglass':'lorc/hourglass','clash':'lorc/crossed-swords','wing':'lorc/feathered-wing',
  // class portraits
  'vanguard':'lorc/visored-helm','duelist':'lorc/dodging','reaver':'lorc/axe-swing',
  'hewer':'lorc/lamellar','lancer':'lorc/horse-head','pikeguard':'lorc/trident',
  'marksman':'delapouite/archer','drakerider':'lorc/wyvern','emberwright':'lorc/burning-embers',
  'galecaller':'lorc/tornado','frostbinder':'lorc/frostfire','mender':'lorc/prayer',
  'warden':'lorc/barbute','shade':'lorc/hood','bannerguard':'delapouite/knight-banner',
  // items
  'salve':'lorc/heart-bottle','elixir':'lorc/potion-ball','orders':'lorc/scroll-unfurled',
  'bolt':'lorc/lightning-trio','whetstone':'lorc/plain-dagger','brigandine':'lorc/mail-shirt',
  'cloak':'lorc/wing-cloak',
};

const BASE = 'https://raw.githubusercontent.com/game-icons/icons/master';

/* game-icons ships each glyph as white-on-black: a full-bleed black backing
   rect, then the glyph in #fff. Both are wrong for a light, calm board, so the
   rect goes and the glyph becomes currentColor — which lets one file serve the
   ink, the muted and the two team tints without recolouring anything. */
function clean(svg) {
  return svg
    .replace(/<path[^>]*d="M0 0h512v512H0z"[^>]*\/>/g, '')
    .replace(/#fff(?:fff)?\b/gi, 'currentColor')
    .replace(/\s+/g, ' ')
    .trim();
}

await mkdir('art/icons', { recursive: true });
const used = new Map();
let ok = 0, failed = [];

for (const [local, upstream] of Object.entries(ICONS)) {
  try {
    const res = await fetch(`${BASE}/${upstream}.svg`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svg = clean(await res.text());
    if (!svg.includes('<path') && !svg.includes('<g')) throw new Error('no glyph after cleaning');
    await writeFile(`art/icons/${local}.svg`, svg + '\n');
    const author = upstream.split('/')[0];
    if (!used.has(author)) used.set(author, []);
    used.get(author).push(`${local}.svg  ←  ${upstream}`);
    ok++;
  } catch (e) {
    failed.push(`${local} (${upstream}): ${e.message}`);
  }
}

console.log(`downloaded ${ok}/${Object.keys(ICONS).length} icons`);
if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  ' + f)); }
await writeFile('/tmp/icon-credits.json', JSON.stringify(Object.fromEntries(used), null, 2));
for (const [a, list] of used) console.log(`  ${a}: ${list.length}`);
