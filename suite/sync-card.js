/* The "Two devices at once" card in the grown-up panel.

   Third and last of the things the games shared only by having been written the
   same way three times. The markup was identical -- same elements, same
   classes, same button labels, same placeholder -- and so was the render, since
   the whole card is a function of the kidsync handle. What differed was the
   prose, which should differ, and the ids, which should not.

   kidsync's own README says the three apps hand-rolled this "because a foreign
   modal dropped into a carefully designed panel looks exactly like what it is".
   That was true when the three panels were three different designs. They are
   one kit now, so the card is native everywhere by construction.

   This owns the card and the pairing flow. It does not own what pairing MEANS:
   the SyncHost contract and the merge rules stay in the game, and are the one
   part nobody should copy between games. See
   https://github.com/minormending/kidsync

   Usage:

     const card = SyncCard.mount({
       host: '#sync-card',                  // a placeholder in the panel
       handle: () => Sync.handle(),
       lede: ['What travels.', 'What does not.'],
       joinNote: 'Type the code shown on the other device. …',
       noun: 'device',
       onCreated: (code) => Sync.claimRoom(code),
       onLeft: () => Sync.forgetRoom(),
     });

     card.render();   // when the panel opens, and from handle.onStatusChange  */

window.SyncCard = (function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function node(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
  }

  function mount(opts) {
    var host = node(opts.host);
    if (!host) throw new Error('SyncCard.mount: no host ' + opts.host);

    var noun = opts.noun || 'device';

    /* Every way a join can fail, said in words a parent can act on. `reason`
       comes from kidsync; anything unrecognised falls through to the catch-all,
       so a new reason code degrades to vague rather than to silence. */
    var JOIN_ERRORS = {
      malformed: 'That code is not complete — three words and three numbers.',
      'not-found': 'No ' + noun + ' found with that code. Check for a typo, or press '
                 + 'Start sharing on the other one for a fresh code.',
      network: 'Could not reach the network just now. Try again in a moment.',
      'not-configured': 'Sharing is not available on this device.',
    };

    // ---- markup ----

    var card = el('section', 'block');
    card.appendChild(el('h2', null, opts.title || 'Two devices at once'));
    (opts.lede || []).forEach(function (line) {
      card.appendChild(el('p', 'hint', line));
    });

    var state = el('p', 'stat');
    card.appendChild(state);

    var offRow = el('div', 'btn-row');
    var startBtn = el('button', 'btn btn--go', 'Start sharing');
    var joinBtn = el('button', 'btn btn--quiet', 'Enter a code');
    offRow.appendChild(startBtn);
    offRow.appendChild(joinBtn);
    card.appendChild(offRow);

    var onRow = el('div', 'btn-row');
    var code = el('code', 'sync-code');
    var stopBtn = el('button', 'btn btn--quiet', 'Stop sharing here');
    onRow.appendChild(code);
    onRow.appendChild(stopBtn);
    card.appendChild(onRow);

    var joinBox = el('div');
    joinBox.hidden = true;
    if (opts.joinNote) joinBox.appendChild(el('p', 'hint', opts.joinNote));
    var input = el('input', 'input input--code');
    input.type = 'text';
    input.placeholder = 'WORD-WORD-WORD-123';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'characters');
    joinBox.appendChild(input);
    var goRow = el('div', 'btn-row');
    var goBtn = el('button', 'btn btn--go', 'Connect');
    var cancelBtn = el('button', 'btn btn--quiet', 'Cancel');
    goRow.appendChild(goBtn);
    goRow.appendChild(cancelBtn);
    joinBox.appendChild(goRow);
    var msg = el('p', 'hint');
    msg.hidden = true;
    joinBox.appendChild(msg);
    card.appendChild(joinBox);

    host.appendChild(card);

    // ---- state ----

    function render() {
      var handle = opts.handle();
      var paired = handle && handle.roomCode;

      state.textContent =
        !handle ? 'Sharing is unavailable — this device could not reach the service. '
                + 'Progress is saved here as usual.'
        : !paired ? 'Not sharing. This device keeps its own record.'
        : handle.status === 'synced' ? 'Sharing with code ' + handle.roomCode + '.'
        : handle.status === 'offline' ? 'Sharing with code ' + handle.roomCode
                + ' — offline just now. It will catch up when the connection returns.'
        : 'Connecting…';

      /* Both rows hidden when there is no handle at all: sharing being
         unreachable is not an error to fix, it is a game working exactly as it
         did before, and offering buttons that cannot work says otherwise. */
      offRow.hidden = !handle || !!paired;
      onRow.hidden = !handle || !paired;
      code.textContent = paired ? handle.roomCode : '';
      if (!handle || paired) joinBox.hidden = true;
    }

    // ---- pairing ----

    startBtn.addEventListener('click', function () {
      var handle = opts.handle();
      if (!handle) return;
      startBtn.disabled = true;
      Promise.resolve()
        .then(function () { return handle.createRoom(); })
        .then(function (roomCode) {
          /* Claim it now. The game would otherwise only learn the room when a
             remote record arrived, and until then a reset from the other device
             would look like first contact and be levelled away instead of
             applied. Safe here, and ONLY here, because we seeded this room
             ourselves -- see the join below. */
          if (opts.onCreated) opts.onCreated(roomCode || handle.roomCode);
        })
        .catch(function (e) {
          if (window.console) console.warn('[sync] could not start sharing', e);
          state.textContent = 'Could not start sharing just now.';
        })
        .then(function () {
          startBtn.disabled = false;
          render();
        });
    });

    joinBtn.addEventListener('click', function () {
      joinBox.hidden = false;
      msg.hidden = true;
      input.value = '';
      input.focus();
    });

    cancelBtn.addEventListener('click', function () { joinBox.hidden = true; });

    function join() {
      var handle = opts.handle();
      if (!handle) return;
      goBtn.disabled = true;
      Promise.resolve()
        .then(function () { return handle.joinRoom(input.value); })
        .then(function (res) {
          goBtn.disabled = false;
          msg.hidden = false;
          if (res && res.ok) {
            /* Deliberately NOT claiming the room here, unlike createRoom above.
               The first state to arrive from a room we have just joined must
               count as first contact so that it MERGES; if that room was reset
               at some point in the past, claiming it now would let its old
               epoch wipe the record we arrived with. The game records the room
               once it has safely merged. Do not "fix" this. */
            msg.className = 'hint ok';
            msg.textContent = 'Connected. The two records are merging now.';
            joinBox.hidden = true;
            render();
          } else {
            msg.className = 'hint bad';
            msg.textContent = JOIN_ERRORS[res && res.reason] || 'That did not work. Try again.';
          }
        })
        .catch(function (e) {
          if (window.console) console.warn('[sync] could not join', e);
          goBtn.disabled = false;
          msg.hidden = false;
          msg.className = 'hint bad';
          msg.textContent = JOIN_ERRORS.network;
        });
    }

    goBtn.addEventListener('click', join);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') join();
    });

    stopBtn.addEventListener('click', function () {
      var handle = opts.handle();
      if (!handle) return;
      handle.leaveRoom();
      /* Forget the room, so rejoining later counts as first contact again
         rather than inheriting a reset that happened while this device was
         away. */
      if (opts.onLeft) opts.onLeft();
      render();
    });

    render();

    return { el: card, render: render };
  }

  return { mount: mount };
})();
