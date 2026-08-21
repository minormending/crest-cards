/* Seeded randomness, because every random thing in this game has to be
   reproducible on a machine that was not there when it happened.

   A match is stored as a seed plus a list of moves — never as a board. The
   board is recomputed from those two things, by this game and by the opponent's
   browser and by a spectator's and by the replay viewer, and all four have to
   arrive at the same shuffle. Math.random cannot do that, so nothing in the
   engine is allowed to call it.

   mulberry32: one 32-bit integer of state, no dependencies, and the same
   sequence in every JS engine. It is not cryptographic and does not need to be
   — the thing that keeps a room private is its code, which kidsync draws from
   crypto.getRandomValues. This only has to be *repeatable*.                  */

window.Rng = (function () {
  'use strict';

  function make(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      var r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A fresh seed for a new match. This one may as well be properly random —
     it is chosen once, by whoever starts the game, and then written down. */
  function seed() {
    if (window.crypto && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0];
    }
    return Math.floor(Math.random() * 4294967296);
  }

  /* Fisher-Yates, out of place. Returns a new array and leaves the input alone,
     so a deck template is never quietly consumed by being dealt. */
  function shuffle(list, rand) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  /* Two seeds derived from one, so the two players' shuffles are independent.
     Seeding both decks from the same value would deal mirror-image hands from
     mirror-image decks, which is very obvious the first time it happens. */
  function split(base, index) {
    return (Math.imul(base ^ (index + 1), 0x9e3779b1) ^ (index * 0x85ebca6b)) >>> 0;
  }

  return { make: make, seed: seed, shuffle: shuffle, split: split };
})();
