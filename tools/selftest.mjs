/* Engine self-test. Run with: node tools/selftest.mjs
 *
 * The engine is a pure function of (setup, moves) and the whole project leans
 * on that: live sync, spectating and replay all assume two machines replaying
 * the same list land on the same board. These checks exist to catch the day
 * that stops being true. */

import { readFileSync } from 'node:fs';

// The game ships as classic scripts against `window`; give them one.
const win = {};
globalThis.window = win;
for (const f of ['js/rng.js', 'js/cards.js', 'js/engine.js', 'js/ai.js']) {
  try { new Function(readFileSync(f, 'utf8'))(); } catch (e) {
    if (!f.includes('ai.js')) throw new Error(`loading ${f}: ${e.message}`);
  }
}
const { Rng, Cards, Engine, AI } = win;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

// ── 1. A fresh board ──────────────────────────────────────────────────────
const setup = Engine.makeSetup({ seed: 424242, decks: ['ashfell', 'storm'], names: ['A', 'B'] });
const s0 = Engine.start(setup);
ok('turn starts at 1', s0.turn === 1);
ok('player 0 leads', s0.cur === 0);
ok('hands are 4 and 5', s0.players[0].hand.length === 4 && s0.players[1].hand.length === 5,
   `${s0.players[0].hand.length}/${s0.players[1].hand.length}`);
ok('both Sovereigns are deployed', !!s0.players[0].field[1][1] && !!s0.players[1].field[1][1]);
ok('Sovereigns are Sovereigns', s0.players[0].field[1][1].u.sovereign);
ok('deck holds the rest', s0.players[0].deck.length === Cards.RULES.DECK_SIZE - 4);
ok('opening energy', s0.players[0].energy === Cards.RULES.ENERGY_START);
ok('no attacks on turn 1', !Engine.legalMoves(s0).some(m => m.t === 'atk'));

// ── 2. Determinism: same inputs, same board, twice ────────────────────────
function randomGame(seed, decks, maxMoves = 400) {
  const setup = Engine.makeSetup({ seed, decks, names: ['A', 'B'] });
  const rand = Rng.make(seed ^ 0x5bf03635);
  const moves = [];
  let state = Engine.start(setup);
  while (state.winner === null && moves.length < maxMoves) {
    const legal = Engine.legalMoves(state);
    if (!legal.length) break;
    // Prefer doing something over ending the turn, or nothing ever happens.
    const acts = legal.filter(m => m.t !== 'end');
    const pick = acts.length && rand() < 0.85
      ? acts[Math.floor(rand() * acts.length)]
      : legal[legal.length - 1];
    const res = Engine.applyMove(state, pick);
    if (res.ok) moves.push(pick);
    else break;
  }
  return { setup, moves, state };
}

const g = randomGame(9001, ['ashfell', 'ivory']);
const a = Engine.derive(g.setup, g.moves);
const b = Engine.derive(g.setup, g.moves);
ok('derive is deterministic', JSON.stringify(a) === JSON.stringify(b));
ok('derive matches live play', JSON.stringify(a.players) === JSON.stringify(g.state.players));
ok('every recorded move was legal', a.rejected.length === 0,
   a.rejected.length ? JSON.stringify(a.rejected[0]) : '');

// ── 3. Replay prefixes are stable (the scrubber's core assumption) ────────
let prefixOk = true;
for (let i = 0; i <= g.moves.length; i++) {
  const x = Engine.derive(g.setup, g.moves, i);
  const y = Engine.derive(g.setup, g.moves, i);
  if (JSON.stringify(x) !== JSON.stringify(y)) { prefixOk = false; break; }
}
ok('every prefix replays identically', prefixOk);

// ── 4. Illegal moves are skipped, not fatal ──────────────────────────────
const junk = [
  { s: 1, t: 'dep', h: 0, r: 0, c: 0 },       // wrong side
  { s: 0, t: 'atk', fr: 0, fc: 0, tr: 0, tc: 0 },  // turn 1, nobody there
  { s: 0, t: 'dep', h: 99, r: 0, c: 0 },      // no such card
  { s: 0, t: 'nope' },                         // unknown
  { s: 0, t: 'dep', h: 0, r: 9, c: 9 },        // off board
];
const withJunk = Engine.derive(setup, junk);
ok('junk is rejected wholesale', withJunk.rejected.length === junk.length,
   `${withJunk.rejected.length}/${junk.length}`);
ok('junk leaves the board untouched',
   JSON.stringify(withJunk.players) === JSON.stringify(s0.players));

// ── 5. Games actually finish, across every deck pairing ──────────────────
const ids = Cards.DECKS.map(d => d.id);
let finished = 0, total = 0, longest = 0, longestBytes = 0;
for (const d0 of ids) for (const d1 of ids) {
  for (let k = 0; k < 6; k++) {
    total++;
    const r = randomGame(1000 + total * 7919, [d0, d1]);
    if (r.state.winner !== null) finished++;
    if (r.moves.length > longest) longest = r.moves.length;
    const bytes = JSON.stringify(r.moves).length;
    if (bytes > longestBytes) longestBytes = bytes;
  }
}
ok('random games reach a result', finished === total, `${finished}/${total}`);

// ── 6. The move log fits kidsync's 32KB room ─────────────────────────────
ok('longest log fits the room budget', longestBytes < 24 * 1024,
   `${longestBytes} bytes over ${longest} moves`);

// ── 7. Combat maths ──────────────────────────────────────────────────────
// Triangle: sword beats axe, and the bonus is one-directional.
ok('triangle bonus', Cards.triangle('sword', 'axe') === Cards.RULES.TRIANGLE_BONUS);
ok('no reverse bonus', Cards.triangle('axe', 'sword') === 0);
ok('bow sits outside', Cards.triangle('bow', 'sword') === 0 && Cards.triangle('sword', 'bow') === 0);

// ── 8. Reach: the front row is a wall ────────────────────────────────────
{
  const st = Engine.start(setup);
  const p = st.players[0], foe = st.players[1];
  // Enemy has only its back-centre Sovereign; front row is empty.
  ok('back row reachable when front is empty',
     Engine.canReach(p, foe, { r: 1, c: 1 }, { r: 1, c: 1 }));
  // Put a body in the enemy front row.
  foe.field[0][0] = { u: JSON.parse(JSON.stringify(foe.field[1][1].u)), w: null, acted: false };
  ok('back row shielded once the front is held',
     !Engine.canReach(p, foe, { r: 1, c: 1 }, { r: 1, c: 1 }));
  ok('front row still reachable',
     Engine.canReach(p, foe, { r: 1, c: 1 }, { r: 0, c: 0 }));
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`games: ${finished}/${total} finished · longest ${longest} moves · ${longestBytes} bytes`);
process.exit(fail ? 1 : 0);
