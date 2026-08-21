# Attribution

Crest Cards is an original game. This file records where its art came from, and
is also the answer to "can this be published?" — everything below is either
freely licensed with credit given here, or drawn for this repo.

## The game itself is not derived from anyone's property

Crest Cards borrows a *genre*: grid-deployed tactical skirmishes with a weapon
triangle, which is a mechanic, and mechanics are not what copyright covers. It
deliberately borrows nothing else. Every unit class, character name, item,
faction and piece of flavour text in `js/cards.js` was written for this repo.
There are no names, characters, places, sprites, music or text from any
commercial game in it, and none should ever be added — that is the whole reason
the roster reads the way it does.

## Icons — game-icons.net

2 artists, 39 icons, from the
[game-icons.net](https://game-icons.net) collection
([source repository](https://github.com/game-icons/icons)).

Licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
**This licence requires the credit below to be kept**, which is why this file
ships with the game rather than living in a commit message.

- **Lorc** (https://lorcblog.blogspot.com) — 37 icons
- **Delapouite** (https://delapouite.com) — 2 icons

Each file was modified for this project in two ways, by `tools/fetch-icons.mjs`:
the full-bleed black backing rectangle was deleted, and the white glyph fill was
changed to `currentColor` so one file can be tinted per team and per state.
CC BY 3.0 permits modification; this paragraph is the required notice of it.

| file | upstream icon | artist |
| --- | --- | --- |
| `art/icons/axe.svg` | battle-axe | Lorc |
| `art/icons/bannerguard.svg` | knight-banner | Delapouite |
| `art/icons/bolt.svg` | lightning-trio | Lorc |
| `art/icons/bow.svg` | high-shot | Lorc |
| `art/icons/brigandine.svg` | mail-shirt | Lorc |
| `art/icons/clash.svg` | crossed-swords | Lorc |
| `art/icons/cloak.svg` | wing-cloak | Lorc |
| `art/icons/crown.svg` | crown | Lorc |
| `art/icons/def.svg` | checked-shield | Lorc |
| `art/icons/drakerider.svg` | wyvern | Lorc |
| `art/icons/duelist.svg` | dodging | Lorc |
| `art/icons/elixir.svg` | potion-ball | Lorc |
| `art/icons/ember.svg` | small-fire | Lorc |
| `art/icons/emberwright.svg` | burning-embers | Lorc |
| `art/icons/frost.svg` | frozen-orb | Lorc |
| `art/icons/frostbinder.svg` | frostfire | Lorc |
| `art/icons/gale.svg` | whirlwind | Lorc |
| `art/icons/galecaller.svg` | tornado | Lorc |
| `art/icons/hewer.svg` | lamellar | Lorc |
| `art/icons/hourglass.svg` | hourglass | Lorc |
| `art/icons/hp.svg` | heart-inside | Lorc |
| `art/icons/lance.svg` | spear-hook | Lorc |
| `art/icons/lancer.svg` | horse-head | Lorc |
| `art/icons/mag.svg` | magic-swirl | Lorc |
| `art/icons/marksman.svg` | archer | Delapouite |
| `art/icons/mender.svg` | prayer | Lorc |
| `art/icons/orders.svg` | scroll-unfurled | Lorc |
| `art/icons/pikeguard.svg` | trident | Lorc |
| `art/icons/reaver.svg` | axe-swing | Lorc |
| `art/icons/res.svg` | spiral-shell | Lorc |
| `art/icons/salve.svg` | heart-bottle | Lorc |
| `art/icons/shade.svg` | hood | Lorc |
| `art/icons/spd.svg` | walking-boot | Lorc |
| `art/icons/str.svg` | fist | Lorc |
| `art/icons/sword.svg` | broadsword | Lorc |
| `art/icons/vanguard.svg` | visored-helm | Lorc |
| `art/icons/warden.svg` | barbute | Lorc |
| `art/icons/whetstone.svg` | plain-dagger | Lorc |
| `art/icons/wing.svg` | feathered-wing | Lorc |

## Crests, board and everything else

The heraldic crest behind every unit is generated in the browser by
`js/crest.js` — no image files, no downloads. Each one is a deterministic
function of the card's id, so a card always wears the same crest and the whole
set costs nothing to ship. The board, cards, type scale and palette are CSS in
`css/app.css`.

The interface skeleton (front door, the hold-to-open panel button, the card kit)
is [kidsuite](https://github.com/minormending/kidsuite), and the room sync is
[kidsync](https://github.com/minormending/kidsync), both vendored into
`suite/` and `sync/` and both the author's own.

## Fonts

None are downloaded. The game asks for a system serif and the platform's own UI
stack, so there is no webfont licence to honour and nothing to load.
