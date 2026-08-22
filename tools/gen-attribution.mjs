import { writeFile } from 'node:fs/promises';
const ICONS = {
  'sword':'lorc/broadsword','axe':'lorc/battle-axe','lance':'lorc/spear-hook',
  'bow':'lorc/high-shot','ember':'lorc/small-fire','gale':'lorc/whirlwind','frost':'lorc/frozen-orb',
  'hp':'lorc/heart-inside','str':'lorc/fist','mag':'lorc/magic-swirl',
  'def':'lorc/checked-shield','res':'lorc/spiral-shell','spd':'lorc/walking-boot',
  'crown':'lorc/crown','hourglass':'lorc/hourglass','clash':'lorc/crossed-swords','wing':'lorc/feathered-wing',
  'hand':'lorc/poker-hand','deck':'delapouite/stack','bag':'lorc/swap-bag',
  'vanguard':'lorc/visored-helm','duelist':'lorc/dodging','reaver':'lorc/axe-swing',
  'hewer':'lorc/lamellar','lancer':'lorc/horse-head','pikeguard':'lorc/trident',
  'marksman':'delapouite/archer','drakerider':'lorc/wyvern','emberwright':'lorc/burning-embers',
  'galecaller':'lorc/tornado','frostbinder':'lorc/frostfire','mender':'lorc/prayer',
  'warden':'lorc/barbute','shade':'lorc/hood','bannerguard':'delapouite/knight-banner',
  'salve':'lorc/heart-bottle','elixir':'lorc/potion-ball','orders':'lorc/scroll-unfurled',
  'bolt':'lorc/lightning-trio','whetstone':'lorc/plain-dagger','brigandine':'lorc/mail-shirt',
  'cloak':'lorc/wing-cloak',
};
const AUTHORS = {
  lorc:       { name: 'Lorc',       url: 'https://lorcblog.blogspot.com' },
  delapouite: { name: 'Delapouite', url: 'https://delapouite.com' },
};
const rows = Object.entries(ICONS)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([local, upstream]) => {
    const [author, name] = upstream.split('/');
    return `| \`art/icons/${local}.svg\` | ${name} | ${AUTHORS[author].name} |`;
  });
const byAuthor = {};
for (const u of Object.values(ICONS)) {
  const a = u.split('/')[0];
  byAuthor[a] = (byAuthor[a] || 0) + 1;
}
const doc = `# Attribution

Crest Cards is an original game. This file records where its art came from, and
is also the answer to "can this be published?" — everything below is either
freely licensed with credit given here, or drawn for this repo.

## The game itself is not derived from anyone's property

Crest Cards borrows a *genre*: grid-deployed tactical skirmishes with a weapon
triangle, which is a mechanic, and mechanics are not what copyright covers. It
deliberately borrows nothing else. Every unit class, character name, item,
faction and piece of flavour text in \`js/cards.js\` was written for this repo.
There are no names, characters, places, sprites, music or text from any
commercial game in it, and none should ever be added — that is the whole reason
the roster reads the way it does.

## Icons — game-icons.net

${Object.keys(byAuthor).length} artists, ${Object.values(byAuthor).reduce((a, b) => a + b, 0)} icons, from the
[game-icons.net](https://game-icons.net) collection
([source repository](https://github.com/game-icons/icons)).

Licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
**This licence requires the credit below to be kept**, which is why this file
ships with the game rather than living in a commit message.

${Object.entries(byAuthor).map(([a, n]) =>
  `- **${AUTHORS[a].name}** (${AUTHORS[a].url}) — ${n} icon${n === 1 ? '' : 's'}`).join('\n')}

Each file was modified for this project in two ways, by \`tools/fetch-icons.mjs\`:
the full-bleed black backing rectangle was deleted, and the white glyph fill was
changed to \`currentColor\` so one file can be tinted per team and per state.
CC BY 3.0 permits modification; this paragraph is the required notice of it.

| file | upstream icon | artist |
| --- | --- | --- |
${rows.join('\n')}

## Unit portraits — Eldiran, via OpenGameArt

The nineteen character portraits in \`art/sprites/units.png\` come from
**[32x32 RPG Character Sprites](https://opengameart.org/content/32x32-rpg-character-sprites)**
by **Eldiran**, released under
**[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)** (public domain
dedication).

CC0 asks for nothing — no attribution is legally required and there is no
share-alike obligation. The credit is here because it should be, and because a
reader deserves to know which pixels somebody else drew.

Modified for this project by \`tools/build-sprites.mjs\`, which is also the record
of exactly what was taken: the standing frame (column 1) of nineteen of the
sheet's rows, one per unit, composited into a single horizontal strip in roster
order. The upstream sheet is chroma-keyed rather than transparent — an opaque
magenta \`#FF00FF\` background — so that colour is made fully transparent in the
process. Re-running the script reproduces the shipped file.

Which row became which unit, and why, is listed in \`PICKS\` in that script.

### Why not sprites ripped from a commercial game

Sites that archive extracted sprites from published games are not a source this
project can use, however convenient they are and whatever attribution is
offered alongside them. Those assets belong to their publishers, the archive
has no licence to pass on, and crediting a rights holder is not the same as
having permission from one. Nothing here is worth a takedown notice on a public
repository, and the game was designed from the start not to need any of it —
see the first section of this file.

## Crests, board and everything else

The heraldic crest behind every unit is generated in the browser by
\`js/crest.js\` — no image files, no downloads. Each one is a deterministic
function of the card's id, so a card always wears the same crest and the whole
set costs nothing to ship. The board, cards, type scale and palette are CSS in
\`css/app.css\`.

The interface skeleton (front door, the hold-to-open panel button, the card kit)
is [kidsuite](https://github.com/minormending/kidsuite), and the room sync is
[kidsync](https://github.com/minormending/kidsync), both vendored into
\`suite/\` and \`sync/\` and both the author's own.

## Fonts

None are downloaded. The game asks for a system serif and the platform's own UI
stack, so there is no webfont licence to honour and nothing to load.
`;
await writeFile('ATTRIBUTION.md', doc);
console.log('ATTRIBUTION.md written,', doc.split('\n').length, 'lines');
