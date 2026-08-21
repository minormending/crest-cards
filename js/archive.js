/* Finished matches, kept on this device.

   Storage is the same shape the sync layer uses and the same shape the engine
   replays: a setup and a list of moves. A saved game is therefore not a
   recording of a game — it IS the game, and the replay viewer runs it through
   the same engine the live board uses. Nothing is stored twice and there is no
   second format to keep in step.

   That also keeps saves small. A long match was 202 moves and 7.3KB in the
   engine's own tests, so a cap of forty games is well inside what localStorage
   will hold, and there is no need to store a board or a thumbnail. */

window.Archive = (function () {
  'use strict';

  var KEY = 'crest-cards:games';
  var RESUME = 'crest-cards:resume';
  var LIMIT = 40;

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('[archive] unreadable, starting fresh:', e.message);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[archive] could not save:', e.message);
      return false;
    }
  }

  function list() {
    var games = read(KEY, []);
    return Array.isArray(games) ? games : [];
  }

  /* Save a finished match. `at` is passed in rather than read from the clock
     here, so that the caller — which knows whether this is a live game or a
     replay being re-saved — decides, and so nothing in the replay path can
     stamp a new time onto an old game. */
  function save(record) {
    var games = list();
    // Same match saved twice (a re-derive, a double-fire on the end screen)
    // should update in place rather than pile up.
    var existing = games.findIndex(function (g) { return g.id === record.id; });
    if (existing >= 0) games[existing] = record;
    else games.unshift(record);

    if (games.length > LIMIT) games = games.slice(0, LIMIT);
    write(KEY, games);
    return record;
  }

  function get(id) {
    return list().filter(function (g) { return g.id === id; })[0] || null;
  }

  function remove(id) {
    write(KEY, list().filter(function (g) { return g.id !== id; }));
  }

  function clear() {
    write(KEY, []);
    forgetResume();
  }

  /* A match in progress against the local opponent, so closing the tab mid-game
     is recoverable. Shared-room games do not need this — the room itself is the
     record, and rejoining picks it up. */
  function keepResume(record) { write(RESUME, record); }
  function resume() { return read(RESUME, null); }
  function forgetResume() {
    try { localStorage.removeItem(RESUME); } catch (e) { /* nothing to do */ }
  }

  /* A stable id that does not need a clock: the seed and the decks already
     identify a match, and the timestamp disambiguates two matches on the same
     seed. */
  function idFor(setup, at) {
    return setup.seed + '-' + setup.decks.join('-') + '-' + at;
  }

  return {
    list: list, save: save, get: get, remove: remove, clear: clear,
    keepResume: keepResume, resume: resume, forgetResume: forgetResume,
    idFor: idFor, LIMIT: LIMIT,
  };
})();
