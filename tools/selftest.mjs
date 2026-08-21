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
globalThis.addEventListener = () => {};
win.addEventListener = () => {};
for (const f of ['js/rng.js', 'js/cards.js', 'js/engine.js', 'js/ai.js',
                 'js/crest.js', 'js/sync-host.js']) {
  new Function(readFileSync(f, 'utf8'))();
}
const { Rng, Cards, Engine, AI, Crest, Sync } = win;

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

// ── 9. Tactics the player will actually notice ───────────────────────────
//
// Win rate against a random player turned out to be a poor way to judge this:
// a weight sweep moved it by ~1%, which is inside the noise, because most turns
// in this game have one obvious play that both a bot and a coin will find. What
// a person notices instead is whether the opponent misses a kill, throws a unit
// away, or stands its archers in the front rank. So those are checked directly.

function board(decks, hands) {
  const setup = Engine.makeSetup({ seed: 555, decks, names: ['A', 'B'] });
  const st = Engine.start(setup);
  st.turn = 4;                       // past the opening-turn attack ban
  st.cur = 0;
  st.players[0].energy = 8;
  if (hands) { st.players[0].hand = hands[0]; st.players[1].hand = hands[1]; }
  return st;
}

/** Drop a unit onto the board directly, at a chosen health. */
function place(st, side, r, c, ref, hp) {
  const inst = Engine.derive(st.setup, []);       // borrow a clean instantiation
  const p = st.players[side];
  const proto = Engine.start(st.setup).players[side].field[1][1];
  const card = Cards.get(ref);
  p.field[r][c] = {
    u: {
      ref, name: card.name, cls: card.cls, at: card.at, art: card.art,
      st: { ...card.st }, hp: hp == null ? card.st.hp : hp, maxHp: card.st.hp,
      tags: card.tags.slice(), fx: JSON.parse(JSON.stringify(card.fx)),
      sovereign: !!card.sovereign,
    },
    w: null, acted: false,
  };
  return p.field[r][c];
}

function clearField(st, side) {
  st.players[side].field = [[null, null, null], [null, null, null]];
}

// 9a. A lethal blow on the Sovereign is never passed up.
//
// Note the attacker and target: the first version of this test used a Reaver
// against the armoured Sovereign, whose DEF 10 reduces it to 1 damage a hit —
// so declining was CORRECT play and the test was wrong. A Hewer against the
// lightly-armoured Sovereign actually threatens lethal.
{
  const st = board(['ashfell', 'storm'], [[], []]);
  clearField(st, 0); clearField(st, 1);
  place(st, 0, 0, 0, 'u:hewer');               // STR 10, ours, front, can reach
  place(st, 1, 1, 1, 'u:sov-storm', 3);        // DEF 5 — 5 damage gets there
  const mv = AI.next(st, 'steady', Rng.make(1));
  ok('takes the lethal blow on the Sovereign',
     mv && mv.t === 'atk' && mv.tr === 1 && mv.tc === 1, JSON.stringify(mv));
}

// 9b. A unit is not thrown away for one point of damage.
{
  const st = board(['ashfell', 'ivory'], [[], []]);
  clearField(st, 0); clearField(st, 1);
  place(st, 0, 0, 0, 'u:shade', 3);            // 3 HP, will die to the answer
  place(st, 0, 1, 1, 'u:sov-ash');             // so the side is not routed
  place(st, 1, 0, 0, 'u:hewer');               // 26 HP, DEF 7, STR 10
  place(st, 1, 1, 1, 'u:sov-ivory');
  const mv = AI.next(st, 'steady', Rng.make(1));
  const suicide = mv && mv.t === 'atk' && mv.fr === 0 && mv.fc === 0;
  ok('refuses to trade a unit for 1 damage', !suicide, JSON.stringify(mv));
}

// 9c. A kill is preferred over chipping something bigger.
{
  const st = board(['ashfell', 'ivory'], [[], []]);
  clearField(st, 0); clearField(st, 1);
  place(st, 0, 0, 1, 'u:hewer');               // STR 10
  place(st, 0, 1, 1, 'u:sov-ash');
  place(st, 1, 0, 0, 'u:shade', 4);            // killable outright
  place(st, 1, 0, 2, 'u:warden');              // 24 HP, only chippable
  place(st, 1, 1, 1, 'u:sov-ivory');
  const mv = AI.next(st, 'steady', Rng.make(1));
  ok('takes the kill over the chip',
     mv && mv.t === 'atk' && mv.tr === 0 && mv.tc === 0, JSON.stringify(mv));
}

// 9d. Melee holds the front; archers go behind it.
{
  const st = board(['ashfell', 'storm'], [['u:vanguard', 'u:marksman'], []]);
  clearField(st, 0); clearField(st, 1);
  place(st, 0, 1, 1, 'u:sov-ash');
  place(st, 1, 0, 0, 'u:warden');
  place(st, 1, 1, 1, 'u:sov-ivory');
  st.players[0].energy = 8;
  // Let it make its deployments, then look at where things ended up.
  for (let i = 0; i < 4; i++) {
    const mv = AI.next(st, 'steady', Rng.make(i + 1));
    if (!mv || mv.t === 'end') break;
    if (!Engine.applyMove(st, mv).ok) break;
  }
  const where = (cls) => {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const s = st.players[0].field[r][c];
      if (s && s.u.cls === cls) return r;
    }
    return -1;
  };
  ok('the Vanguard took the front rank', where('Vanguard') === Engine.FRONT, `row ${where('Vanguard')}`);
  ok('the Marksman stayed behind it', where('Marksman') === Engine.BACK, `row ${where('Marksman')}`);
}

// 9e. Every level closes out its turn rather than stalling.
['gentle', 'steady', 'keen'].forEach((lv) => {
  const st = board(['ashfell', 'ivory'], null);
  const moves = AI.turn(st, lv, Rng.make(3));
  ok(`${lv} ends its turn`, moves.length > 0 && moves[moves.length - 1].t === 'end',
     JSON.stringify(moves.slice(-1)));
});

// ── 10. The sync merge, which has to satisfy kidsync's one hard rule ─────
//
// kidsync's README is emphatic that a merge must SETTLE: merging the same two
// states twice has to give what merging them once gave, or two devices push
// each other's results back and forth forever. A move list makes that easy —
// union by move number — but the tie-breaks around it are where it could be
// lost, so the algebra is checked rather than assumed.
{
  const j = (x) => JSON.stringify(x);
  const A = {
    match: { v: 1, seed: 5, decks: ['ashfell', null] },
    names: { '0': 'Kev' }, seats: { '0': 'devA' }, moves: { '0': { s: 0, t: 'end' } },
  };
  const B = {
    match: { v: 1, seed: 5, decks: [null, 'storm'] },
    names: { '1': 'Sam' }, seats: { '1': 'devB' }, moves: { '1': { s: 1, t: 'end' } },
  };
  const m = Sync.merge(A, B);

  ok('both seats’ deck choices survive the merge',
     m.match.decks[0] === 'ashfell' && m.match.decks[1] === 'storm', j(m.match.decks));
  ok('seats union', m.seats['0'] === 'devA' && m.seats['1'] === 'devB');
  ok('moves union by number', Object.keys(m.moves).length === 2);
  ok('merge is commutative', j(Sync.merge(A, B)) === j(Sync.merge(B, A)));
  ok('merge is idempotent', j(Sync.merge(A, Sync.merge(A, B))) === j(Sync.merge(A, B)));
  ok('merge settles on one pass', j(Sync.merge(m, m)) === j(m));

  // Two devices writing different moves at the same index must agree on which
  // one survives, or they diverge permanently.
  const C1 = { match: null, names: {}, seats: {}, moves: { '0': { s: 0, t: 'end' } } };
  const C2 = { match: null, names: {}, seats: {}, moves: { '0': { s: 0, t: 'res' } } };
  ok('a same-index clash resolves identically on both devices',
     j(Sync.merge(C1, C2)) === j(Sync.merge(C2, C1)));

  // An empty local record joining a room must adopt the room wholesale, or a
  // leftover match from a previous room would union into the new one.
  const room = { match: { v: 1, seed: 9, decks: ['ivory', 'storm'] },
                 names: { '0': 'H' }, seats: { '0': 'devH' }, moves: { '0': { s: 0, t: 'end' } } };
  const joined = Sync.merge(Sync.emptyState(), room);
  ok('an emptied device adopts the room it joins', j(joined) === j(room), j(joined));
}

// ── 11. Crests are stable and mostly distinct ────────────────────────────
{
  const refs = [
    ...Cards.UNITS.map(c => 'u:' + c.id),
    ...Cards.WEAPONS.map(c => 'w:' + c.id),
    ...Cards.ITEMS.map(c => 'i:' + c.id),
  ];
  ok('a crest is the same every time',
     Crest.hash('u:vanguard') === Crest.hash('u:vanguard'));
  const seen = new Set(refs.map(r => {
    const d = Crest.describe(r);
    return [d.tincture.name, d.division, d.bordered, d.flipped].join('/');
  }));
  // 8 tinctures x 6 divisions x 2 x 2 = 192 designs for 39 cards, so a couple
  // of repeats is expected arithmetic, not a bug — the class icon still differs.
  ok('crests are nearly all distinct', seen.size >= refs.length - 3,
     `${seen.size} designs for ${refs.length} cards`);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`games: ${finished}/${total} finished · longest ${longest} moves · ${longestBytes} bytes`);
process.exit(fail ? 1 : 0);
