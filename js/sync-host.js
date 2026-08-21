/* Shared rooms: the kidsync contract, and the merge rules that are genuinely
   this game's own.

   ── Why a turn-based game fits a grow-only sync layer at all ──────────────
   kidsync was built for children's progress — stars earned, levels unlocked —
   where the merge rule is "keep the best of both" and state only ever grows. A
   two-player match looks like the opposite: a board that changes hands, where
   "keep the best of both" is meaningless.

   It fits because what travels is not the board. It is the MOVE LIST, and a
   move list is grow-only in exactly the way kidsync wants: moves are only ever
   appended, never edited and never removed. Merging two move lists is a union
   keyed by move number, which is idempotent and settles on the first pass —
   the constraint kidsync's README is emphatic about. Both devices then run the
   same list through the same engine and compute the same board, which is why
   no board is ever transmitted or reconciled.

   A spectator falls out of this for free: it is a device that reads the list
   and never appends to it.

   ── The synced record ─────────────────────────────────────────────────────
     match  { v, seed, decks: [host, guest] }   decides the shuffle; set once
     names  { "0": …, "1": … }                  display only; each seat's own
     seats  { "0": deviceId, "1": deviceId }    who is playing
     moves  { "0": move, "1": move, … }         the match itself

   `names` is deliberately OUTSIDE `match`. Only the seed and the two decks
   decide how the decks are shuffled, so two devices disagreeing about a display
   name cannot desynchronise a board — and that means the guest can name
   themselves without needing the host's permission to write the match record.

   Moves are keyed by number rather than held in an array because the union has
   to be by position: two arrays concatenated would duplicate, whereas
   moves["7"] arriving twice is the same fact stated twice. */

window.Sync = (function () {
  'use strict';

  var GAME = 'crest-cards';        // namespaces rooms; never change it casually
  var MAX_BYTES = 28 * 1024;       // kidsync refuses at 32KB; stop short of it

  var handle = null;
  var listeners = [];
  var lastError = null;
  var roomsOk = null;          // null = not yet established

  function emptyState() {
    return { match: null, names: {}, seats: {}, moves: {} };
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[sync] listener threw', e); }
    });
  }

  // ── Merge ────────────────────────────────────────────────────────────────

  /* Deterministic tie-break. When two devices wrote different things to the
     same field in the same instant, both sides have to pick the SAME winner or
     they will disagree forever, each pushing its own choice back. Comparing the
     serialised forms is arbitrary but it is stable, which is the only property
     that matters here. */
  function settle(a, b) {
    if (a === undefined || a === null) return b;
    if (b === undefined || b === null) return a;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja === jb) return a;
    return ja < jb ? a : b;
  }

  /* Union of two key→value maps, with conflicts settled deterministically.
     Keys are never dropped, which is what makes this idempotent: merging the
     result with either input again changes nothing. */
  function unionMap(a, b) {
    var out = {};
    a = a || {}; b = b || {};
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b).forEach(function (k) {
      out[k] = (k in out) ? settle(out[k], b[k]) : b[k];
    });
    return out;
  }

  function mergeMatch(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return {
      v: a.v || b.v || 1,
      seed: settle(a.seed, b.seed),
      /* Each seat writes its own deck slot, so the two halves of this array
         genuinely come from different devices and each side must survive the
         merge. Settling per slot rather than per array is the difference
         between both decks arriving and one of them being overwritten. */
      decks: [
        settle(a.decks && a.decks[0], b.decks && b.decks[0]) || null,
        settle(a.decks && a.decks[1], b.decks && b.decks[1]) || null,
      ],
    };
  }

  function merge(local, remote) {
    return {
      match: mergeMatch(local.match, remote.match),
      names: unionMap(local.names, remote.names),
      seats: unionMap(local.seats, remote.seats),
      moves: unionMap(local.moves, remote.moves),
    };
  }

  // ── Reading the record ───────────────────────────────────────────────────

  function state() {
    return (handle && handle.state) || emptyState();
  }

  /* The move list as a dense array, stopping at the first gap.
     A gap means a move is still in flight, and replaying past it would show a
     board that never existed — the engine would reject the out-of-order move
     and every client with a different gap would draw something different. */
  function moveList() {
    var m = state().moves || {};
    var out = [];
    for (var i = 0; m[String(i)] !== undefined; i++) out.push(m[String(i)]);
    return out;
  }

  function moveCount() { return moveList().length; }

  function mySeat() {
    var s = state().seats || {};
    var id = deviceId();
    if (s['0'] === id) return 0;
    if (s['1'] === id) return 1;
    return null;
  }

  function deviceId() {
    return handle ? handle.deviceId : null;
  }

  function seatTaken(n) {
    var s = state().seats || {};
    return s[String(n)] != null;
  }

  /* A match can begin once both seats are filled and both decks are chosen.
     Until then the room exists but there is nothing to play. */
  function ready() {
    var st = state();
    return !!(st.match && st.match.seed != null &&
              st.match.decks && st.match.decks[0] && st.match.decks[1] &&
              seatTaken(0) && seatTaken(1));
  }

  function setupOf() {
    var st = state();
    if (!st.match) return null;
    return window.Engine.makeSetup({
      seed: st.match.seed,
      decks: [st.match.decks[0], st.match.decks[1]],
      names: [
        (st.names && st.names['0']) || 'Host',
        (st.names && st.names['1']) || 'Guest',
      ],
    });
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  function tooBig(next) {
    return JSON.stringify(next).length > MAX_BYTES;
  }

  /* Append one move at the next free index.
     `expectedIndex` is the count the caller derived its board from; if the room
     has moved on since, the append is refused rather than landing at a
     position the caller did not intend. */
  function appendMove(mv, expectedIndex) {
    if (!handle) return { ok: false, reason: 'no-room' };
    if (mySeat() === null) return { ok: false, reason: 'spectating' };

    var moves = state().moves || {};
    var at = moveCount();
    if (expectedIndex != null && expectedIndex !== at) {
      return { ok: false, reason: 'out-of-date' };
    }

    var next = {};
    Object.keys(moves).forEach(function (k) { next[k] = moves[k]; });
    next[String(at)] = mv;

    if (tooBig({ match: state().match, names: state().names, seats: state().seats, moves: next })) {
      lastError = 'This match has grown too long to keep sharing. ' +
                  'Finish it here, or start a fresh room.';
      notify();
      return { ok: false, reason: 'too-large' };
    }

    handle.set({ moves: next });
    handle.flush();          // a turn is a milestone; do not sit in the debounce
    return { ok: true, at: at };
  }

  function claimSeat(n, name, deckId) {
    if (!handle) return false;
    var st = state();
    var seats = unionMap(st.seats, {});
    var names = unionMap(st.names, {});
    seats[String(n)] = deviceId();
    names[String(n)] = name;

    var match = mergeMatch(st.match, null) || { v: 1, seed: null, decks: [null, null] };
    var decks = [match.decks[0], match.decks[1]];
    decks[n] = deckId;

    handle.set({
      seats: seats, names: names,
      match: { v: 1, seed: match.seed, decks: decks },
    });
    handle.flush();
    return true;
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  /* Host a new match.
     The local record is REPLACED before the room is made, and that is not
     housekeeping — it is required. createRoom() seeds the room with whatever
     this device is holding, and this device may well be holding the move list
     of a previous match. Unioned into a fresh room, those stale moves would
     replay as part of the new game. Replacing first also drops kidsync's
     _epoch, so a device that has done a rematch in the past does not arrive
     claiming a newer epoch than the room it is joining and win the merge with
     an empty board. */
  async function host(name, deckId, seed) {
    if (!handle) return { ok: false, reason: 'not-configured' };
    var fresh = emptyState();
    fresh.match = { v: 1, seed: seed, decks: [deckId, null] };
    fresh.seats = { '0': deviceId() };
    fresh.names = { '0': name };
    handle.replace(fresh);
    try {
      var code = await handle.createRoom();
      return { ok: true, code: code || handle.roomCode };
    } catch (e) {
      return { ok: false, reason: 'network', detail: e.message };
    }
  }

  /* Join a room, as a player if a seat is free and as a spectator otherwise.
     Same reasoning as host(): the local record is emptied first so nothing from
     a previous match survives the union, and the epoch is dropped so the room's
     own history wins. */
  async function join(code) {
    if (!handle) return { ok: false, reason: 'not-configured' };
    handle.replace(emptyState());
    var res = await handle.joinRoom(code);
    if (!res.ok) return res;
    return { ok: true, code: res.code };
  }

  function leave() {
    if (!handle) return;
    handle.leaveRoom();
    handle.replace(emptyState());
    notify();
  }

  /* Start a fresh match in the SAME room, keeping both players where they are.
     reset() rather than replace(): it bumps the epoch, which overrides the
     merge everywhere and is the only way to make a move list shrink. A plain
     replace would be merged against the other device's longer list and lose. */
  async function rematch(seed) {
    if (!handle) return false;
    var st = state();
    await handle.reset({
      match: { v: 1, seed: seed, decks: [st.match.decks[0], st.match.decks[1]] },
      names: unionMap(st.names, {}),
      seats: unionMap(st.seats, {}),
      moves: {},
    });
    return true;
  }

  /* Can this copy actually open rooms?
     kidsync hands back a working handle either way — with a placeholder config
     it simply runs local-only — so the presence of a handle says nothing, and
     an app that assumed otherwise offers "Play a friend" and then fails on the
     tap. There is no public flag for it, and the vendored file must not be
     edited to add one (canonical owns it, and tools/check would flag the
     drift), so this asks a question whose answer only depends on the thing we
     want to know: joinRoom checks for a database BEFORE it validates the code,
     so an obviously invalid code comes back 'not-configured' when there is no
     database and 'malformed' when there is. No network, no side effects. */
  async function probeRooms() {
    if (!handle) { roomsOk = false; return; }
    try {
      var res = await handle.joinRoom('');
      roomsOk = res && res.reason !== 'not-configured';
    } catch (e) {
      roomsOk = false;
    }
    notify();
  }

  // ── The kidsync contract ─────────────────────────────────────────────────

  window.SyncHost = {
    game: GAME,
    initialState: emptyState,
    merge: merge,
    apply: function () {
      /* kidsync has already folded the merge in by the time this runs; all the
         app has to do is recompute and repaint from the new record. */
      notify();
    },
    attach: function (h) {
      handle = h;
      h.onStatusChange(notify);
      probeRooms();
      notify();
    },
  };

  // A debounced write must not be lost because a tab was closed mid-turn.
  addEventListener('pagehide', function () { if (handle) handle.flush(); });

  return {
    GAME: GAME,
    handle: function () { return handle; },
    status: function () { return handle ? handle.status : 'local'; },
    roomCode: function () { return handle ? handle.roomCode : null; },
    /* False until the probe says otherwise, so the room buttons are never
       offered on the strength of a handle that cannot reach a database. */
    available: function () { return roomsOk === true; },
    error: function () { return lastError; },
    clearError: function () { lastError = null; },
    onUpdate: function (fn) { listeners.push(fn); },
    state: state, moveList: moveList, moveCount: moveCount,
    mySeat: mySeat, seatTaken: seatTaken, ready: ready, setupOf: setupOf,
    deviceId: deviceId,
    appendMove: appendMove, claimSeat: claimSeat,
    host: host, join: join, leave: leave, rematch: rematch,
    merge: merge, emptyState: emptyState,
  };
})();
