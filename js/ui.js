/* Painting the board. No rules live here — everything this file draws it was
   handed, and every move it offers came out of Engine.legalMoves, so the
   interface cannot present a move the engine would refuse.

   Rendering is wholesale rather than incremental: on any change the board, the
   hand and the log are rebuilt from state. Twelve slots and a handful of cards
   is nothing to redraw, and the alternative — diffing a board against itself —
   is where a display quietly drifts out of step with the game it is showing.
   Clicks are caught by delegation off the containers, so replacing their
   innards never orphans a listener. */

window.UI = (function () {
  'use strict';

  var C = window.Cards, E = window.Engine;

  // ── Text safety ──────────────────────────────────────────────────────────

  /* Card text is ours, but player names are not: in a shared room a name
     arrives from another device, and it lands in markup. Escaped at the one
     point where a string becomes HTML. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Icons ────────────────────────────────────────────────────────────────

  /* Masked, not <img>: an SVG loaded through <img> is its own document and
     cannot inherit colour, and these need to take the team tint and the muted
     grey from CSS. */
  function ic(name, cls) {
    var url = 'art/icons/' + name + '.svg';
    return '<i class="ic' + (cls ? ' ' + cls : '') + '" style="' +
      '-webkit-mask-image:url(' + url + ');mask-image:url(' + url + ')"></i>';
  }

  var STAT_ICON = { hp: 'hp', str: 'str', mag: 'mag', def: 'def', res: 'res', spd: 'spd' };

  // ── Card text ────────────────────────────────────────────────────────────

  var TAG_TEXT = {
    infantry: 'Infantry', mounted: 'Mounted', flying: 'Flying', armored: 'Armoured',
  };

  /* One place that turns an effect into English, so a card's rules text and its
     tooltip cannot disagree — and so a new effect kind shows up as itself
     rather than vanishing from the card. */
  function fxText(e) {
    switch (e.k) {
      case 'ranged':  return 'Ranged — may attack from the back rank';
      case 'flying':  return 'Flying — attacks from the back rank, and fears arrows';
      case 'double':  return 'Strikes twice';
      case 'pierce':  return 'Pierces — halves the defender’s ' + C.STAT_LABEL.def;
      case 'riposte': return 'Ripostes — answers an attack it could not otherwise reach';
      case 'heal':    return 'Mends neighbours for ' + e.n + ' at the end of your turn';
      case 'draw':    return 'Draws ' + e.n + ' on arrival';
      case 'vs':      return '×' + e.mult + ' damage against ' + (TAG_TEXT[e.tag] || e.tag).toLowerCase();
      case 'buff':    return '+' + e.n + ' ' + C.STAT_LABEL[e.stat] + ', permanently';
      case 'damage':  return 'Deals ' + e.n + ' damage to one enemy';
      case 'swap':    return 'Moves one of yours between the ranks';
      default:        return e.k;
    }
  }

  /* The one-line summary under a card's name in hand — the thing you read while
     deciding, as opposed to the full text in the detail sheet. */
  function shortNote(card) {
    if (card.kind === 'unit') {
      return C.TYPE_LABEL[card.at] + ' · ' +
        card.st.hp + ' ' + C.STAT_LABEL.hp + ' · ' +
        (C.isArcane(card.at) ? card.st.mag + ' ' + C.STAT_LABEL.mag
                             : card.st.str + ' ' + C.STAT_LABEL.str);
    }
    if (card.kind === 'weapon') {
      var parts = [];
      Object.keys(card.boost).forEach(function (k) {
        parts.push('+' + card.boost[k] + ' ' + C.STAT_LABEL[k]);
      });
      return C.TYPE_LABEL[card.at] + ' · ' + parts.join(' ');
    }
    return card.fx.length ? fxText(card.fx[0]).replace(/ —.*/, '') : 'Item';
  }

  /* The corner marker says what KIND of card this is at a glance: a unit shows
     what it fights with, a weapon shows that it is equipment, an item shows a
     pack. Reusing the attack-type icon for units earns its keep — the triangle
     is the thing you are checking when you look at a hand. */
  function kindIcon(card) {
    if (card.kind === 'unit') return ic(card.at);
    if (card.kind === 'weapon') return ic('clash');
    return ic('bag');
  }

  // ── A card in hand ───────────────────────────────────────────────────────

  function cardFace(ref, opts) {
    opts = opts || {};
    var card = C.get(ref);
    var cls = ['card'];
    if (opts.chosen) cls.push('is-chosen');
    if (opts.tooDear) cls.push('is-dear');

    return '<button class="' + cls.join(' ') + '" type="button"' +
      ' data-hand="' + opts.index + '"' +
      ' aria-label="' + esc(card.name) + ', costs ' + card.cost + '">' +
      window.Crest.svg(ref) +
      '<span class="card-body">' +
        '<span class="card-cost">' + card.cost + '</span>' +
        '<span class="card-kind">' + kindIcon(card) + '</span>' +
        '<span class="card-art">' + ic(card.art) + '</span>' +
        '<span class="card-name">' + esc(card.name) + '</span>' +
        '<span class="card-note">' + esc(shortNote(card)) + '</span>' +
      '</span></button>';
  }

  // ── A slot on the board ──────────────────────────────────────────────────

  function slotFace(slot, opts) {
    opts = opts || {};
    var cls = ['slot', opts.mine ? 'slot--mine' : 'slot--theirs'];

    if (!slot) {
      cls.push('slot--empty');
      if (opts.target) cls.push('is-target');
      return '<button class="' + cls.join(' ') + '" type="button"' +
        ' data-r="' + opts.r + '" data-c="' + opts.c + '" data-side="' + opts.side + '"' +
        ' aria-label="empty position"></button>';
    }

    cls.push('slot--filled');
    if (opts.target) cls.push('is-target');
    if (opts.chosen) cls.push('is-chosen');
    if (opts.pickable) cls.push('is-pick');
    if (slot.acted && opts.mine) cls.push('is-spent');

    var u = slot.u;
    var frac = u.hp / u.maxHp;
    var hpCls = 'slot-hp' + (frac <= 0.3 ? ' is-dire' : frac <= 0.6 ? ' is-low' : '');
    var arcane = C.isArcane(u.at);
    var punch = arcane ? u.st.mag : u.st.str;

    return '<button class="' + cls.join(' ') + '" type="button"' +
      ' data-r="' + opts.r + '" data-c="' + opts.c + '" data-side="' + opts.side + '"' +
      ' aria-label="' + esc(u.name) + ', ' + u.hp + ' of ' + u.maxHp + ' health">' +
      window.Crest.svg(u.ref) +
      (u.sovereign ? '<span class="slot-crown">' + ic('crown') + '</span>' : '') +
      (slot.w ? '<span class="slot-wpn">' + ic(C.get(slot.w).art) + '</span>' : '') +
      '<span class="slot-body">' +
        '<span class="slot-art">' + ic(u.art) + '</span>' +
        '<span class="slot-name">' + esc(u.name.split(' ')[0]) + '</span>' +
        '<span class="' + hpCls + '"><i style="width:' +
            Math.max(0, Math.min(100, frac * 100)) + '%"></i></span>' +
        '<span class="slot-foot">' +
          ic(u.at) + punch +
          ic(arcane ? 'res' : 'def') + (arcane ? u.st.res : u.st.def) +
        '</span>' +
      '</span></button>';
  }

  // ── The two armies ───────────────────────────────────────────────────────

  /* `view` is everything the interface knows that the engine does not: which
     seat is looking, what is selected, and which positions the current
     selection can legally act on. Targets arrive as a set of "side:r:c" keys,
     built by the caller from Engine.legalMoves — the board never works out for
     itself what is allowed. */
  function armyHtml(state, side, view) {
    var p = state.players[side];
    var mine = side === view.bottom;
    var rows = '';

    [E.FRONT, E.BACK].forEach(function (r) {
      var cells = '';
      for (var c = 0; c < C.RULES.COLS; c++) {
        var key = side + ':' + r + ':' + c;
        cells += slotFace(p.field[r][c], {
          r: r, c: c, side: side, mine: mine,
          target: view.targets && view.targets[key],
          chosen: view.chosen === key,
          pickable: view.pickable && view.pickable[key],
        });
      }
      rows += '<div class="army-row army-row--' + (r === E.FRONT ? 'front' : 'back') + '">' +
              cells + '</div>';
    });
    return rows;
  }

  function paintArmies(hostTheirs, hostMine, state, view) {
    var top = 1 - view.bottom;
    hostTheirs.innerHTML = armyHtml(state, top, view);
    hostMine.innerHTML = armyHtml(state, view.bottom, view);
  }

  // ── Top and bottom strips ────────────────────────────────────────────────

  function pips(n, max) {
    var out = '';
    for (var i = 0; i < max; i++) out += '<span class="pip' + (i < n ? ' is-on' : '') + '"></span>';
    return '<span class="pips">' + out + '</span>';
  }

  function whoHtml(state, side, view) {
    var p = state.players[side];
    var mine = side === view.bottom;
    return '<span class="who who--' + (mine ? 'mine' : 'theirs') + '">' +
      '<span style="min-width:0">' +
        '<span class="who-name">' + esc(p.name) + '</span>' +
        '<span class="who-deck"> · ' + esc(p.deckName) + '</span>' +
      '</span></span>' +
      '<span class="tally">' + ic('hand') + p.hand.length + '</span>' +
      '<span class="tally">' + ic('deck') + p.deck.length + '</span>';
  }

  function paintRibbon(host, state, view) {
    var cls = 'ribbon';
    var text;

    if (state.winner !== null) {
      text = state.winner === 'draw' ? 'A draw. ' + (state.reason || '')
        : esc(state.players[state.winner].name) + ' holds the field. ' + (state.reason || '');
    } else if (view.spectating) {
      cls += state.cur === view.bottom ? ' is-mine' : ' is-theirs';
      text = esc(state.players[state.cur].name) + ' to move · turn ' + state.turn;
    } else if (state.cur === view.bottom) {
      cls += ' is-mine';
      text = 'Your move · turn ' + state.turn;
    } else {
      cls += ' is-theirs';
      text = esc(state.players[state.cur].name) + ' is thinking · turn ' + state.turn;
    }
    host.className = cls;
    host.innerHTML = ic('hourglass') + '<span>' + text + '</span>';
  }

  function paintHand(host, state, view) {
    var side = view.handOf == null ? view.bottom : view.handOf;
    var p = state.players[side];
    var hidden = view.hideHand;

    if (hidden) {
      /* A face-down hand still has to occupy the same space, or the board jumps
         every time the turn changes. */
      var backs = '';
      for (var i = 0; i < p.hand.length; i++) {
        backs += '<span class="card is-dear" aria-hidden="true">' +
                 window.Crest.svg('back:' + i) + '</span>';
      }
      host.innerHTML = backs;
      return;
    }

    host.innerHTML = p.hand.map(function (ref, i) {
      return cardFace(ref, {
        index: i,
        chosen: view.chosenHand === i,
        tooDear: C.get(ref).cost > p.energy || !view.canAct,
      });
    }).join('');
  }

  function paintLog(host, state, limit) {
    var events = state.events.slice(-(limit || 40)).reverse();
    host.innerHTML = events.map(function (e) {
      return '<p><span class="turn-mark">' + e.turn + '</span> ' +
             '<span class="side-' + e.side + '">' + esc(e.text) + '</span></p>';
    }).join('') || '<p class="turn-mark">The field is quiet.</p>';
  }

  // ── The card detail sheet ────────────────────────────────────────────────

  function cardSheet(ref, liveUnit) {
    var card = C.get(ref);
    var out = '<h2>' + esc(card.name) + '</h2>';

    var sub = card.kind === 'unit'
      ? esc(card.cls) + ' · ' + C.TYPE_LABEL[card.at]
      : card.kind === 'weapon' ? 'Weapon · ' + C.TYPE_LABEL[card.at] : 'Item';
    out += '<p class="lede">' + sub + ' · costs ' + card.cost + '</p>';

    if (card.kind === 'unit') {
      var st = liveUnit ? liveUnit.st : card.st;
      var hp = liveUnit ? liveUnit.hp + ' / ' + liveUnit.maxHp : String(card.st.hp);
      var arcane = C.isArcane(card.at);
      var show = [
        ['hp', hp],
        [arcane ? 'mag' : 'str', arcane ? st.mag : st.str],
        ['spd', st.spd],
        ['def', st.def],
        ['res', st.res],
      ];
      out += '<div class="stat-grid">' + show.map(function (row) {
        return '<span class="stat-cell">' + ic(STAT_ICON[row[0]]) +
               C.STAT_LABEL[row[0]] + '<b>' + row[1] + '</b></span>';
      }).join('') + '</div>';

      out += '<div class="tag-row">' + card.tags.map(function (t) {
        return '<span class="tag">' + (TAG_TEXT[t] || t) + '</span>';
      }).join('') + '</div>';
    }

    if (card.kind === 'weapon') {
      out += '<div class="stat-grid">' + Object.keys(card.boost).map(function (k) {
        return '<span class="stat-cell">' + ic(STAT_ICON[k]) + C.STAT_LABEL[k] +
               '<b>+' + card.boost[k] + '</b></span>';
      }).join('') + '</div>';
    }

    var fxList = (liveUnit ? liveUnit.fx : card.fx) || [];
    if (fxList.length) {
      out += '<div class="tag-row">' + fxList.map(function (e) {
        return '<span class="tag tag--fx">' + esc(fxText(e)) + '</span>';
      }).join('') + '</div>';
    }

    if (card.flavor) out += '<p class="flavor">' + esc(card.flavor) + '</p>';
    return out;
  }

  return {
    esc: esc, ic: ic, fxText: fxText, shortNote: shortNote,
    cardFace: cardFace, slotFace: slotFace, STAT_ICON: STAT_ICON,
    paintArmies: paintArmies, paintRibbon: paintRibbon,
    paintHand: paintHand, paintLog: paintLog,
    whoHtml: whoHtml, pips: pips, cardSheet: cardSheet,
    TAG_TEXT: TAG_TEXT,
  };
})();
