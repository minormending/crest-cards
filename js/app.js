/* Screens, input, and the glue. Everything that is a decision about the RULES
   lives in js/engine.js, everything about the OPPONENT in js/ai.js, and
   everything about a shared room in js/sync-host.js. This file only decides
   what is on screen and what a tap means.

   ── One board, three ways of watching it ──────────────────────────────────
   Playing the local opponent, playing a stranger in a room, spectating that
   room, and scrubbing a finished game are not four features here. They are one
   board fed by four sources of the same two things — a setup and a list of
   moves — because that is all the engine ever needs:

     solo      the list is in memory, and the opponent appends to it
     room      the list is in the room, and both players append to it
     watch     the list is in the room, and this device appends nothing
     replay    the list is finished, and the scrubber chooses how much of it

   `moves()` is the only thing that differs between them. That is why
   spectating and replay cost almost nothing.

   ── On kidsuite's sync card ───────────────────────────────────────────────
   The front door, the hold-to-open gate and the panel's card kit are all
   vendored from kidsuite. Its SyncCard is deliberately NOT mounted, and the
   reason is worth writing down: that card calls handle.createRoom() itself, and
   this game must REPLACE its local record before a room is made — otherwise the
   move list of the previous match is seeded into the new room and replays as
   part of it (see js/sync-host.js). The card also pairs two devices belonging
   to one person, where this needs two players claiming seats and each choosing
   a deck. So the room flow is native here, and the panel reports on it. */

window.App = (function () {
  'use strict';

  var C = window.Cards, E = window.Engine, UI = window.UI;
  var AI = window.AI, Sync = window.Sync, Archive = window.Archive;

  var THINK_MS = 620;          // pause between the opponent's moves, so they read
  var LEVEL_KEY = 'crest-cards:level';
  var NAME_KEY  = 'crest-cards:name';

  // ── App state ────────────────────────────────────────────────────────────

  var mode = null;             // 'solo' | 'room' | 'watch' | 'replay'
  var solo = { setup: null, moves: [], level: 'steady' };
  var film = { setup: null, moves: [], at: 0, playing: false, timer: null, id: null };
  var pick = null;             // {kind:'hand', i} | {kind:'unit', r, c}
  var thinkTimer = null;
  var gate = null;
  var pendingDeck = null;      // deck chosen on the setup screen
  var saved = false;           // this match has been written to the archive
  var el = {};

  // ── Derived state, memoised ──────────────────────────────────────────────
  //
  // Every repaint asks for the board, and the board is always recomputed from
  // the move list. That is cheap (a couple of hundred applyMove calls at worst)
  // but not free, and a repaint can happen several times per interaction, so the
  // last answer is kept.

  var cache = { key: null, state: null };

  function moves() {
    if (mode === 'solo') return solo.moves;
    if (mode === 'replay') return film.moves.slice(0, film.at);
    if (mode === 'room' || mode === 'watch') return Sync.moveList();
    return [];
  }

  function setup() {
    if (mode === 'solo') return solo.setup;
    if (mode === 'replay') return film.setup;
    if (mode === 'room' || mode === 'watch') return Sync.setupOf();
    return null;
  }

  function board() {
    var s = setup();
    if (!s) return null;
    var mv = moves();
    var key = mode + '|' + s.seed + '|' + s.decks.join(',') + '|' + mv.length +
              '|' + (mode === 'replay' ? film.at : '');
    if (cache.key === key) return cache.state;
    cache.state = E.derive(s, mv);
    cache.key = key;
    return cache.state;
  }

  function invalidate() { cache.key = null; }

  /* Which seat this device is looking through. Solo is always seat 0; a room
     asks the room; a spectator and a replay watch from seat 0 because somebody
     has to be at the bottom of the screen. */
  function seat() {
    if (mode === 'solo') return 0;
    if (mode === 'room') { var s = Sync.mySeat(); return s == null ? 0 : s; }
    return 0;
  }

  function watching() { return mode === 'watch' || mode === 'replay'; }

  function myTurn(state) {
    if (!state || state.winner !== null || watching()) return false;
    return state.cur === seat();
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  var SCREENS = ['hello', 'menu', 'setup', 'game', 'games', 'panel'];

  function show(name) {
    SCREENS.forEach(function (s) {
      var node = el['screen-' + s];
      if (node) node.classList.toggle('is-on', s === name);
    });
    /* The gate is offered where a grown-up might reasonably stop and change
       something, and withheld where the screen is busy — kidsuite's own advice,
       and the reason it is hidden on the front door and mid-match. */
    if (gate) (name === 'menu' || name === 'games') ? gate.show() : gate.hide();
    if (name !== 'game') stopThinking();
    window.scrollTo(0, 0);
  }

  function name() {
    /* Not "You": the name is written into third-person log lines and into the
       result screen, where "You concedes" is what you get. A neutral proper
       noun survives both, and anyone who minds sets their own in the panel. */
    try { return localStorage.getItem(NAME_KEY) || 'Player'; } catch (e) { return 'Player'; }
  }
  function setName(v) {
    try { localStorage.setItem(NAME_KEY, v || 'Player'); } catch (e) { /* ignore */ }
  }
  function level() {
    try { return localStorage.getItem(LEVEL_KEY) || 'steady'; } catch (e) { return 'steady'; }
  }
  function setLevel(v) {
    try { localStorage.setItem(LEVEL_KEY, v); } catch (e) { /* ignore */ }
  }

  // ── The menu ─────────────────────────────────────────────────────────────

  function tile(id, icon, title, note, disabled) {
    return '<button class="tile" type="button" data-go="' + id + '"' +
      (disabled ? ' disabled' : '') + '>' +
      UI.ic(icon) + '<span><b>' + title + '</b><span>' + note + '</span></span></button>';
  }

  function paintMenu() {
    var res = Archive.resume();
    var count = Archive.list().length;
    var rooms = Sync.available();

    el['menu-list'].innerHTML =
      (res ? tile('resume', 'hourglass', 'Carry on',
                  'Your match against the ' + (AI.LEVELS[res.level] || AI.LEVELS.steady).label +
                  ' opponent is still going.') : '') +
      tile('solo', 'clash', 'Take the field',
           'Play the standalone opponent. Works with no connection at all.') +
      tile('host', 'crown', 'Play a friend',
           rooms ? 'Open a room and pass on the code.'
                 : 'Needs sharing switched on — see the grown-up panel.', !rooms) +
      tile('join', 'hand', 'Join with a code',
           rooms ? 'Battle, or watch if both seats are taken.'
                 : 'Needs sharing switched on.', !rooms) +
      tile('games', 'deck', 'Replays',
           count ? count + (count === 1 ? ' saved match' : ' saved matches') +
                   ' — step through any of them move by move.'
                 : 'Finished matches are kept here, and can be replayed.', !count);
  }

  // ── Setup screens ────────────────────────────────────────────────────────

  function deckChoice(chosen) {
    return '<div class="choice">' + C.DECKS.map(function (d) {
      var sov = C.get(d.sovereign);
      return '<button class="opt' + (d.id === chosen ? ' is-on' : '') + '" type="button"' +
        ' data-deck="' + d.id + '">' + UI.ic(d.badge || sov.art) +
        '<span><b>' + UI.esc(d.name) + '</b><span>' + UI.esc(d.lede) +
        ' Led by ' + UI.esc(sov.name) + '.</span></span></button>';
    }).join('') + '</div>';
  }

  function levelChoice(chosen) {
    return '<div class="choice">' + Object.keys(AI.LEVELS).map(function (k) {
      var l = AI.LEVELS[k];
      return '<button class="opt' + (k === chosen ? ' is-on' : '') + '" type="button"' +
        ' data-level="' + k + '">' + UI.ic(l.badge || 'hourglass') +
        '<span><b>' + l.label + '</b><span>' + UI.esc(l.note) + '</span></span></button>';
    }).join('') + '</div>';
  }

  function paintSetup(kind) {
    var body = el['setup-body'];
    pendingDeck = pendingDeck || C.DECKS[0].id;

    if (kind === 'solo') {
      body.innerHTML =
        '<header class="menu-head"><h1>Take the field</h1><div class="rule"></div>' +
        '<p>Choose who you lead, and how hard they push back.</p></header>' +
        '<p class="section-label">Your banner</p>' + deckChoice(pendingDeck) +
        '<p class="section-label">The opponent</p>' + levelChoice(level()) +
        '<div class="btn-row"><button class="btn-main" data-act="begin-solo">Begin</button>' +
        '<button class="btn-quiet" data-go="menu">Back</button></div>';

    } else if (kind === 'host') {
      var code = Sync.roomCode();
      var inRoom = !!code && Sync.mySeat() === 0;
      body.innerHTML =
        '<header class="menu-head"><h1>Play a friend</h1><div class="rule"></div>' +
        '<p>Open a room, then read the code out. They pick their own banner.</p></header>' +
        (inRoom
          ? '<p class="section-label">Your room code</p>' +
            '<div class="code-show">' + UI.esc(code) + '</div>' +
            '<p class="hint-line">' +
              (Sync.seatTaken(1)
                ? 'They are in. Starting…'
                : 'Waiting for them to join. Leave this open — it starts on its own.') +
            '</p>' +
            '<div class="btn-row"><button class="btn-quiet" data-act="leave-room">' +
            'Close the room</button></div>'
          : '<p class="section-label">Your banner</p>' + deckChoice(pendingDeck) +
            '<div class="btn-row"><button class="btn-main" data-act="open-room">' +
            'Open the room</button>' +
            '<button class="btn-quiet" data-go="menu">Back</button></div>');

    } else {
      var joined = !!Sync.roomCode();
      var mine = Sync.mySeat();
      body.innerHTML =
        '<header class="menu-head"><h1>Join with a code</h1><div class="rule"></div>' +
        '<p>Three words and three numbers, from whoever opened the room.</p></header>' +
        (!joined
          ? '<input class="input input--code" id="join-code" type="text" ' +
            'placeholder="WORD-WORD-WORD-123" autocomplete="off" spellcheck="false" ' +
            'autocapitalize="characters">' +
            '<p class="hint-line" id="join-msg"></p>' +
            '<div class="btn-row"><button class="btn-main" data-act="do-join">Connect</button>' +
            '<button class="btn-quiet" data-go="menu">Back</button></div>'
          : mine === null && Sync.seatTaken(1)
            ? '<p class="hint-line">Both seats are taken, so you are watching. ' +
              'The board follows along on its own.</p>' +
              '<div class="btn-row"><button class="btn-main" data-act="watch">Watch</button>' +
              '<button class="btn-quiet" data-act="leave-room">Leave</button></div>'
            : mine === null
              ? '<p class="section-label">Your banner</p>' + deckChoice(pendingDeck) +
                '<div class="btn-row"><button class="btn-main" data-act="take-seat">' +
                'Take the field</button>' +
                '<button class="btn-quiet" data-act="leave-room">Leave</button></div>'
              : '<p class="hint-line">You are in. Waiting for the match to begin…</p>' +
                '<div class="btn-row"><button class="btn-quiet" data-act="leave-room">' +
                'Leave</button></div>');
      var input = document.getElementById('join-code');
      if (input) input.focus();
    }
    body.dataset.kind = kind;
    show('setup');
  }

  // ── Starting a match ─────────────────────────────────────────────────────

  function startSolo(deckId, lv) {
    var others = C.DECKS.filter(function (d) { return d.id !== deckId; });
    var foe = others[Math.floor(Math.random() * others.length)] || C.DECKS[0];
    solo.level = lv;
    solo.setup = E.makeSetup({
      seed: window.Rng.seed(),
      decks: [deckId, foe.id],
      names: [name(), (AI.LEVELS[lv] || AI.LEVELS.steady).label + ' opponent'],
    });
    solo.moves = [];
    mode = 'solo';
    saved = false;
    pick = null;
    invalidate();
    keepResume();
    show('game');
    paint();
  }

  function resumeSolo(rec) {
    solo.setup = rec.setup;
    solo.moves = rec.moves || [];
    solo.level = rec.level || 'steady';
    mode = 'solo';
    saved = false;
    pick = null;
    invalidate();
    show('game');
    paint();
    nudgeOpponent();
  }

  function keepResume() {
    if (mode !== 'solo' || !solo.setup) return;
    var st = board();
    if (st && st.winner !== null) { Archive.forgetResume(); return; }
    Archive.keepResume({
      setup: solo.setup, moves: solo.moves, level: solo.level,
    });
  }

  // ── Painting the board ───────────────────────────────────────────────────

  /* Turn the engine's legal moves into the three things the board needs to
     know: which slots can be tapped, which are valid targets for what is
     currently selected, and which slot is selected. Deriving all of it from
     legalMoves is what guarantees the board cannot offer an illegal move. */
  function view(state) {
    var me = seat();
    var v = {
      bottom: me,
      spectating: watching(),
      canAct: myTurn(state),
      targets: {}, pickable: {}, chosen: null,
      chosenHand: pick && pick.kind === 'hand' ? pick.i : null,
      handOf: (mode === 'replay' || mode === 'watch') ? state.cur : me,
      hideHand: false,
    };

    if (!v.canAct) {
      /* A spectator and a replay show whoever is moving, face up — the match is
         either public or over. In a live room the opponent's hand stays down. */
      if (mode === 'room') { v.handOf = me; }
      if (!watching()) return v;
    }

    var legal = E.legalMoves(state);

    legal.forEach(function (mv) {
      if (mv.t === 'atk') v.pickable[state.cur + ':' + mv.fr + ':' + mv.fc] = true;
    });

    if (!pick || !v.canAct) return v;

    if (pick.kind === 'hand') {
      legal.forEach(function (mv) {
        if (mv.h !== pick.i) return;
        if (mv.t === 'dep' || mv.t === 'eqp') {
          v.targets[me + ':' + mv.r + ':' + mv.c] = true;
        } else if (mv.t === 'itm') {
          var card = C.get(state.players[me].hand[mv.h]);
          var side = card.target === 'enemy' ? 1 - me : me;
          v.targets[side + ':' + mv.r + ':' + mv.c] = true;
        }
      });
    } else if (pick.kind === 'unit') {
      v.chosen = me + ':' + pick.r + ':' + pick.c;
      legal.forEach(function (mv) {
        if (mv.t === 'atk' && mv.fr === pick.r && mv.fc === pick.c) {
          v.targets[(1 - me) + ':' + mv.tr + ':' + mv.tc] = true;
        }
      });
    }
    return v;
  }

  function promptText(state, v) {
    if (state.winner !== null) return '';
    if (mode === 'replay') return '';        // the scrub counter already says it
    if (watching()) return 'Watching. ' + UI.esc(state.players[state.cur].name) + ' is playing.';
    if (!v.canAct) return 'Waiting for ' + UI.esc(state.players[state.cur].name) + '.';

    if (pick && pick.kind === 'hand') {
      var ref = state.players[seat()].hand[pick.i];
      if (!ref) return '';
      var card = C.get(ref);
      if (Object.keys(v.targets).length === 0) {
        return '<b>' + UI.esc(card.name) + '</b> has nowhere to go just now.';
      }
      return card.kind === 'unit' ? 'Choose a position for <b>' + UI.esc(card.name) + '</b>.'
        : card.kind === 'weapon' ? 'Choose who takes <b>' + UI.esc(card.name) + '</b>.'
        : 'Choose a target for <b>' + UI.esc(card.name) + '</b>.';
    }
    if (pick && pick.kind === 'unit') return 'Choose who to strike.';
    if (state.turn === 1) return 'Opening turn — deploy, but no attacks yet.';
    return 'Play a card, or tap one of yours to attack.';
  }

  function paint() {
    var state = board();
    if (!state) return;
    var v = view(state);
    var me = seat();

    UI.paintArmies(el['army-theirs'], el['army-mine'], state, v);
    UI.paintRibbon(el.ribbon, state, v);
    UI.paintLog(el.log, state);

    el['board-top'].innerHTML = UI.whoHtml(state, 1 - me, v);
    var line = promptText(state, v);
    el.prompt.innerHTML = line;
    el.prompt.className = 'prompt';
    el.prompt.hidden = !line;

    UI.paintHand(el.hand, state, v);

    if (mode === 'replay') {
      el['board-bottom'].hidden = true;
      el['scrub-bar'].hidden = false;
      paintScrub();
    } else {
      el['board-bottom'].hidden = false;
      el['scrub-bar'].hidden = true;
      paintBottom(state, v);
    }

    if (state.winner !== null) finish(state);
  }

  function paintBottom(state, v) {
    var me = seat();
    var p = state.players[me];
    var energy = watching() ? state.players[state.cur].energy : p.energy;

    el['board-bottom'].innerHTML =
      '<span class="energy"><span class="energy-label">Energy</span>' +
      UI.pips(energy, C.RULES.ENERGY_MAX) + '</span>' +
      '<span class="tally">' + UI.ic('deck') + p.deck.length + '</span>' +
      '<span style="flex:1"></span>' +
      (watching()
        ? '<button class="btn-quiet" data-act="quit">Leave</button>'
        : '<button class="btn-quiet" data-act="leave-match">Menu</button>' +
          '<button class="btn-main" data-act="end"' + (v.canAct ? '' : ' disabled') +
          '>End turn</button>');
  }

  /* Built once, then updated in place.
     Re-rendering this on every repaint was a real bug rather than a waste: the
     range input fires `input` continuously while it is dragged, each one caused
     a repaint, and the repaint replaced the very element under the user's
     finger — so a drag died on its first pixel. Anything holding a live
     interaction has to survive being redrawn. */
  var scrubBuilt = false;

  function buildScrub() {
    el['scrub-bar'].innerHTML =
      '<button class="step" data-act="film-back" aria-label="a move back">&#8592;</button>' +
      '<input type="range" min="0" max="0" value="0" aria-label="position in the match">' +
      '<button class="step" data-act="film-fwd" aria-label="a move on">&#8594;</button>' +
      '<button class="step" data-act="film-play" aria-label="play or pause"></button>' +
      '<span class="scrub-count"></span>' +
      '<button class="btn-quiet" data-act="quit">Done</button>';
    scrubBuilt = true;
  }

  function paintScrub() {
    if (!scrubBuilt) buildScrub();
    var bar = el['scrub-bar'];
    var range = bar.querySelector('input[type=range]');
    var back = bar.querySelector('[data-act="film-back"]');
    var fwd = bar.querySelector('[data-act="film-fwd"]');
    var play = bar.querySelector('[data-act="film-play"]');

    range.max = film.moves.length;
    // Only write the value when it actually differs, so a drag in progress is
    // never nudged by its own repaint.
    if (String(film.at) !== range.value) range.value = film.at;

    back.disabled = film.at === 0;
    fwd.disabled = film.at >= film.moves.length;
    play.innerHTML = film.playing ? '&#10073;&#10073;' : '&#9654;';
    bar.querySelector('.scrub-count').textContent = film.at + ' / ' + film.moves.length;
  }

  // ── Making a move ────────────────────────────────────────────────────────

  function commit(mv) {
    var state = board();
    if (!state || state.winner !== null) return;

    if (mode === 'solo') {
      // Validate against a copy first: nothing illegal should ever reach the log,
      // because the log IS the game and a replay would reject it too.
      var test = E.clone(state);
      test.setup = state.setup;
      if (!E.applyMove(test, mv).ok) return;
      solo.moves.push(mv);
      invalidate();
      pick = null;
      keepResume();
      paint();
      nudgeOpponent();
      return;
    }

    if (mode === 'room') {
      var res = Sync.appendMove(mv, Sync.moveCount());
      pick = null;
      if (!res.ok && res.reason === 'out-of-date') {
        // The room moved on while this device was deciding. Repaint and let
        // them look again rather than landing a move meant for an older board.
        invalidate();
        paint();
        el.prompt.className = 'prompt is-warn';
        el.prompt.innerHTML = 'The board changed. Have another look.';
        return;
      }
      invalidate();
      paint();
    }
  }

  // ── The opponent's turn ──────────────────────────────────────────────────

  function stopThinking() {
    if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
  }

  function nudgeOpponent() {
    stopThinking();
    if (mode !== 'solo') return;
    var state = board();
    if (!state || state.winner !== null) return;
    if (state.cur === 0) return;
    thinkTimer = setTimeout(thinkOnce, THINK_MS);
  }

  function thinkOnce() {
    thinkTimer = null;
    if (mode !== 'solo') return;
    var state = board();
    if (!state || state.winner !== null || state.cur !== 1) return;

    var mv = AI.next(state, solo.level) || { s: 1, t: 'end' };
    var test = E.clone(state);
    test.setup = state.setup;
    if (!E.applyMove(test, mv).ok) mv = { s: 1, t: 'end' };

    solo.moves.push(mv);
    invalidate();
    keepResume();
    paint();
    nudgeOpponent();
  }

  // ── Input ────────────────────────────────────────────────────────────────

  /* `bare` is for a sheet that brings its own buttons — otherwise this adds a
     Close, which is what every card-detail sheet wants and no confirmation
     dialog does. */
  function sheet(html, bare) {
    el['veil-body'].innerHTML = html + (bare ? '' :
      '<div class="btn-row" style="margin-top:1rem">' +
      '<button class="btn-quiet" data-act="close-sheet">Close</button></div>');
    el.veil.hidden = false;
  }

  function closeSheet() { el.veil.hidden = true; }

  function onSlot(side, r, c) {
    var state = board();
    if (!state) return;
    var v = view(state);
    var me = seat();
    var key = side + ':' + r + ':' + c;
    var slot = state.players[side].field[r][c];

    // A legal target for whatever is selected.
    if (v.targets[key]) {
      if (pick.kind === 'hand') {
        var ref = state.players[me].hand[pick.i];
        var card = C.get(ref);
        var t = card.kind === 'unit' ? 'dep' : card.kind === 'weapon' ? 'eqp' : 'itm';
        commit({ s: me, t: t, h: pick.i, r: r, c: c });
      } else {
        commit({ s: me, t: 'atk', fr: pick.r, fc: pick.c, tr: r, tc: c });
      }
      return;
    }

    // Tapping the selected unit again puts it down.
    if (v.chosen === key) { pick = null; paint(); return; }

    // One of ours that still has an attack in it: select.
    if (side === me && v.canAct && v.pickable[key]) {
      pick = { kind: 'unit', r: r, c: c };
      paint();
      return;
    }

    // Otherwise this is a request to read the card.
    if (slot) sheet(UI.cardSheet(slot.u.ref, slot.u));
    else if (pick) { pick = null; paint(); }
  }

  function onHand(i) {
    var state = board();
    if (!state) return;
    var side = (mode === 'replay' || mode === 'watch') ? state.cur : seat();
    var ref = state.players[side].hand[i];
    if (!ref) return;
    var card = C.get(ref);

    if (!myTurn(state) || card.cost > state.players[side].energy) {
      sheet(UI.cardSheet(ref));
      return;
    }
    if (pick && pick.kind === 'hand' && pick.i === i) { pick = null; paint(); return; }

    /* An item with nothing to target has exactly one way to be played, so
       asking for a target would be a step that only ever has one answer. */
    if (card.kind === 'item' && card.target === 'none') {
      commit({ s: side, t: 'itm', h: i, r: 0, c: 0 });
      return;
    }
    pick = { kind: 'hand', i: i };
    paint();
  }

  // ── Finishing ────────────────────────────────────────────────────────────

  function finish(state) {
    if (mode === 'replay' || saved) return;
    saved = true;
    stopThinking();

    var s = setup();
    if (s && (mode === 'solo' || mode === 'room')) {
      var at = Date.now();
      Archive.save({
        id: Archive.idFor(s, at),
        at: at,
        mode: mode,
        level: mode === 'solo' ? solo.level : null,
        setup: s,
        moves: moves().slice(),
        winner: state.winner,
        reason: state.reason,
      });
      Archive.forgetResume();
    }

    var mine = state.winner === seat();
    var title = state.winner === 'draw' ? 'A draw'
      : mine ? 'The field is yours' : 'The field is lost';

    sheetResult(
      '<h2>' + title + '</h2>' +
      '<p class="lede">' + UI.esc(state.reason || '') + '</p>' +
      '<p class="flavor">' + state.turn + ' turns, ' + moves().length + ' moves.</p>',
      state
    );
  }

  function sheetResult(html, state) {
    el['veil-body'].innerHTML = html +
      '<div class="btn-row" style="margin-top:1rem">' +
      (mode === 'solo'
        ? '<button class="btn-main" data-act="again">Again</button>'
        : mode === 'room' && Sync.mySeat() !== null
          ? '<button class="btn-main" data-act="rematch">Another</button>' : '') +
      '<button class="btn-quiet" data-act="watch-back">Watch it back</button>' +
      '<button class="btn-quiet" data-act="quit">Menu</button></div>';
    el.veil.hidden = false;
  }

  // ── Replays ──────────────────────────────────────────────────────────────

  function paintGames() {
    var games = Archive.list();
    el['games-body'].innerHTML =
      '<header class="menu-head"><h1>Replays</h1><div class="rule"></div>' +
      '<p>Every finished match, kept on this device. Step through any of them.</p>' +
      '</header>' +
      (games.length
        ? '<div class="choice">' + games.map(function (g) {
            var when = new Date(g.at);
            var who = g.winner === 'draw' ? 'Drawn'
              : (g.setup.names[g.winner] || 'Someone') + ' won';
            return '<button class="rec" type="button" data-film="' + UI.esc(g.id) + '">' +
              '<span><b>' + UI.esc(g.setup.names[0]) + ' vs ' + UI.esc(g.setup.names[1]) +
              '</b><span>' + UI.esc(C.deck(g.setup.decks[0]).name) + ' against ' +
              UI.esc(C.deck(g.setup.decks[1]).name) + ' · ' +
              when.toLocaleDateString() + ' · ' + g.moves.length + ' moves</span></span>' +
              '<span class="who-won">' + UI.esc(who) + '</span></button>';
          }).join('') + '</div>' +
          '<div class="btn-row"><button class="btn-quiet" data-go="menu">Back</button>' +
          '<button class="btn-quiet" data-act="clear-games">Remove them all</button></div>'
        : '<p class="empty-note">Nothing saved yet. Finish a match and it will ' +
          'appear here.</p>' +
          '<div class="btn-row"><button class="btn-quiet" data-go="menu">Back</button></div>');
    show('games');
  }

  function watchFilm(theSetup, theMoves, id) {
    film.setup = theSetup;
    film.moves = theMoves.slice();
    film.at = 0;
    film.playing = false;
    film.id = id || null;
    mode = 'replay';
    pick = null;
    saved = true;
    invalidate();
    show('game');
    paint();
  }

  function filmSeek(to) {
    film.at = Math.max(0, Math.min(film.moves.length, to));
    invalidate();
    paint();
  }

  function filmPlay(on) {
    film.playing = on;
    if (film.timer) { clearInterval(film.timer); film.timer = null; }
    if (!on) { paint(); return; }
    film.timer = setInterval(function () {
      if (film.at >= film.moves.length) { filmPlay(false); return; }
      filmSeek(film.at + 1);
    }, 450);
    paint();
  }

  // ── The grown-up panel ───────────────────────────────────────────────────

  function paintPanel() {
    var code = Sync.roomCode();
    var st = Sync.status();
    var count = Archive.list().length;

    el['panel-body'].innerHTML =
      '<header class="gu-head"><h1>Settings</h1>' +
      '<button class="btn btn--plain" data-go="menu">Done</button></header>' +

      '<section class="block"><h2>Your name</h2>' +
      '<p class="hint">Shown to the other player in a shared room, and on your ' +
      'saved matches. It travels to whoever holds the room code, so keep it to a ' +
      'first name or a nickname.</p>' +
      '<input class="input" id="name-input" type="text" maxlength="18" value="' +
      UI.esc(name()) + '"></section>' +

      '<section class="block"><h2>The standalone opponent</h2>' +
      '<p class="hint">How hard it pushes. It runs entirely on this device — no ' +
      'account, no key, and no request leaves the page.</p>' +
      levelChoice(level()) + '</section>' +

      '<section class="block"><h2>Shared rooms</h2>' +
      (!Sync.available()
        ? '<p class="hint">Not available on this copy. Solo play, hot seat and ' +
          'replays all work as normal; only rooms are switched off. Whoever ' +
          'deployed this needs to paste a Firebase config into ' +
          '<code>sync/firebase-config.js</code> — the file says how.</p>'
        : code
          ? '<p class="hint">This device is in a room.</p>' +
            '<p class="stat">Code <code class="sync-code">' + UI.esc(code) + '</code> · ' +
            (st === 'synced' ? 'connected' : st === 'offline'
              ? 'offline just now, it will catch up' : 'connecting…') + '</p>' +
            '<div class="btn-row"><button class="btn btn--quiet" data-act="leave-room">' +
            'Leave the room</button></div>'
          : '<p class="hint">Not in a room. Open one from <em>Play a friend</em>, ' +
            'or join with a code.</p>') +
      '</section>' +

      '<section class="block"><h2>Saved matches</h2>' +
      '<p class="hint">' + (count
        ? count + (count === 1 ? ' match is' : ' matches are') +
          ' kept on this device, at most ' + Archive.LIMIT + '. Nothing is uploaded.'
        : 'None yet.') + '</p>' +
      (count ? '<div class="btn-row"><button class="btn btn--danger" ' +
               'data-act="clear-games">Remove all saved matches</button></div>' : '') +
      '</section>' +

      '<section class="block"><h2>About</h2>' +
      '<p class="hint">Crest Cards is an original game. Its icons come from ' +
      'game-icons.net under CC BY 3.0; the crests are generated in the browser. ' +
      'Full credit is in <a href="ATTRIBUTION.md">ATTRIBUTION.md</a>.</p>' +
      '</section>';

    show('panel');
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function go(where) {
    if (where === 'menu') { mode = null; pick = null; stopThinking(); filmPlay(false);
                            paintMenu(); show('menu'); return; }
    if (where === 'solo') { pendingDeck = null; paintSetup('solo'); return; }
    if (where === 'host') { pendingDeck = null; paintSetup('host'); return; }
    if (where === 'join') { pendingDeck = null; paintSetup('join'); return; }
    if (where === 'games') { paintGames(); return; }
    if (where === 'resume') {
      var r = Archive.resume();
      if (r) resumeSolo(r); else go('menu');
      return;
    }
  }

  var ACTS = {
    'begin-solo': function () { startSolo(pendingDeck || C.DECKS[0].id, level()); },

    'open-room': async function (btn) {
      btn.disabled = true;
      var res = await Sync.host(name(), pendingDeck || C.DECKS[0].id, window.Rng.seed());
      if (!res.ok) {
        btn.disabled = false;
        el['setup-body'].insertAdjacentHTML('beforeend',
          '<p class="hint-line">Could not open a room just now. Try again in a moment.</p>');
        return;
      }
      paintSetup('host');
    },

    'do-join': async function (btn) {
      var input = document.getElementById('join-code');
      var msg = document.getElementById('join-msg');
      if (!input) return;
      btn.disabled = true;
      if (msg) msg.textContent = 'Connecting…';
      var res = await Sync.join(input.value);
      btn.disabled = false;
      if (!res.ok) {
        if (msg) {
          msg.textContent =
            res.reason === 'malformed' ? 'That code is not complete — three words and three numbers.'
            : res.reason === 'not-found' ? 'No room with that code. Check for a typo.'
            : res.reason === 'not-configured' ? 'Sharing is not available on this copy.'
            : 'Could not reach the network just now.';
        }
        return;
      }
      paintSetup('join');
    },

    'take-seat': function () {
      Sync.claimSeat(1, name(), pendingDeck || C.DECKS[0].id);
      paintSetup('join');
    },

    'watch': function () { mode = 'watch'; pick = null; invalidate(); show('game'); paint(); },

    'leave-room': function () { Sync.leave(); go('menu'); },

    'end': function () {
      var state = board();
      if (state && myTurn(state)) commit({ s: seat(), t: 'end' });
    },

    'quit': function () { closeSheet(); go('menu'); },

    /* Leaving mid-match means different things in the two modes, so it asks.
       Solo keeps its place and can be carried on later; a room has a live
       opponent on the other end, and walking off without conceding leaves them
       staring at a board that will never move again. */
    'leave-match': function () {
      var state = board();
      if (!state || state.winner !== null) { go('menu'); return; }
      var room = mode === 'room';
      sheet(
        '<h2>' + (room ? 'Leave the match?' : 'Stop here?') + '</h2>' +
        '<p class="lede">' + (room
          ? 'There is someone on the other end. Conceding tells them the match ' +
            'is over; simply leaving does not, and they will be left waiting.'
          : 'Going back to the menu keeps your place — you can carry on later. ' +
            'Conceding ends it and files it with your replays.') + '</p>' +
        '<div class="btn-row" style="margin-top:1rem">' +
        '<button class="btn-quiet" data-act="close-sheet">Back to the board</button>' +
        '<button class="btn-main" data-act="concede">Concede</button>' +
        '<button class="btn-quiet" data-act="quit">' +
        (room ? 'Just leave' : 'Back to the menu') + '</button></div>',
        true
      );
    },

    'concede': function () {
      closeSheet();
      var state = board();
      if (state && state.winner === null && !watching()) {
        commit({ s: seat(), t: 'res' });
      }
    },

    'again': function () { closeSheet(); startSolo(solo.setup.decks[0], solo.level); },

    'rematch': async function () {
      closeSheet();
      await Sync.rematch(window.Rng.seed());
      saved = false;
      pick = null;
      invalidate();
      paint();
    },

    'watch-back': function () {
      closeSheet();
      watchFilm(setup(), moves(), null);
    },

    'close-sheet': closeSheet,

    'clear-games': function () {
      Archive.clear();
      if (el['screen-panel'].classList.contains('is-on')) paintPanel(); else paintGames();
    },

    'film-back': function () { filmPlay(false); filmSeek(film.at - 1); },
    'film-fwd':  function () { filmPlay(false); filmSeek(film.at + 1); },
    'film-play': function () { filmPlay(!film.playing); },
  };

  function onClick(ev) {
    var t = ev.target.closest('[data-go],[data-act],[data-deck],[data-level],[data-hand],[data-film],[data-r]');
    if (!t) return;

    if (t.dataset.go) { closeSheet(); return go(t.dataset.go); }
    if (t.dataset.act) { var fn = ACTS[t.dataset.act]; if (fn) fn(t); return; }

    if (t.dataset.deck) {
      pendingDeck = t.dataset.deck;
      paintSetup(el['setup-body'].dataset.kind);
      return;
    }
    if (t.dataset.level) {
      setLevel(t.dataset.level);
      if (el['screen-panel'].classList.contains('is-on')) paintPanel();
      else paintSetup(el['setup-body'].dataset.kind);
      return;
    }
    if (t.dataset.film) {
      var g = Archive.get(t.dataset.film);
      if (g) watchFilm(g.setup, g.moves, g.id);
      return;
    }
    if (t.dataset.hand != null) return onHand(Number(t.dataset.hand));
    if (t.dataset.r != null) {
      return onSlot(Number(t.dataset.side), Number(t.dataset.r), Number(t.dataset.c));
    }
  }

  // ── Reacting to the room ─────────────────────────────────────────────────

  function onRoomUpdate() {
    invalidate();

    // Sitting on a setup screen while the room fills up.
    var onSetup = el['screen-setup'].classList.contains('is-on');
    if (onSetup) {
      var kind = el['setup-body'].dataset.kind;
      if (Sync.ready() && Sync.mySeat() !== null) {
        mode = 'room';
        saved = false;
        pick = null;
        show('game');
        paint();
        return;
      }
      if (kind === 'host' || kind === 'join') { paintSetup(kind); return; }
    }

    if (mode === 'room' || mode === 'watch') paint();
    if (el['screen-panel'].classList.contains('is-on')) paintPanel();
    if (el['screen-menu'].classList.contains('is-on')) paintMenu();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  function boot() {
    ['screen-hello', 'screen-menu', 'screen-setup', 'screen-game', 'screen-games',
     'screen-panel', 'menu-list', 'setup-body', 'games-body', 'panel-body',
     'board-top', 'ribbon', 'army-theirs', 'army-mine', 'prompt', 'log', 'hand',
     'board-bottom', 'scrub-bar', 'veil', 'veil-body'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    document.addEventListener('click', onClick);

    /* The scrubber is a range input, so it needs its own event.
       Read the value BEFORE anything else runs. filmPlay() repaints, and the
       repaint writes film.at back into this very input — so calling it first
       reset the slider to where it already was and the seek read that stale
       zero back out. Every drag landed on 0. */
    el['scrub-bar'].addEventListener('input', function (ev) {
      if (ev.target.type !== 'range') return;
      var to = Number(ev.target.value);
      filmPlay(false);
      filmSeek(to);
    });

    // The name field saves as it is typed; there is no Save button to forget.
    el['screen-panel'].addEventListener('input', function (ev) {
      if (ev.target.id === 'name-input') setName(ev.target.value.trim());
    });

    // Enter should connect, on a screen whose whole job is one code.
    el['screen-setup'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.id === 'join-code') {
        ev.preventDefault();
        var btn = el['setup-body'].querySelector('[data-act="do-join"]');
        if (btn) ACTS['do-join'](btn);
      }
    });

    // Escape closes whatever is on top.
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!el.veil.hidden) { closeSheet(); return; }
      if (pick) { pick = null; paint(); }
    });

    gate = window.Gate.mount({ onOpen: paintPanel, hidden: true });

    Sync.onUpdate(onRoomUpdate);

    /* The door has to be switched ON as well as rendered into: every .screen
       is display:none until show() puts is-on on it. */
    show('hello');

    window.Landing.open({
      host: '#screen-hello',
      name: 'Crest Cards',
      lede: 'A small tactical card game. Six positions, one commander, ' +
            'and a weapon triangle that decides more than it looks like it should.',
      cap: 'Tap to begin',
      onLeave: function () { go('menu'); },
    });

    paintMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { go: go, board: board, view: view };
})();
