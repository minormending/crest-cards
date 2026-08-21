# Crest Cards

A small tactical card game that runs as static files on GitHub Pages. Six
positions a side, one commander whose fall ends the match, and a weapon
triangle that decides more than it looks like it should.

**Play it: https://minormending.github.io/crest-cards/**

Three ways to play. A standalone opponent that needs no connection and no key.
A shared room, where one player reads out a code and another joins to battle
them — and a third can join to watch. And every finished match can be replayed
move by move.

No build step, no bundler, no deploy script. Pushing to `main` is the deploy.

---

## Mental model

There is one idea in this project, and everything else falls out of it.

> **A match is stored as a seed plus an ordered list of moves. Never as a
> board.** The board is always recomputed by replaying that list.

Read [`js/engine.js`](js/engine.js) and nothing else if you only read one file.
Four requirements collapse into one mechanism because of that decision:

- **Replay is the storage format**, not a feature built beside the game. The
  board at move 12 is `derive(setup, moves.slice(0, 12))` — the identical call
  live play makes. There is no second engine to keep in step, and no recording
  to go stale.
- **Two browsers agree without negotiating.** They exchange a short move list
  rather than boards to reconcile, and both compute the same result from it.
- **A spectator is nearly free.** It is a client that replays the list and never
  appends to it.
- **A grow-only sync layer can carry a turn-based game**, which is the part that
  looks impossible. See [Rooms](#rooms) below.

The price is that the engine must be a pure function of its inputs: no
`Math.random`, no `Date.now`, no DOM, nothing that could differ between two
machines. [`js/rng.js`](js/rng.js) exists so shuffles are seeded and
reproducible. A single stray source of entropy in the engine would desynchronise
a live match and corrupt every replay, silently, so that discipline is absolute.

### Illegal moves are skipped, never fatal

`applyMove` validates everything and returns a reason instead of throwing, and
`derive` skips what it rejects. A log containing an illegal move — a stale tap,
two devices writing the same slot in the same instant — replays to the same
board *everywhere*, because every client rejects the same move for the same
reason. The engine being strict is what lets the sync layer be careless.

---

## The rules

Two players, six positions each: a front rank and a back rank, three columns.

**Your Sovereign starts deployed** at back centre. It is never drawn and never
paid for, so a match always has a target, always has a way to end, and "I never
drew my commander" is not a way to lose. When a Sovereign falls, the match is
over.

**The front rank is a wall.** Nothing reaches a side's back rank until its front
rank is completely empty — ranged units included. Per-column sniping was the
alternative and it made the back rank a bad place to stand, which in a six-slot
game wastes half the board.

**What ranged buys is safety, not reach.** A ranged unit may attack *from* the
back rank, where a melee defender cannot answer it. A melee unit in the back
rank is idle unless its own front rank has been swept away.

**The triangles.** Sword beats axe beats lance beats sword. Ember beats gale
beats frost beats ember. Advantage is +2 attack; there is no penalty for being
on the losing end, because one directional bonus makes position matter without
making a bad matchup unplayable. Bow sits in neither, deliberately — the type
with no matchup to fear and none to farm.

**Combat.** Physical attacks work `STR - DEF`, arcane ones `MAG - RES`, minimum
1. Strike twice if the card says so *or* if you are 4 or more SPD faster. The
defender answers if it can reach you. `pierce` halves physical DEF; `riposte`
answers an attacker it could not otherwise reach.

**A turn.** Draw one, spend energy (2 on turn one, +1 each of your turns, capped
at 8), then deploy units, equip weapons, play items and attack — one attack per
unit. A unit cannot act the turn it arrives.

**No attacks on the opening turn.** Without that rule the one Sovereign that
attacks at range gets a free hit on an empty board before anybody can put a body
in front of it, which is not a decision, just a deck draw.

Going second is worth **one extra card**, not extra energy, which would compound
every turn.

Every stat, cost and multiplier lives in [`js/cards.js`](js/cards.js) and
nowhere else, so balancing the game means editing one file.

### On the names

Crest Cards borrows a *genre*: grid-deployed tactical skirmishes with a weapon
triangle. Mechanics are not what copyright covers. It borrows nothing else —
every unit class, character, item, faction and line of flavour text was written
for this repo, and none should ever be replaced with anything from a commercial
game. That is the whole reason the roster reads the way it does. See
[ATTRIBUTION.md](ATTRIBUTION.md).

---

## The opponent

Local. No key, no request, no service. It is a scorer, not a model: every legal
move is simulated **through the real engine**, and the resulting position is
valued. Because the simulation is the actual rules, the score of an attack
already contains the counterattack, the speed double, the triangle bonus and who
dies — none of that is re-taught in [`js/ai.js`](js/ai.js), and none of it can
drift out of step with the rules.

What is left there is how much a *position* is worth, and all of it sits in one
table (`AI.W`) so [`tools/ai-bench.mjs`](tools/ai-bench.mjs) can sweep it.

Three levels, which are four knobs on one algorithm rather than three
algorithms — how deep it looks, how much better than passing a move must be, how
much it values hurting you over staying safe, and how often it takes a
comparable alternative instead of the best move.

| level | against a random player | notes |
| --- | --- | --- |
| Gentle | 55.8% | misses chances, lets a mistake go |
| Steady | 65.8% | takes the good trades, defends its Sovereign |
| Keen   | 71.9% | reads your reply before it moves; ~5ms a move |

Mirror-matched, 180 games a row, and each level beats the one below it. For why
those numbers are lower than they might look — and why win rate turned out to be
a poor way to judge this at all — see [Benchmarking](#benchmarking).

---

## Rooms

Rooms run on [kidsync](https://github.com/minormending/kidsync), vendored into
[`sync/`](sync). kidsync was built for children's *progress* — stars earned,
levels unlocked — where the merge rule is "keep the best of both" and state only
ever grows. A board changing hands sounds like the opposite of that.

It fits because **what travels is the move list, not the board**. A move list is
grow-only in exactly the way kidsync wants: moves are only ever appended, never
edited and never removed. Merging two of them is a union keyed by move number,
which is idempotent and settles on the first pass — the property kidsync's README
is emphatic about. Both devices then run the same list through the same engine.

The shared record, in [`js/sync-host.js`](js/sync-host.js):

```
match  { v, seed, decks: [host, guest] }   decides the shuffle; set once
names  { "0": …, "1": … }                  display only; each seat's own
seats  { "0": deviceId, "1": deviceId }    who is playing
moves  { "0": move, "1": move, … }         the match itself
```

`names` sits deliberately **outside** `match`: only the seed and the two decks
decide the shuffle, so two devices disagreeing about a display name cannot
desynchronise a board — which is what lets the guest name themselves without
needing the host to write the match record.

Two subtleties there are load-bearing:

- **The local record is replaced before a room is created or joined.**
  `createRoom()` seeds the room with whatever this device is holding, which may
  be the previous match's move list — unioned into a fresh room, those stale
  moves would replay as part of the new game.
- **Replacing also drops kidsync's `_epoch`,** so a device that has rematched in
  the past does not arrive claiming a newer epoch and win the merge with an
  empty board. A rematch uses `reset()` for the same reason in reverse: bumping
  the epoch is the only thing that can make a move list *shrink*.

**Spectating** needs no extra machinery. Join a room whose seats are both taken
and you get the board, live, with nothing to append.

**The trust model is kidsync's:** the room code is the password. Anyone holding
it can read and write that room. Fine for a card game; do not put anything
personal in a display name.

### Turning rooms on

Rooms are the one thing that needs setup, and the game is fully playable
without them — solo, and every replay, work offline and forever.

[`sync/firebase-config.js`](sync/firebase-config.js) ships as the canonical
placeholder template. Paste in a Firebase config and rooms light up; the file
says exactly what and where. Rooms are namespaced by game name, so one Firebase
project serves any number of games without collisions.

Those config values are **public by design** — Firebase expects them in client
code and committing them is correct. They are an address, not a secret; the
protection is [`sync/firebase-rules.json`](sync/firebase-rules.json). The
project also needs Realtime Database (not Firestore) and Anonymous sign-in.
kidsync's README covers all of it.

---

## Replays

Every finished match is kept on the device — at most 40, nothing uploaded — as
the setup and the move list it already was. The viewer scrubs, steps and plays
back through the same `derive` the live board uses.

---

## Layout

```
index.html              every screen, and the script order
css/app.css             all the paint, including the kidsuite tokens
js/rng.js               seeded, reproducible randomness
js/cards.js             every card, every deck, every balance number
js/engine.js            the rules — pure, deterministic, the only authority
js/ai.js                the standalone opponent
js/crest.js             a heraldic crest per card, generated not downloaded
js/ui.js                painting the board; no rules
js/archive.js           finished matches, on this device
js/sync-host.js         the kidsync contract and this game's merge rules
js/app.js               screens, input, and the glue
art/icons/              42 icons from game-icons.net, CC BY 3.0
sync/                   vendored kidsync
suite/                  vendored kidsuite
tools/                  tests, the AI bench, and the icon fetcher
```

Everything is a classic script against `window`, which is the convention both
vendored modules use and the reason there is no build step. The one module is
`sync/bridge.js`, loaded last: it *dynamically* imports kidsync, which pulls the
Firebase SDK from a CDN, so an unreachable CDN is one console line rather than a
page that will not load.

### The vendored modules

[kidsync](https://github.com/minormending/kidsync) provides room sync;
[kidsuite](https://github.com/minormending/kidsuite) provides the front door,
the hold-to-open panel button, and the panel's card kit. Both are vendored per
their own instructions rather than linked — these are offline-capable apps with
no build step, and a submodule would not survive Pages' deploy-from-branch.
Never edit `sync/` or `suite/` directly; edit canonical and run its
`tools/install`. Each repo's `tools/check` catches drift, and this app is listed
in both `consumers` files.

**kidsuite's `SyncCard` is deliberately not mounted.** That card calls
`handle.createRoom()` itself, which is precisely the call that must not happen
before the local record is cleared, and it pairs two devices belonging to one
person rather than two players claiming seats and each choosing a deck. The room
flow is native here; the panel reports on it.

**One upstream note.** kidsuite's README says shared stylesheets must not put
defaults in `:root`, because they load after the app's own and would silently
win — it even names the bug that caused. `landing.css` follows that rule;
`grownup.css` does not, and ships a full `:root` palette. So the `--gu-` tokens
here are declared on `:root:root` to outrank it. That leaves `suite/`
byte-identical to canonical, which is the point. Worth fixing upstream, but not
from here: it would change four other apps' panels.

---

## Tools

```sh
node tools/selftest.mjs      # 53 checks: rules, determinism, merge, icons
node tools/ai-bench.mjs      # opponent strength, mirror-matched
node tools/fetch-icons.mjs   # re-download and de-invert the icon set
node tools/gen-attribution.mjs
```

`selftest` is the one to run before trusting a change. Besides the rules it
covers the things this design leans on and would fail silently without:

- `derive` is deterministic, and **every prefix** replays identically — the
  scrubber's core assumption.
- The sync merge is commutative, idempotent, and settles in one pass.
- **Two simulated devices play a whole match through the merge alone** and agree
  on the board after every single exchange, a spectator computes the same board,
  and the finished room fits kidsync's 32KB. This is the closest thing to a
  live-room test that runs with no network — and a desync would otherwise show
  up not as an error but as two players quietly looking at different boards.
- Every icon reference resolves to a file, in both directions. A CSS mask
  pointing at a 404 fails completely silently.
- Tactics a person would notice: takes a lethal blow, refuses to trade a unit
  for 1 damage, prefers a kill to a chip, keeps archers behind the front rank.

### Benchmarking

`tools/ai-bench.mjs` mirrors every pairing — same seed, same decks, same seats,
only the brains swapped — because deck matchup and going first both swing this
game hard enough to drown the difference between two levels of play. An earlier
unmirrored version was measuring the decks.

Win rate also turned out to be a blunt instrument: a full weight sweep moved it
by about a point, inside the noise, because most turns in a six-slot game have
one obvious play that a coin will also find. For scale, all against a random
player: doing nothing scores 0%, never attacking 22%, random 50% by definition,
Steady 66%, Keen 72%. A ceiling well under 100% is expected — a deck's draw
order is luck the best play cannot undo. So the bench guards against
*regression*, and the scenarios in `selftest` guard quality. That division is
not academic: the bug where the opponent would weigh a kill worth 49 against a
poke worth −0.3 and take the poke half the time was caught by a scenario, and
was invisible to the win rate.

---

## What this deliberately does not do

- **No accounts and no server.** The room code is the only secret.
- **No deck builder.** Three presets. The interesting decision in a match this
  short is where a unit stands, not which fifteen cards were chosen an hour ago.
- **No service worker.** Adding one means a cache name to bump on every change,
  and this game is a page load, not an app you open on a train. Solo play needs
  no network once loaded.
- **No sound.**
- **Item buffs do not expire.** The cards say "permanently" and mean it. A
  duration would need per-unit expiry tracked through every replay, and a number
  printed on a card that the engine does not enforce is worse than a simpler
  card that means what it says.

## Licence

MIT, except `art/icons/` — those are CC BY 3.0 from game-icons.net and carry
their own terms. See [LICENSE](LICENSE) and
[ATTRIBUTION.md](ATTRIBUTION.md).
