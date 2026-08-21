/* Every card in the game, and the three decks built from them.

   ── On names ──────────────────────────────────────────────────────────────
   Everything in this file was written for this repo. The genre this game sits
   in has a famous occupant, and none of its names, characters, classes or
   items appear here — not as a starting point, not lightly reworded. What the
   game borrows is the *shape* of a tactical skirmish: a weapon triangle, a
   small deployment grid, a commander whose fall ends it. Mechanics are fair
   game; a cast is not. Keep new cards on that side of the line.

   ── On numbers ────────────────────────────────────────────────────────────
   Balance lives here and nowhere else. No stat, cost or multiplier is written
   in the engine, the AI or the interface, so tuning this game means editing
   this file and nothing else.                                                */

window.Cards = (function () {
  'use strict';

  // ── Rules constants ──────────────────────────────────────────────────────

  var RULES = {
    DECK_SIZE: 15,       // per deck, excluding the Sovereign
    HAND_START: 4,       // cards dealt before the first turn
    DRAW_PER_TURN: 1,
    /* Turn-1 allowance, +1 per own turn after. Two, not one: the cheapest unit
       costs 2, so at 1 the opening turn had no play in it but "end turn" —
       every card in hand greyed out. At 2 the first turn is a real decision,
       namely whether to put a body in front of your Sovereign. */
    ENERGY_START: 2,
    ENERGY_MAX: 8,
    TRIANGLE_BONUS: 2,   // attack bonus for holding triangle advantage
    MIN_DAMAGE: 1,       // an attack always does something
    DOUBLE_AT_SPD: 4,    // this much faster than the defender and you hit twice
    PIERCE_DIVISOR: 2,   // pierce halves physical defence
    TURN_CAP: 60,        // 30 each; past this the healthier Sovereign wins
    COLS: 3,
    ROWS: 2,             // 0 = front, 1 = back
  };

  /* Two separate triangles, each a cycle: the key beats the value, for
     +TRIANGLE_BONUS attack. There is no penalty for being on the losing end —
     one directional bonus is enough to make positioning matter without making
     a bad matchup unplayable. `bow` is in neither, deliberately: it is the
     type with no matchup to fear and no matchup to farm. */
  var BEATS = {
    sword: 'axe',   axe: 'lance',  lance: 'sword',        // steel
    ember: 'gale',  gale: 'frost', frost: 'ember',        // arcane
  };

  var ARCANE = { ember: 1, gale: 1, frost: 1 };

  var TYPE_LABEL = {
    sword: 'Sword', axe: 'Axe', lance: 'Lance', bow: 'Bow',
    ember: 'Ember', gale: 'Gale', frost: 'Frost',
  };

  var STAT_LABEL = {
    hp: 'HP', str: 'STR', mag: 'MAG', def: 'DEF', res: 'RES', spd: 'SPD',
  };

  // ── Units ────────────────────────────────────────────────────────────────
  //
  // st: hp / str / mag / def / res / spd.  Physical units leave mag at 0 and
  // arcane ones leave str at 0; the engine picks the stat off the attack type,
  // so a stray value in the unused one would simply never be read.
  //
  // fx: ranged   — may attack from the back row, and may reach the enemy back
  //                row through an empty column
  //     flying   — ranged, plus vulnerable to anti-flying multipliers
  //     double   — always strikes twice (SPD can earn this too)
  //     pierce   — halves the defender's DEF, physical attacks only
  //     riposte  — counters even a ranged attacker it could not otherwise reach
  //     heal     — mends adjacent allies at the end of your turn
  //     draw     — draws on deployment
  //     vs       — damage multiplier against a tag

  function unit(o) {
    return {
      kind: 'unit', id: o.id, name: o.name, cls: o.cls, at: o.at, cost: o.cost,
      st: o.st, tags: o.tags || [], fx: o.fx || [], sovereign: !!o.sovereign,
      art: o.art || o.cls.toLowerCase(), flavor: o.flavor,
    };
  }

  var UNITS = [
    // ── Sovereigns. One per deck, on the field from the first turn, and the
    //    reason the match ends. Cost 0 because they are never in hand.
    unit({ id: 'sov-ash', name: 'Roderic of Ashfell', cls: 'Sovereign', at: 'sword', cost: 0,
      st: { hp: 28, str: 9, mag: 0, def: 7, res: 4, spd: 8 }, tags: ['infantry'],
      fx: [{ k: 'riposte' }], sovereign: true, art: 'crown',
      flavor: 'Holds the line himself, which his captains have stopped arguing about.' }),
    unit({ id: 'sov-ivory', name: 'Maren Ivorywatch', cls: 'Sovereign', at: 'lance', cost: 0,
      st: { hp: 32, str: 7, mag: 0, def: 10, res: 5, spd: 5 }, tags: ['armored'],
      fx: [{ k: 'pierce' }], sovereign: true, art: 'crown',
      flavor: 'Reads a siege the way other people read weather.' }),
    unit({ id: 'sov-storm', name: 'Calyx Vell', cls: 'Sovereign', at: 'ember', cost: 0,
      st: { hp: 26, str: 0, mag: 10, def: 5, res: 8, spd: 7 }, tags: ['infantry'],
      fx: [{ k: 'ranged' }], sovereign: true, art: 'crown',
      flavor: 'Signs orders in the same hand she writes her worse ideas in.' }),

    // ── Steel
    unit({ id: 'vanguard', name: 'Bryn Halloway', cls: 'Vanguard', at: 'sword', cost: 2,
      st: { hp: 18, str: 7, mag: 0, def: 5, res: 2, spd: 6 }, tags: ['infantry'],
      flavor: 'First over the wall, every time, on purpose.' }),
    unit({ id: 'duelist', name: 'Sable Quinn', cls: 'Duelist', at: 'sword', cost: 3,
      st: { hp: 15, str: 6, mag: 0, def: 3, res: 2, spd: 11 }, tags: ['infantry'],
      fx: [{ k: 'double' }], flavor: 'Twice, always, before you have finished once.' }),
    unit({ id: 'warden', name: 'Orin Stonefast', cls: 'Warden', at: 'sword', cost: 3,
      st: { hp: 24, str: 6, mag: 0, def: 9, res: 3, spd: 3 }, tags: ['armored'],
      flavor: 'Immovable, and slightly smug about it.' }),
    unit({ id: 'reaver', name: 'Garrick Thorne', cls: 'Reaver', at: 'axe', cost: 2,
      st: { hp: 20, str: 8, mag: 0, def: 4, res: 1, spd: 5 }, tags: ['infantry'],
      flavor: 'Swings first and apologises never.' }),
    unit({ id: 'hewer', name: 'Doran Vale', cls: 'Hewer', at: 'axe', cost: 4,
      st: { hp: 26, str: 10, mag: 0, def: 7, res: 2, spd: 4 }, tags: ['armored'],
      flavor: 'Paid by the shield, not the hour.' }),
    unit({ id: 'lancer', name: 'Elna Rookwood', cls: 'Lancer', at: 'lance', cost: 3,
      st: { hp: 19, str: 7, mag: 0, def: 5, res: 3, spd: 9 }, tags: ['mounted'],
      fx: [{ k: 'pierce' }], flavor: 'Finds the gap in the plate at a canter.' }),
    unit({ id: 'pikeguard', name: 'Tam Aldergate', cls: 'Pikeguard', at: 'lance', cost: 3,
      st: { hp: 22, str: 7, mag: 0, def: 8, res: 3, spd: 4 }, tags: ['armored'],
      fx: [{ k: 'vs', tag: 'mounted', mult: 2 }],
      flavor: 'Was a farrier. Knows exactly where a horse stops being brave.' }),
    unit({ id: 'bannerguard', name: 'Hollis Marne', cls: 'Bannerguard', at: 'sword', cost: 4,
      st: { hp: 21, str: 7, mag: 0, def: 6, res: 4, spd: 6 }, tags: ['infantry'],
      fx: [{ k: 'riposte' }], flavor: 'Answers everything, including things thrown from a distance.' }),

    // ── Reach
    unit({ id: 'marksman', name: 'Wren Fairlight', cls: 'Marksman', at: 'bow', cost: 3,
      st: { hp: 16, str: 7, mag: 0, def: 3, res: 3, spd: 7 }, tags: ['infantry'],
      fx: [{ k: 'ranged' }, { k: 'vs', tag: 'flying', mult: 3 }],
      flavor: 'Counts wingbeats out loud, which the wings find unnerving.' }),
    unit({ id: 'shade', name: 'Cass Rill', cls: 'Shade', at: 'bow', cost: 2,
      st: { hp: 13, str: 5, mag: 0, def: 2, res: 2, spd: 12 }, tags: ['infantry'],
      fx: [{ k: 'ranged' }, { k: 'draw', n: 1 }],
      flavor: 'Arrives with someone else’s orders already read.' }),
    unit({ id: 'skyguard', name: 'Ivette Larke', cls: 'Skyguard', at: 'lance', cost: 4,
      st: { hp: 18, str: 7, mag: 0, def: 4, res: 4, spd: 12 }, tags: ['flying'],
      fx: [{ k: 'flying' }], art: 'wing',
      flavor: 'Goes over the problem rather than through it.' }),
    unit({ id: 'drakerider', name: 'Bors Cragmaw', cls: 'Drakerider', at: 'axe', cost: 5,
      st: { hp: 24, str: 10, mag: 0, def: 7, res: 2, spd: 8 }, tags: ['flying'],
      fx: [{ k: 'flying' }], flavor: 'The mount is the argument. He just steers it.' }),

    // ── Arcane
    unit({ id: 'emberwright', name: 'Nessa Coalbright', cls: 'Emberwright', at: 'ember', cost: 3,
      st: { hp: 15, str: 0, mag: 8, def: 3, res: 6, spd: 6 }, tags: ['infantry'],
      fx: [{ k: 'ranged' }], flavor: 'Warms her hands on the work.' }),
    unit({ id: 'galecaller', name: 'Piet Sonder', cls: 'Galecaller', at: 'gale', cost: 3,
      st: { hp: 14, str: 0, mag: 7, def: 3, res: 6, spd: 10 }, tags: ['infantry'],
      fx: [{ k: 'ranged' }, { k: 'double' }], flavor: 'Two gusts. There are always two.' }),
    unit({ id: 'frostbinder', name: 'Hulda Brine', cls: 'Frostbinder', at: 'frost', cost: 4,
      st: { hp: 17, str: 0, mag: 9, def: 4, res: 7, spd: 5 }, tags: ['infantry'],
      fx: [{ k: 'ranged' }], flavor: 'Patient in the way deep water is patient.' }),
    unit({ id: 'mender', name: 'Alys Pell', cls: 'Mender', at: 'frost', cost: 2,
      st: { hp: 14, str: 0, mag: 3, def: 3, res: 7, spd: 6 }, tags: ['infantry'],
      fx: [{ k: 'heal', n: 4 }],
      flavor: 'Mends whoever is nearest at dusk, and is not asked twice.' }),
  ];

  // ── Weapons ──────────────────────────────────────────────────────────────
  //
  // A weapon is equipped onto a deployed unit. Steel must match the unit's type
  // exactly; any arcane unit may carry any tome, because a caster re-reading a
  // different book is a smaller stretch than a swordsman picking up an axe.

  function weapon(o) {
    return {
      kind: 'weapon', id: o.id, name: o.name, at: o.at, cost: o.cost,
      boost: o.boost, fx: o.fx || [], art: o.art || o.at, flavor: o.flavor,
    };
  }

  var WEAPONS = [
    weapon({ id: 'keen', name: 'Keen Blade', at: 'sword', cost: 1, boost: { str: 2 },
      flavor: 'Sharpened past the point of sense.' }),
    weapon({ id: 'twinfang', name: 'Twinfang Sabre', at: 'sword', cost: 2, boost: { str: 1 },
      fx: [{ k: 'double' }], flavor: 'Paired, and unwilling to be used singly.' }),
    weapon({ id: 'reaveraxe', name: 'Reaver’s Axe', at: 'axe', cost: 2, boost: { str: 3 },
      flavor: 'Heavier than advisable. That is the feature.' }),
    weapon({ id: 'maul', name: 'Hewing Maul', at: 'axe', cost: 3, boost: { str: 4 },
      flavor: 'Ends the conversation.' }),
    weapon({ id: 'spirelance', name: 'Spire Lance', at: 'lance', cost: 2, boost: { str: 2 },
      fx: [{ k: 'pierce' }], flavor: 'Narrow enough to find a seam.' }),
    weapon({ id: 'longpike', name: 'Long Pike', at: 'lance', cost: 2, boost: { str: 2 },
      fx: [{ k: 'vs', tag: 'mounted', mult: 2 }], flavor: 'Set, braced, and waiting for hooves.' }),
    weapon({ id: 'yewbow', name: 'Yew Bow', at: 'bow', cost: 1, boost: { str: 2 },
      flavor: 'Older than the archer. Better tempered.' }),
    weapon({ id: 'longshot', name: 'Longshot Bow', at: 'bow', cost: 2, boost: { str: 1 },
      fx: [{ k: 'vs', tag: 'flying', mult: 3 }], flavor: 'Drawn for things that thought they were safe.' }),
    weapon({ id: 'embergrim', name: 'Ember Grimoire', at: 'ember', cost: 2, boost: { mag: 3 },
      flavor: 'Warm to the touch, which the binder swears is normal.' }),
    weapon({ id: 'galecodex', name: 'Gale Codex', at: 'gale', cost: 3, boost: { mag: 2 },
      fx: [{ k: 'double' }], flavor: 'The pages turn themselves, twice.' }),
    weapon({ id: 'frosttome', name: 'Frost Tome', at: 'frost', cost: 2, boost: { mag: 3 },
      flavor: 'Reads slowly. Lands all at once.' }),
  ];

  // ── Items ────────────────────────────────────────────────────────────────
  //
  // Buffs are PERMANENT for the rest of the match, and the card text says so.
  // A duration would need per-unit expiry tracked through every replay, and a
  // number shown on a card that the engine does not enforce is worse than a
  // simpler card that means exactly what it says.

  function item(o) {
    return {
      kind: 'item', id: o.id, name: o.name, cost: o.cost, fx: o.fx,
      target: o.target || 'ally', art: o.art || o.id, flavor: o.flavor,
    };
  }

  var ITEMS = [
    item({ id: 'salve', name: 'Salve', cost: 1, fx: [{ k: 'heal', n: 6 }],
      flavor: 'Smells worse than the wound.' }),
    item({ id: 'elixir', name: 'Elixir', cost: 2, fx: [{ k: 'heal', n: 14 }],
      flavor: 'Kept for the day it is genuinely needed, then used early anyway.' }),
    item({ id: 'orders', name: 'Field Orders', cost: 1, fx: [{ k: 'draw', n: 2 }], target: 'none',
      flavor: 'Two more things to worry about, and a plan.' }),
    item({ id: 'bolt', name: 'Bolt Scroll', cost: 2, fx: [{ k: 'damage', n: 5 }], target: 'enemy',
      flavor: 'One use, no aiming, no apology.' }),
    item({ id: 'whetstone', name: 'Whetstone', cost: 1, fx: [{ k: 'buff', stat: 'str', n: 2 }],
      flavor: 'Permanent, in the way a habit is permanent.' }),
    item({ id: 'brigandine', name: 'Brigandine', cost: 1, fx: [{ k: 'buff', stat: 'def', n: 2 }],
      flavor: 'Borrowed plates, sewn in by somebody’s aunt.' }),
    item({ id: 'ward', name: 'Ward Charm', cost: 1, fx: [{ k: 'buff', stat: 'res', n: 3 }], art: 'res',
      flavor: 'Turns the edge off a spell, and rattles.' }),
    item({ id: 'cloak', name: 'Wind Cloak', cost: 1, fx: [{ k: 'buff', stat: 'spd', n: 4 }],
      flavor: 'Enough to strike twice, if the gap was nearly there.' }),
    item({ id: 'banner', name: 'Rally Banner', cost: 1, fx: [{ k: 'swap' }], art: 'bannerguard',
      flavor: 'Pulls one of yours out of the front, or pushes them into it.' }),
  ];

  // ── Lookup ───────────────────────────────────────────────────────────────

  var BY_ID = {};
  UNITS.forEach(function (c) { BY_ID['u:' + c.id] = c; });
  WEAPONS.forEach(function (c) { BY_ID['w:' + c.id] = c; });
  ITEMS.forEach(function (c) { BY_ID['i:' + c.id] = c; });

  function get(ref) {
    var c = BY_ID[ref];
    if (!c) throw new Error('Cards.get: no card ' + ref);
    return c;
  }

  /* Expand a deck's "n copies of X" shorthand into the flat list the engine
     shuffles. Written as a count so a deck reads as a list of decisions rather
     than a wall of repeated ids. */
  function expand(entries) {
    var out = [];
    entries.forEach(function (e) {
      var ref = e[0], n = e[1] == null ? 1 : e[1];
      get(ref);                                    // fail loudly on a typo
      for (var i = 0; i < n; i++) out.push(ref);
    });
    return out;
  }

  // ── Decks ────────────────────────────────────────────────────────────────
  //
  // Three, each with a different answer to the same board, and each 15 cards
  // plus a Sovereign who starts deployed. Presets rather than a deck builder:
  // the interesting decision in a match this short is where a unit stands, not
  // which fifteen cards were chosen an hour earlier.

  var DECKS = [
    {
      id: 'ashfell', name: 'Ashfell Vanguard', badge: 'sword',
      lede: 'Cheap, fast, and unkind about it. Wins early or not at all.',
      sovereign: 'u:sov-ash',
      list: expand([
        ['u:vanguard', 2], ['u:duelist', 2], ['u:reaver', 2], ['u:lancer', 2],
        ['u:marksman', 1], ['u:shade', 1],
        ['w:keen', 1], ['w:twinfang', 1], ['w:reaveraxe', 1],
        ['i:salve', 1], ['i:whetstone', 1],
      ]),
    },
    {
      id: 'ivory', name: 'Ivory Wardens', badge: 'def',
      lede: 'Slow, armoured, and content to be attacked. Wins the long one.',
      sovereign: 'u:sov-ivory',
      list: expand([
        ['u:warden', 2], ['u:pikeguard', 2], ['u:hewer', 2], ['u:bannerguard', 1],
        ['u:mender', 2], ['u:marksman', 1],
        ['w:spirelance', 1], ['w:longpike', 1], ['w:maul', 1],
        ['i:elixir', 1], ['i:brigandine', 1],
      ]),
    },
    {
      id: 'storm', name: 'Storm Choir', badge: 'ember',
      lede: 'Hits the back row from the back row. Fragile if it is reached.',
      sovereign: 'u:sov-storm',
      list: expand([
        ['u:emberwright', 2], ['u:galecaller', 2], ['u:frostbinder', 2], ['u:mender', 2],
        ['u:shade', 1], ['u:skyguard', 1], ['u:marksman', 1],
        ['w:embergrim', 1], ['w:galecodex', 1], ['w:frosttome', 1],
        ['i:bolt', 1],
      ]),
    },
  ];

  /* A deck with the wrong count is a balance bug that is invisible in play —
     the short deck simply runs dry a turn early. Caught at load instead. */
  DECKS.forEach(function (d) {
    if (d.list.length !== RULES.DECK_SIZE) {
      throw new Error('Cards: deck "' + d.id + '" has ' + d.list.length +
                      ' cards, expected ' + RULES.DECK_SIZE);
    }
    Cards_get_sovereign_check(d);
  });

  /* Every deck needs exactly one Sovereign, and it must be one. */
  function Cards_get_sovereign_check(d) {
    var s = get(d.sovereign);
    if (!s.sovereign) throw new Error('Cards: deck "' + d.id + '" names a non-Sovereign');
  }

  var DECK_BY_ID = {};
  DECKS.forEach(function (d) { DECK_BY_ID[d.id] = d; });

  function deck(id) { return DECK_BY_ID[id] || DECKS[0]; }

  // ── Small shared queries ─────────────────────────────────────────────────

  function isArcane(at) { return !!ARCANE[at]; }

  /* +bonus when `a` holds advantage over `d`, 0 otherwise — including every
     cross-category pairing, where neither triangle applies. */
  function triangle(a, d) {
    return BEATS[a] === d ? RULES.TRIANGLE_BONUS : 0;
  }

  /* Steel matches exactly; any tome fits any caster; never across the two. */
  function canEquip(unitAt, weaponAt) {
    if (isArcane(unitAt) !== isArcane(weaponAt)) return false;
    return isArcane(weaponAt) ? true : unitAt === weaponAt;
  }

  function hasFx(list, kind) {
    for (var i = 0; i < list.length; i++) if (list[i].k === kind) return true;
    return false;
  }

  return {
    RULES: RULES, BEATS: BEATS, TYPE_LABEL: TYPE_LABEL, STAT_LABEL: STAT_LABEL,
    UNITS: UNITS, WEAPONS: WEAPONS, ITEMS: ITEMS, DECKS: DECKS,
    get: get, deck: deck, expand: expand,
    isArcane: isArcane, triangle: triangle, canEquip: canEquip, hasFx: hasFx,
  };
})();
