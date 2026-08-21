/* The opponent. Entirely local: no key, no request, no service.

   It is a scorer, not a model. Every legal move is simulated on a throwaway
   copy of the board, the resulting position is scored, and the best one is
   played. That sounds crude and is in fact the reason it plays well — because
   the simulation runs through the real engine, the score of an attack already
   accounts for the counterattack, the double from a speed lead, the triangle
   bonus and whether anybody dies. None of that has to be re-taught here, and
   none of it can drift out of step with the rules.

   What is left for this file is the part simulation cannot tell you: how much a
   position is WORTH. That is `evaluate`, and it is where the personality lives.

   Difficulty is not a different algorithm. It is four knobs on the same one —
   how deep it looks, how willing it is to play a merely-adequate move, how
   much it values hurting you over staying safe, and how often it takes the
   second-best move instead of the best. A weaker opponent that plays sloppily
   is better company than one that plays well and slowly.                     */

window.AI = (function () {
  'use strict';

  var C = window.Cards, E = window.Engine;

  // ── Difficulty ───────────────────────────────────────────────────────────

  var LEVELS = {
    gentle: {
      label: 'Gentle', badge: 'hp',
      note: 'Plays honestly, misses chances, and will let a mistake go.',
      depth: 1, topK: 3, slack: 30, aggression: 0.65, threshold: 6,
    },
    steady: {
      label: 'Steady', badge: 'def',
      note: 'Takes the good trades and defends its Sovereign. A fair game.',
      depth: 1, topK: 2, slack: 12, aggression: 1.0, threshold: 0,
    },
    keen: {
      label: 'Keen', badge: 'clash',
      note: 'Reads your reply before it moves. Punishes a loose front row.',
      depth: 2, topK: 1, slack: 0, aggression: 1.15, threshold: -8,
    },
  };

  /* Every number the opponent weighs a position with, in one table.
     Same reasoning as js/cards.js holding all the balance: tuning should be
     one file and one place, and tools/ai-bench.mjs can sweep these directly to
     check a hunch against 240 mirrored games instead of a feeling. */
  var W = {
    sovLinear:   300,   // Sovereign value at full health
    sovSquared:  200,   // ...and the part that makes the last HP matter most
    alive:        25,   // flat per living unit — this is what makes kills beat chip
    bodyPerCost:  10,   // scaled by remaining health
    perHp:         1.2,
    kitPerCost:    5,
    rangedBack:   14,   // where a ranged unit wants to be
    rangedFront: -14,   // exposed, and answerable
    meleeBack:   -22,   // idle behind the line
    frontOne:     34,   // front row held by one
    frontTwo:     58,   // ...or by two or more
    perHandCard:   6,
    perEnergy:    -3,   // unspent energy is a wasted option
  };

  var WIN = 1e6;
  var MAX_ACTIONS = 24;        // safety net; a turn cannot run away
  /* How many candidates get the deeper look. Measured, not guessed: at 6 the
     keen level scored 67.9% against a random player, at 14 it scored 71.8%, and
     removing the cap entirely bought only another point for half again the
     time. 14 is where the curve flattens. Costs about 8ms a move. */
  var LOOKAHEAD_BRANCHES = 14;

  /* How heavily the opponent's best reply counts against a move.
     Not 1. The reply is a RISK, not a settled fact — the turn is not actually
     over (more moves are coming), the opponent may not find the best answer,
     and the position will have moved by the time they try. Charging a move the
     full value of the punish made the keen level turtle: it declined anything
     that could be answered, games ran to the turn cap, and it went from
     beating the steady level to LOSING to it. Measured, mirror-matched:

       discount   vs random   vs steady   avg turns
         0.3        74.0%       60.0%        33
         0.5        74.5%       54.4%        35
         1.0        71.0%       46.9%        39                              */
  var REPLY_DISCOUNT = 0.3;

  // ── Position value ───────────────────────────────────────────────────────

  /* What one unit on the board is worth.
     Cost is a decent proxy for "how hard was this to put here", and health
     scales it — a Hewer on 2 HP is not worth a Hewer. Kept separate from raw HP
     so that chipping a big unit registers as progress without making a
     nearly-dead expensive unit look valuable. */
  function unitValue(slot) {
    var frac = slot.u.hp / slot.u.maxHp;
    var card = C.get(slot.u.ref);

    if (slot.u.sovereign) {
      // The Sovereign is not a unit you trade. Its health IS the match, so it
      // is valued steeply and non-linearly: the last few points matter most.
      return W.sovLinear * frac + W.sovSquared * frac * frac;
    }

    /* The flat term is the important one. Everything else scales with health,
       so without it, chipping two units for 5 each scores the same as killing
       one — when killing is strictly better, because a dead unit stops
       attacking. `alive` is the value that only a kill can take away. */
    var alive = W.alive;
    var body = (card.cost + 1) * W.bodyPerCost * frac;
    var flesh = slot.u.hp * W.perHp;
    var kit = slot.w ? (C.get(slot.w).cost + 1) * W.kitPerCost : 0;
    return alive + body + flesh + kit;
  }

  /* Positional sense, which the simulation cannot supply because it is about
     where a unit is rather than what just happened to it. Three facts:
       · a ranged unit belongs in the back row, where nothing can answer it
       · a melee unit in the back row is doing nothing at all
       · a held front row is what keeps the Sovereign out of reach */
  function shape(p) {
    var score = 0, frontHeld = 0;

    E.occupied(p).forEach(function (pos) {
      var slot = p.field[pos.r][pos.c];
      var ranged = E.isRanged(slot);
      if (pos.r === E.FRONT) {
        frontHeld++;
        if (ranged) score += W.rangedFront;  // exposed, and answerable
      } else {
        if (ranged) score += W.rangedBack;   // exactly where it wants to be
        else if (!slot.u.sovereign) score += W.meleeBack;  // idle behind the line
      }
    });

    /* The single most valuable fact about a position: whether the front row is
       held. An empty front row is not a small disadvantage, it is the enemy
       being able to reach the Sovereign, so this is stepped rather than linear
       and weighted to compete with material. Getting this wrong is what made
       an earlier version play like a coin flip — the positional terms were
       around 10 points against material swings of 50, so position never
       decided anything. */
    var sovInBack = p.field[E.BACK].some(function (s) { return s && s.u.sovereign; });
    if (sovInBack) score += frontHeld === 0 ? 0 : (frontHeld === 1 ? W.frontOne : W.frontTwo);

    return score;
  }

  function sideValue(p) {
    var total = shape(p);
    E.occupied(p).forEach(function (pos) {
      total += unitValue(p.field[pos.r][pos.c]);
    });
    // Cards in hand are options; unspent energy is an option wasted.
    total += p.hand.length * W.perHandCard;
    total += p.energy * W.perEnergy;
    return total;
  }

  function evaluate(state, side) {
    if (state.winner === side) return WIN;
    if (state.winner === 1 - side) return -WIN;
    if (state.winner === 'draw') return 0;
    return sideValue(state.players[side]) - sideValue(state.players[1 - side]);
  }

  /* The part of a move's value that is "damage done to them" rather than
     "safety gained for me". Aggression scales only this, so a timid opponent
     still defends properly instead of becoming uniformly passive. */
  function aggressionPart(before, after, side) {
    var foe = 1 - side;
    return sideValue(before.players[foe]) - sideValue(after.players[foe]);
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  function simulate(state, mv) {
    var next = E.clone(state);
    next.setup = state.setup;            // shared, immutable, no need to copy
    var res = E.applyMove(next, mv);
    return res.ok ? next : null;
  }

  /* One reply deep: after our move, how much can they take back? Used only for
     the keen level, and only on the best few candidates, because the cost is
     branches × replies.

     The turn has to be CLOSED first. An earlier version asked this question
     while it was still our own turn, so `state.cur` was never the opponent and
     the whole lookahead silently returned 0 — keen and steady played
     identically. Ending the turn in the simulation is also the right question
     to ask: "if I stopped here, what would they do to me?" */
  function opponentBest(state, side) {
    var foe = 1 - side;
    if (state.winner !== null) return 0;

    var s = state;
    if (s.cur === side) {
      s = E.clone(state);
      s.setup = state.setup;
      if (!E.applyMove(s, { s: side, t: 'end' }).ok) return 0;
      if (s.winner !== null) return 0;
    }
    if (s.cur !== foe) return 0;
    var state_ = s;

    var replies = E.legalMoves(state_).filter(function (m) { return m.t !== 'end'; });
    var worst = 0;
    var basis = evaluate(state_, side);
    for (var i = 0; i < replies.length; i++) {
      var after = simulate(state_, replies[i]);
      if (!after) continue;
      var swing = basis - evaluate(after, side);
      if (swing > worst) worst = swing;
    }
    return worst;
  }

  // ── Choosing ─────────────────────────────────────────────────────────────

  function scoreMove(state, mv, side, cfg) {
    var after = simulate(state, mv);
    if (!after) return null;

    var gain = evaluate(after, side) - evaluate(state, side);

    if (cfg.aggression !== 1) {
      var agg = aggressionPart(state, after, side);
      gain += (cfg.aggression - 1) * agg;
    }

    return { mv: mv, score: gain, after: after };
  }

  function pick(state, cfg, rand) {
    var side = state.cur;
    var moves = E.legalMoves(state);
    if (!moves.length) return null;

    var scored = [];
    for (var i = 0; i < moves.length; i++) {
      var s = scoreMove(state, moves[i], side, cfg);
      if (s) scored.push(s);
    }
    if (!scored.length) return null;

    scored.sort(function (a, b) { return b.score - a.score; });

    /* Deeper look at the head of the list. A move that hands the opponent a
       kill is exactly the move a greedy scorer loves, so this is where the
       strength difference between steady and keen comes from.

       Passing is penalised HERE TOO, and that is the whole trick. An earlier
       version subtracted the opponent's punish from every real move but left
       `end` sitting at zero, so every real move scored worse than passing and
       keen simply ended its turn, every turn, forever — it lost to a random
       player. Either all candidates carry the reply or none of them do. */
    if (cfg.depth >= 2) {
      var head = scored.slice(0, LOOKAHEAD_BRANCHES);
      var endCand = null;
      for (var e = 0; e < scored.length; e++) {
        if (scored[e].mv.t === 'end') { endCand = scored[e]; break; }
      }
      if (endCand && head.indexOf(endCand) < 0) head.push(endCand);
      head.forEach(function (cand) {
        cand.score -= REPLY_DISCOUNT * opponentBest(cand.after, side);
      });
      scored.sort(function (a, b) { return b.score - a.score; });
    }

    // A winning move is never passed up, whatever the margin says.
    if (scored[0].score >= WIN / 2) return scored[0].mv;

    /* The bar to clear is PASSING, not an absolute number. `threshold` is how
       much better than ending the turn a move has to be before it is worth
       making — which is what the difficulty knob actually means, and which
       behaves the same at either search depth. */
    var endScore = 0;
    for (var j = 0; j < scored.length; j++) {
      if (scored[j].mv.t === 'end') { endScore = scored[j].score; break; }
    }

    var real = scored.filter(function (c) {
      return c.mv.t !== 'end' && c.score > endScore + cfg.threshold;
    });
    if (!real.length) return { s: side, t: 'end' };

    /* Vary only between moves that are actually COMPARABLE.
       Sampling the top K by rank alone was a real bug, not a stylistic choice:
       with topK 2 the opponent would weigh a kill worth 49 against a poke worth
       -0.3 and take the poke half the time, because both were "in the top two".
       `slack` is the margin that decides what counts as a genuine alternative,
       so a clearly best move is always played and a close call is where the
       personality shows. */
    var best = real[0].score;
    var near = real.filter(function (c) { return c.score >= best - cfg.slack; });
    var k = Math.max(1, Math.min(cfg.topK, near.length));
    var idx = k === 1 ? 0 : Math.floor((rand || Math.random)() * k);
    return near[idx].mv;
  }

  // ── The turn ─────────────────────────────────────────────────────────────

  /* One move at a time, so the interface can show each one landing instead of
     a whole turn resolving in a single frame. The caller applies what it gets
     back and asks again; the move it applies is the move that goes in the log,
     which is why replay never has to re-run any of this. */
  function next(state, level, rand) {
    var cfg = LEVELS[level] || LEVELS.steady;
    if (state.winner !== null) return null;
    return pick(state, cfg, rand);
  }

  /* The whole turn at once, for tests and for the "skip the animation" path.
     Returns the moves in the order they must be applied. */
  function turn(state, level, rand) {
    var cfg = LEVELS[level] || LEVELS.steady;
    var work = E.clone(state);
    work.setup = state.setup;
    var out = [];

    for (var i = 0; i < MAX_ACTIONS; i++) {
      if (work.winner !== null) break;
      var mv = pick(work, cfg, rand);
      if (!mv) break;
      var res = E.applyMove(work, mv);
      if (!res.ok) break;
      out.push(mv);
      if (mv.t === 'end') break;
    }
    // A turn must always be closed out, or the match stops.
    if (!out.length || out[out.length - 1].t !== 'end') {
      out.push({ s: state.cur, t: 'end' });
    }
    return out;
  }

  return {
    LEVELS: LEVELS, W: W, next: next, turn: turn,
    evaluate: evaluate, unitValue: unitValue,
  };
})();
