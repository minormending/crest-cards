/* Opponent strength bench. Run with: node tools/ai-bench.mjs [games]
 *
 * Two things this has to get right, learned by getting them wrong:
 *
 * 1. MIRROR THE MATCHES. Deck matchup and going first both swing this game
 *    hard enough to drown the difference between two levels of play. Every
 *    pairing is therefore played twice on the same seed with the same decks in
 *    the same seats, swapping only which brain drives which side. A win for
 *    "the better player" then has to come from play, because everything else
 *    was identical in the mirror.
 * 2. USE ENOUGH GAMES. A game costs milliseconds; 24 of them is a coin flip.
 *    The default is 240 mirrored pairs.                                      */

import { readFileSync } from 'node:fs';
const win = {}; globalThis.window = win;
for (const f of ['js/rng.js', 'js/cards.js', 'js/engine.js', 'js/ai.js'])
  new Function(readFileSync(f, 'utf8'))();
const { Rng, Cards, Engine, AI } = win;

const PAIRS = Number(process.argv[2] || 240);
const IDS = Cards.DECKS.map(d => d.id);

// ── Reference players, as floors to clear ─────────────────────────────────

/** Uniform over legal moves, biased towards doing something. */
const randomPlayer = (state, rand) => {
  const legal = Engine.legalMoves(state);
  const acts = legal.filter(m => m.t !== 'end');
  return acts.length && rand() < 0.85
    ? acts[Math.floor(rand() * acts.length)] : { s: state.cur, t: 'end' };
};

/** A plausible beginner: hit the weakest thing you can reach, otherwise put
 *  the most expensive affordable unit on the board. No positional sense. */
const greedyPlayer = (state) => {
  const legal = Engine.legalMoves(state);
  const foe = state.players[1 - state.cur];
  const atks = legal.filter(m => m.t === 'atk');
  if (atks.length) {
    atks.sort((a, b) => foe.field[a.tr][a.tc].u.hp - foe.field[b.tr][b.tc].u.hp);
    return atks[0];
  }
  const deps = legal.filter(m => m.t === 'dep');
  if (deps.length) {
    const cost = m => Cards.get(state.players[state.cur].hand[m.h]).cost;
    deps.sort((a, b) => cost(b) - cost(a));
    return deps[0];
  }
  return { s: state.cur, t: 'end' };
};

const level = name => (state, rand) => AI.next(state, name, rand);

// ── One game ──────────────────────────────────────────────────────────────

function play(side0, side1, seed, decks) {
  const setup = Engine.makeSetup({ seed, decks, names: ['A', 'B'] });
  const rand = Rng.make(seed ^ 0xabcdef);
  const state = Engine.start(setup);
  let guard = 0;
  while (state.winner === null && guard++ < 4000) {
    const mv = (state.cur === 0 ? side0 : side1)(state, rand);
    if (!mv || !Engine.applyMove(state, mv).ok) break;
  }
  return state;
}

/* One mirrored pair: identical seed, identical decks, identical seats, only
   the brains swapped. Returns A's score over the two games (win 1, draw ½). */
function mirror(A, B, seed, decks) {
  const g1 = play(A, B, seed, decks);
  const g2 = play(B, A, seed, decks);
  const pts = (s, aSide) =>
    s.winner === null ? 0.5 : s.winner === 'draw' ? 0.5 : s.winner === aSide ? 1 : 0;
  return { a: pts(g1, 0) + pts(g2, 1), unfinished: (g1.winner === null) + (g2.winner === null) };
}

function match(A, B, aName, bName, pairs = PAIRS) {
  let aPts = 0, unfinished = 0;
  const t0 = Date.now();
  for (let i = 0; i < pairs; i++) {
    const decks = [IDS[i % 3], IDS[Math.floor(i / 3) % 3]];
    const r = mirror(A, B, 100003 + i * 7919, decks);
    aPts += r.a; unfinished += r.unfinished;
  }
  const games = pairs * 2;
  const rate = aPts / games;
  const ms = Math.round((Date.now() - t0) / games);
  console.log(`  ${aName.padEnd(7)} vs ${bName.padEnd(7)}  ${(rate * 100).toFixed(1)}%` +
    `  (${aPts}/${games})  ${ms}ms/game${unfinished ? `  UNFINISHED ${unfinished}` : ''}`);
  return rate;
}

console.log(`mirror-matched, ${PAIRS} pairs = ${PAIRS * 2} games per row\n`);
console.log('against the floors:');
const vr = {
  gentle: match(level('gentle'), randomPlayer, 'gentle', 'random'),
  steady: match(level('steady'), randomPlayer, 'steady', 'random'),
  keen:   match(level('keen'),   randomPlayer, 'keen',   'random'),
};
const vg = {
  steady: match(level('steady'), greedyPlayer, 'steady', 'greedy'),
  keen:   match(level('keen'),   greedyPlayer, 'keen',   'greedy'),
};
console.log('\nagainst each other:');
const ladder = {
  ks: match(level('keen'),   level('steady'), 'keen',   'steady'),
  sg: match(level('steady'), level('gentle'), 'steady', 'gentle'),
  kg: match(level('keen'),   level('gentle'), 'keen',   'gentle'),
};

/* The bars below are set from measured behaviour, not from ambition. Useful
   context for reading them, all mirror-matched against the random player:

     does nothing       0%      the game is not degenerate
     never attacks     22%      attacking is most of the game
     random            50%      by definition
     steady            66%
     keen              72%

   A ceiling well under 100% is expected rather than disappointing: a deck's
   draw order is luck the best play cannot undo, and many turns in a six-slot
   game have one obvious move that a coin will also find. What these thresholds
   exist to catch is a REGRESSION — an evaluation change that quietly makes the
   opponent worse, or a level that stops being distinguishable from the one
   below it. Tactical quality is checked separately and more sharply by the
   scenarios in tools/selftest.mjs, which is where a bug like "prefers a poke
   worth -0.3 to a kill worth 49" actually got caught. */
console.log('\nverdict:');
const check = (name, rate, min) => {
  const good = rate >= min;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${name} ${(rate * 100).toFixed(1)}% (want >=${min * 100}%)`);
  return good;
};
let allGood = true;
allGood &= check('steady beats random', vr.steady, 0.62);
allGood &= check('keen beats random',   vr.keen,   0.66);
allGood &= check('steady beats greedy', vg.steady, 0.60);
allGood &= check('keen beats greedy',   vg.keen,   0.60);
allGood &= check('keen over steady',    ladder.ks, 0.52);
allGood &= check('steady over gentle',  ladder.sg, 0.55);
allGood &= check('keen over gentle',    ladder.kg, 0.57);
process.exit(allGood ? 0 : 1);
