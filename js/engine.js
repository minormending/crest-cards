/* The rules. Pure, deterministic, and the only file that knows how a match
   works — the interface, the opponent and the replay viewer all ask this.

   ── The one idea worth understanding ──────────────────────────────────────
   A match is never stored as a board. It is stored as a SEED plus an ordered
   LIST OF MOVES, and the board is recomputed from those by replaying them.
   Everything else in this project falls out of that one decision:

     · Replay is not a feature, it is the storage format. Showing the board at
       move 12 is `derive(setup, moves.slice(0, 12))`, which is the same call
       the live game makes.
     · Two browsers agree without negotiating. They are not sending each other
       boards to reconcile; they hold the same short list and both compute the
       same board from it. That is the only reason a spectator is nearly free.
     · A move list unions cleanly, which is what lets kidsync — built for
       grow-only progress, not for turn-taking — carry a game at all.

   The price is that this file must be a pure function of its inputs. No
   Math.random (see js/rng.js), no Date.now, no reaching into the DOM, no
   reading anything that could differ between two machines. A single stray
   source of entropy in here would desynchronise a live match and corrupt every
   replay, silently, so the discipline is absolute.

   ── Rejected moves are skipped, never fatal ───────────────────────────────
   applyMove validates everything and returns a reason instead of throwing. A
   log that contains an illegal move — a stale click, two devices writing the
   same slot in the same instant — replays to the same board everywhere,
   because every client skips exactly the same move for exactly the same
   reason. Being strict here is what makes the sync layer able to be careless. */

window.Engine = (function () {
  'use strict';

  var C = window.Cards;
  var R = C.RULES;

  var FRONT = 0, BACK = 1;

  // ── Small helpers ────────────────────────────────────────────────────────

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function emptyField() {
    return [[null, null, null], [null, null, null]];
  }

  /* A deployed unit is an INSTANCE, not the card. It carries its own HP and its
     own stats, because a Whetstone on one Vanguard must not strengthen the
     other copy still sitting in hand. */
  function instantiate(ref) {
    var c = C.get(ref);
    return {
      ref: ref, name: c.name, cls: c.cls, at: c.at, art: c.art,
      st: { hp: c.st.hp, str: c.st.str, mag: c.st.mag, def: c.st.def, res: c.st.res, spd: c.st.spd },
      hp: c.st.hp, maxHp: c.st.hp,
      tags: c.tags.slice(), fx: clone(c.fx),
      sovereign: !!c.sovereign,
    };
  }

  function inBounds(r, c) {
    return r >= 0 && r < R.ROWS && c >= 0 && c < R.COLS;
  }

  function slotAt(p, r, c) {
    return inBounds(r, c) ? p.field[r][c] : null;
  }

  function rowEmpty(p, r) {
    for (var i = 0; i < R.COLS; i++) if (p.field[r][i]) return false;
    return true;
  }

  function occupied(p) {
    var out = [];
    for (var r = 0; r < R.ROWS; r++)
      for (var c = 0; c < R.COLS; c++)
        if (p.field[r][c]) out.push({ r: r, c: c });
    return out;
  }

  function fx(slot) {
    var list = slot.u.fx.slice();
    if (slot.w) list = list.concat(C.get(slot.w).fx);
    return list;
  }

  function isRanged(slot) {
    var f = fx(slot);
    return C.hasFx(f, 'ranged') || C.hasFx(f, 'flying');
  }

  // ── Reach ────────────────────────────────────────────────────────────────
  //
  // The front row is a wall. Nothing reaches past a side's front row until that
  // row is completely empty — not a ranged unit, not a flier, not through an
  // empty column. Per-column sniping was the alternative and it made the back
  // row a bad place to stand, which in a game with six slots means half the
  // board goes unused.
  //
  // What ranged actually buys, then, is not reach but SAFETY: a ranged unit can
  // attack from the back row, where a melee defender cannot answer it. A melee
  // unit in the back row is idle unless its own front row has been swept away.

  function canReach(atk, def, from, to) {
    var a = slotAt(atk, from.r, from.c);
    var d = slotAt(def, to.r, to.c);
    if (!a || !d) return false;

    // Attacking out of the back row is a ranged privilege — unless there is no
    // front row left to stand in, in which case a melee unit steps up.
    if (from.r === BACK && !isRanged(a) && !rowEmpty(atk, FRONT)) return false;

    // The enemy front row shields the enemy back row, for everyone.
    if (to.r === BACK && !rowEmpty(def, FRONT)) return false;

    return true;
  }

  // ── Damage ───────────────────────────────────────────────────────────────

  function boost(slot, stat) {
    if (!slot.w) return 0;
    return C.get(slot.w).boost[stat] || 0;
  }

  function tagMultiplier(list, tags) {
    var best = 1;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.k === 'vs' && tags.indexOf(e.tag) >= 0 && e.mult > best) best = e.mult;
    }
    return best;
  }

  /* The whole combat formula, in one place, with no side effects — the AI calls
     this to weigh a move it has not made, and the card tooltip calls it to
     preview an exchange, so it must be safe to ask speculatively. */
  function damage(atkSlot, defSlot) {
    var arcane = C.isArcane(atkSlot.u.at);
    var stat = arcane ? 'mag' : 'str';
    var f = fx(atkSlot);

    var tri = C.triangle(atkSlot.u.at, defSlot.u.at);
    var atk = atkSlot.u.st[stat] + boost(atkSlot, stat) + tri;

    var def = arcane ? defSlot.u.st.res : defSlot.u.st.def;
    if (!arcane && C.hasFx(f, 'pierce')) def = Math.floor(def / R.PIERCE_DIVISOR);

    var base = Math.max(R.MIN_DAMAGE, atk - def);
    var mult = tagMultiplier(f, defSlot.u.tags);
    var per = Math.floor(base * mult);

    // Two ways to strike twice: the card says so, or you are simply faster.
    var bySpeed = atkSlot.u.st.spd - defSlot.u.st.spd >= R.DOUBLE_AT_SPD;
    var hits = (C.hasFx(f, 'double') || bySpeed) ? 2 : 1;

    return {
      hits: hits, per: per, total: per * hits,
      tri: tri, mult: mult, bySpeed: bySpeed, arcane: arcane,
    };
  }

  /* Would the defender answer? Melee in the front row cannot reach a ranged
     attacker sitting in the back row, which is exactly the asymmetry ranged is
     paid for. `riposte` is the card that ignores it. */
  function canCounter(state, atkSide, from, to) {
    var atk = state.players[atkSide], def = state.players[1 - atkSide];
    var d = slotAt(def, to.r, to.c);
    if (!d || d.u.hp <= 0) return false;
    if (C.hasFx(fx(d), 'riposte')) return true;
    return canReach(def, atk, to, from);
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  /* setup is the immutable half of a match: everything decided before the
     first move, and everything a replay needs besides the moves themselves. */
  function makeSetup(o) {
    return {
      v: 1,
      seed: o.seed,
      decks: [o.decks[0], o.decks[1]],
      names: [o.names[0] || 'Player one', o.names[1] || 'Player two'],
    };
  }

  function makePlayer(setup, i) {
    var d = C.deck(setup.decks[i]);
    var rand = window.Rng.make(window.Rng.split(setup.seed, i));
    var deck = window.Rng.shuffle(d.list, rand);

    /* Going second is worth one card. The alternative — more energy — compounds
       every turn; a card is a one-off that evens the opening without changing
       the curve. */
    var handSize = R.HAND_START + (i === 1 ? 1 : 0);

    var p = {
      name: setup.names[i], deckId: d.id, deckName: d.name,
      deck: deck.slice(handSize),
      hand: deck.slice(0, handSize),
      discard: [],
      field: emptyField(),
      energy: 0, turns: 0,
    };

    /* The Sovereign is never drawn or paid for — it stands at back centre from
       the first turn. A match therefore always has a target and always has a
       way to end, and "I never drew my commander" is not a way to lose. */
    p.field[BACK][1] = { u: instantiate(d.sovereign), w: null, acted: false };
    return p;
  }

  function energyFor(turns) {
    return Math.min(R.ENERGY_MAX, R.ENERGY_START + turns);
  }

  function start(setup) {
    var state = {
      setup: setup,
      seed: setup.seed,
      turn: 1,
      cur: 0,
      winner: null,          // null | 0 | 1 | 'draw'
      reason: null,
      players: [makePlayer(setup, 0), makePlayer(setup, 1)],
      events: [],
      applied: 0,
      rejected: [],
    };
    state.players[0].energy = energyFor(0);
    return state;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  function say(state, text) {
    state.events.push({ turn: state.turn, side: state.cur, text: text });
  }

  // ── Deaths and win conditions ────────────────────────────────────────────

  function bury(state, side, r, c) {
    var p = state.players[side];
    var slot = p.field[r][c];
    if (!slot) return;
    p.field[r][c] = null;
    p.discard.push(slot.u.ref);
    if (slot.w) p.discard.push(slot.w);
    say(state, slot.u.name + ' falls.');
    if (slot.u.sovereign) {
      state.winner = 1 - side;
      state.reason = slot.u.name + ' has fallen.';
    }
  }

  /* Rout: a side with nothing on the field and no unit left to draw cannot
     come back. In practice the Sovereign makes this rare, which is the point —
     it is the safety net under a board that emptied, not the usual ending. */
  function checkRout(state) {
    if (state.winner !== null) return;
    for (var i = 0; i < 2; i++) {
      var p = state.players[i];
      if (occupied(p).length) continue;
      var canField = p.hand.concat(p.deck).some(function (ref) {
        return C.get(ref).kind === 'unit';
      });
      if (!canField) {
        state.winner = 1 - i;
        state.reason = p.name + ' has no one left to field.';
        return;
      }
    }
  }

  /* Nobody should be able to stall forever. At the cap the healthier Sovereign
     takes it, measured as a fraction so the two decks' different HP pools
     compare fairly. */
  function checkTurnCap(state) {
    if (state.winner !== null || state.turn <= R.TURN_CAP) return;
    var frac = [0, 1].map(function (i) {
      var found = 0;
      occupied(state.players[i]).forEach(function (pos) {
        var s = state.players[i].field[pos.r][pos.c];
        if (s.u.sovereign) found = s.u.hp / s.u.maxHp;
      });
      return found;
    });
    if (frac[0] === frac[1]) { state.winner = 'draw'; state.reason = 'Time. Evenly matched.'; }
    else {
      state.winner = frac[0] > frac[1] ? 0 : 1;
      state.reason = 'Time. The steadier Sovereign holds the field.';
    }
  }

  // ── Turn transitions ─────────────────────────────────────────────────────

  function adjacent(r, c) {
    return [
      { r: r, c: c - 1 }, { r: r, c: c + 1 }, { r: 1 - r, c: c },
    ].filter(function (p) { return inBounds(p.r, p.c); });
  }

  /* End-of-turn mending, for the side whose turn is ending. Applied to a
     snapshot of who is adjacent so two Menders side by side cannot cascade. */
  function mend(state, side) {
    var p = state.players[side];
    occupied(p).forEach(function (pos) {
      var healer = p.field[pos.r][pos.c];
      var amount = 0;
      fx(healer).forEach(function (e) { if (e.k === 'heal') amount += e.n; });
      if (!amount) return;
      adjacent(pos.r, pos.c).forEach(function (q) {
        var t = p.field[q.r][q.c];
        if (!t || t.u.hp >= t.u.maxHp) return;
        var before = t.u.hp;
        t.u.hp = Math.min(t.u.maxHp, t.u.hp + amount);
        say(state, healer.u.name + ' mends ' + t.u.name + ' for ' + (t.u.hp - before) + '.');
      });
    });
  }

  function draw(state, side, n) {
    var p = state.players[side];
    for (var i = 0; i < n; i++) {
      if (!p.deck.length) return;              // no fatigue damage; it just stops
      p.hand.push(p.deck.shift());
    }
  }

  function endTurn(state) {
    var side = state.cur;
    mend(state, side);
    state.players[side].turns += 1;

    checkRout(state);
    if (state.winner !== null) return;

    state.cur = 1 - side;
    state.turn += 1;

    var next = state.players[state.cur];
    for (var r = 0; r < R.ROWS; r++)
      for (var c = 0; c < R.COLS; c++)
        if (next.field[r][c]) next.field[r][c].acted = false;

    next.energy = energyFor(next.turns);
    draw(state, state.cur, R.DRAW_PER_TURN);

    checkTurnCap(state);
  }

  // ── Item effects ─────────────────────────────────────────────────────────

  function applyItem(state, side, card, target) {
    var p = state.players[side];
    var foe = state.players[1 - side];

    for (var i = 0; i < card.fx.length; i++) {
      var e = card.fx[i];

      if (e.k === 'draw') {
        draw(state, side, e.n);
        say(state, card.name + ' read — ' + e.n + ' drawn.');

      } else if (e.k === 'heal') {
        var t = p.field[target.r][target.c];
        var before = t.u.hp;
        t.u.hp = Math.min(t.u.maxHp, t.u.hp + e.n);
        say(state, card.name + ' restores ' + (t.u.hp - before) + ' to ' + t.u.name + '.');

      } else if (e.k === 'buff') {
        var b = p.field[target.r][target.c];
        b.u.st[e.stat] += e.n;
        if (e.stat === 'hp') { b.u.maxHp += e.n; b.u.hp += e.n; }
        say(state, card.name + ' gives ' + b.u.name + ' +' + e.n + ' ' + C.STAT_LABEL[e.stat] + '.');

      } else if (e.k === 'damage') {
        var v = foe.field[target.r][target.c];
        v.u.hp -= e.n;
        say(state, card.name + ' strikes ' + v.u.name + ' for ' + e.n + '.');
        if (v.u.hp <= 0) bury(state, 1 - side, target.r, target.c);

      } else if (e.k === 'swap') {
        var from = p.field[target.r][target.c];
        var otherR = 1 - target.r;
        p.field[otherR][target.c] = from;
        p.field[target.r][target.c] = null;
        say(state, card.name + ' moves ' + from.u.name +
                   (otherR === FRONT ? ' up to the front.' : ' back out of the front.'));
      }
    }
  }

  /* Which targets an item accepts. Returned as a list so the interface can
     light up exactly the legal slots and the AI can enumerate them, both from
     the same answer. */
  function itemTargets(state, side, card) {
    var p = state.players[side], foe = state.players[1 - side];
    var out = [];

    if (card.target === 'none') return [null];

    if (card.target === 'enemy') {
      occupied(foe).forEach(function (pos) { out.push(pos); });
      return out;
    }

    var wantsHeal = card.fx.some(function (e) { return e.k === 'heal'; });
    var isSwap = card.fx.some(function (e) { return e.k === 'swap'; });

    occupied(p).forEach(function (pos) {
      var s = p.field[pos.r][pos.c];
      // A Salve on a unit at full health is a wasted card, not a legal move.
      if (wantsHeal && s.u.hp >= s.u.maxHp) return;
      // A swap needs the far side of the column free.
      if (isSwap && p.field[1 - pos.r][pos.c]) return;
      out.push(pos);
    });
    return out;
  }

  // ── Moves ────────────────────────────────────────────────────────────────
  //
  // Kept terse on purpose: every move is stored, synced and replayed, and a
  // room's whole state has to fit in kidsync's 32KB. Short keys are worth real
  // turns of headroom.
  //
  //   { s, t:'dep', h, r, c }          deploy hand card h to own r,c
  //   { s, t:'eqp', h, r, c }          equip hand weapon h onto own r,c
  //   { s, t:'itm', h, r, c }          play hand item h at r,c (side per card)
  //   { s, t:'atk', fr, fc, tr, tc }   attack from own fr,fc to enemy tr,tc
  //   { s, t:'end' }                   end turn
  //   { s, t:'res' }                   resign

  function reject(reason) { return { ok: false, reason: reason }; }
  var OK = { ok: true };

  function applyMove(state, mv) {
    if (state.winner !== null) return reject('the match is over');
    if (!mv || typeof mv.t !== 'string') return reject('not a move');
    if (mv.s !== state.cur) return reject('not that side’s turn');

    var side = state.cur;
    var p = state.players[side];
    var foe = state.players[1 - side];

    if (mv.t === 'end') {
      endTurn(state);
      return OK;
    }

    if (mv.t === 'res') {
      state.winner = 1 - side;
      state.reason = p.name + ' concedes.';
      say(state, p.name + ' concedes.');
      return OK;
    }

    if (mv.t === 'atk') {
      // The opening turn is for deployment. Without this the one Sovereign that
      // attacks at range gets a free hit on an empty board before anybody can
      // put a body in front of it, which is not a decision, just a deck draw.
      if (state.turn === 1) return reject('no attacks on the opening turn');

      var from = { r: mv.fr, c: mv.fc }, to = { r: mv.tr, c: mv.tc };
      if (!inBounds(from.r, from.c) || !inBounds(to.r, to.c)) return reject('off the board');
      var a = slotAt(p, from.r, from.c);
      var d = slotAt(foe, to.r, to.c);
      if (!a) return reject('nobody there');
      if (!d) return reject('no target there');
      if (a.acted) return reject(a.u.name + ' has already acted');
      if (!canReach(p, foe, from, to)) return reject('out of reach');

      a.acted = true;

      var hit = damage(a, d);
      d.u.hp -= hit.total;
      say(state, a.u.name + ' strikes ' + d.u.name + ' for ' + hit.total +
                 (hit.hits > 1 ? ' (twice)' : '') +
                 (hit.tri ? ' with the advantage' : '') +
                 (hit.mult > 1 ? ' ×' + hit.mult : '') + '.');

      if (d.u.hp <= 0) { bury(state, 1 - side, to.r, to.c); checkRout(state); return OK; }

      if (canCounter(state, side, from, to)) {
        var back = damage(d, a);
        a.u.hp -= back.total;
        say(state, d.u.name + ' answers for ' + back.total + (back.hits > 1 ? ' (twice)' : '') + '.');
        if (a.u.hp <= 0) { bury(state, side, from.r, from.c); checkRout(state); }
      }
      return OK;
    }

    // ── The three "play a card from hand" moves share their checks ──
    if (mv.t !== 'dep' && mv.t !== 'eqp' && mv.t !== 'itm') return reject('unknown move');
    if (typeof mv.h !== 'number' || mv.h < 0 || mv.h >= p.hand.length) return reject('no such card');

    var ref = p.hand[mv.h];
    var card = C.get(ref);
    if (card.cost > p.energy) return reject('not enough energy');

    if (mv.t === 'dep') {
      if (card.kind !== 'unit') return reject('not a unit');
      if (!inBounds(mv.r, mv.c)) return reject('off the board');
      if (p.field[mv.r][mv.c]) return reject('that slot is taken');

      p.hand.splice(mv.h, 1);
      p.energy -= card.cost;
      // Deployed units cannot act the turn they arrive — otherwise a card in
      // hand is indistinguishable from a card on the board, and the front row
      // stops being a commitment.
      p.field[mv.r][mv.c] = { u: instantiate(ref), w: null, acted: true };
      /* The card is the subject, not the player. It reads better, it says the
         more useful half, and it sidesteps conjugating a name the player chose
         — "You deploys Bryn Halloway" was the version that made the point. Each
         line is already tagged with its side and coloured accordingly. */
      say(state, card.name + ' takes the field.');

      card.fx.forEach(function (e) {
        if (e.k === 'draw') {
          draw(state, side, e.n);
          say(state, card.name + ' brings word — ' + e.n + ' drawn.');
        }
      });
      return OK;
    }

    if (mv.t === 'eqp') {
      if (card.kind !== 'weapon') return reject('not a weapon');
      if (!inBounds(mv.r, mv.c)) return reject('off the board');
      var host = p.field[mv.r][mv.c];
      if (!host) return reject('nobody there to take it');
      if (!C.canEquip(host.u.at, card.at) ) return reject(host.u.name + ' cannot wield that');

      p.hand.splice(mv.h, 1);
      p.energy -= card.cost;
      if (host.w) p.discard.push(host.w);       // the old one is set down, not lost
      host.w = ref;
      say(state, host.u.name + ' takes up ' + card.name + '.');
      return OK;
    }

    // mv.t === 'itm'
    if (card.kind !== 'item') return reject('not an item');
    var target = card.target === 'none' ? null : { r: mv.r, c: mv.c };
    if (target) {
      if (!inBounds(target.r, target.c)) return reject('off the board');
      var legal = itemTargets(state, side, card).some(function (t) {
        return t && t.r === target.r && t.c === target.c;
      });
      if (!legal) return reject('not a legal target');
    }

    p.hand.splice(mv.h, 1);
    p.energy -= card.cost;
    applyItem(state, side, card, target);
    p.discard.push(ref);
    checkRout(state);
    return OK;
  }

  // ── Legal move enumeration ───────────────────────────────────────────────
  //
  // One list, used by the opponent to choose and by the interface to decide
  // what is clickable. Deriving both from the same function is what stops the
  // board from offering a move the engine would refuse.

  function legalMoves(state) {
    if (state.winner !== null) return [];
    var side = state.cur;
    var p = state.players[side], foe = state.players[1 - side];
    var out = [];

    p.hand.forEach(function (ref, h) {
      var card = C.get(ref);
      if (card.cost > p.energy) return;

      if (card.kind === 'unit') {
        for (var r = 0; r < R.ROWS; r++)
          for (var c = 0; c < R.COLS; c++)
            if (!p.field[r][c]) out.push({ s: side, t: 'dep', h: h, r: r, c: c });

      } else if (card.kind === 'weapon') {
        occupied(p).forEach(function (pos) {
          var host = p.field[pos.r][pos.c];
          if (C.canEquip(host.u.at, card.at)) out.push({ s: side, t: 'eqp', h: h, r: pos.r, c: pos.c });
        });

      } else if (card.kind === 'item') {
        itemTargets(state, side, card).forEach(function (t) {
          out.push({ s: side, t: 'itm', h: h, r: t ? t.r : 0, c: t ? t.c : 0 });
        });
      }
    });

    if (state.turn > 1) {
      occupied(p).forEach(function (from) {
        if (p.field[from.r][from.c].acted) return;
        occupied(foe).forEach(function (to) {
          if (canReach(p, foe, from, to)) {
            out.push({ s: side, t: 'atk', fr: from.r, fc: from.c, tr: to.r, tc: to.c });
          }
        });
      });
    }

    out.push({ s: side, t: 'end' });
    return out;
  }

  // ── Derive: the entry point everything else uses ──────────────────────────

  /* Replay `moves` (optionally only the first `upTo`) onto a fresh board.
     This is the live game's state function AND the replay scrubber's, which is
     why there is no separate replay engine to keep in step with this one. */
  function derive(setup, moves, upTo) {
    var state = start(setup);
    var n = upTo == null ? moves.length : Math.min(upTo, moves.length);
    for (var i = 0; i < n; i++) {
      var res = applyMove(state, moves[i]);
      if (res.ok) state.applied += 1;
      else state.rejected.push({ i: i, reason: res.reason, move: moves[i] });
    }
    return state;
  }

  return {
    FRONT: FRONT, BACK: BACK,
    makeSetup: makeSetup, start: start, derive: derive,
    applyMove: applyMove, legalMoves: legalMoves,
    damage: damage, canReach: canReach, canCounter: canCounter,
    occupied: occupied, rowEmpty: rowEmpty, adjacent: adjacent,
    itemTargets: itemTargets, isRanged: isRanged, fx: fx,
    energyFor: energyFor, clone: clone,
  };
})();
