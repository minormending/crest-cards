/* A heraldic crest for every card, generated rather than downloaded.

   Nineteen units, eleven weapons and nine items want thirty-nine distinct
   pieces of art, and the honest options were to draw them, to find licensed
   ones, or to make them. Making them won on three counts: nothing to ship,
   nothing to attribute, and a card always wears the same crest because the
   crest is a pure function of the card's id rather than a file somebody has to
   remember to add.

   The vocabulary is real heraldry, which is where the calm comes from — these
   are the divisions of the field a herald would recognise (per pale, per fess,
   per bend, quarterly, a chief, a border), in a muted palette, with the card's
   own icon laid over the top. Six divisions × eight tinctures × two charges is
   plenty of room for thirty-nine cards to look unrelated.

   Everything here is deterministic. Same id in, same crest out, on every
   machine and in every replay. */

window.Crest = (function () {
  'use strict';

  /* Muted, warm, and deliberately low-contrast: the crest sits BEHIND a name,
     a row of stats and an icon, and has to stay quiet enough to read over.
     Each entry is a pair, because a divided field needs two tinctures. */
  var TINCTURES = [
    { a: '#b9c4b0', b: '#9fae96', name: 'sage' },
    { a: '#c3c9d4', b: '#a9b2c1', name: 'slate' },
    { a: '#d6c3bd', b: '#c0a79f', name: 'clay' },
    { a: '#cfc7ad', b: '#b8ae8e', name: 'ochre' },
    { a: '#bdc6cb', b: '#a3aeb5', name: 'mist' },
    { a: '#c9bcc9', b: '#b0a0b0', name: 'heather' },
    { a: '#c2cbc0', b: '#a6b3a4', name: 'lichen' },
    { a: '#d2c8c0', b: '#bab0a6', name: 'linen' },
  ];

  var DIVISIONS = ['pale', 'fess', 'bend', 'quarterly', 'chief', 'plain'];

  /* FNV-1a. Small, stable, and — unlike anything built on string ordering or
     Math.random — guaranteed to give the same number in every browser, which
     it must, or two players would see different crests on the same card. */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /* Several independent choices out of one hash: shifting by a different amount
     each time keeps the division from being correlated with the tincture, which
     is what stops the set looking like eight repeated designs. */
  function pick(h, shift, list) {
    return list[(h >>> shift) % list.length];
  }

  function describe(id) {
    var h = hash(String(id));
    return {
      tincture: pick(h, 0, TINCTURES),
      division: pick(h, 7, DIVISIONS),
      bordered: ((h >>> 13) & 3) === 0,     // a quarter of them take a border
      flipped: ((h >>> 17) & 1) === 1,      // which tincture leads
    };
  }

  /* The shield outline: a classic heater shape, flat across the top with the
     sides falling to a point. Drawn in a 100×120 box so the caller can scale
     it with CSS and never has to think in pixels. */
  var SHIELD = 'M4 4 H96 V62 C96 92 74 110 50 116 C26 110 4 92 4 62 Z';

  function field(d) {
    var one = d.flipped ? d.tincture.b : d.tincture.a;
    var two = d.flipped ? d.tincture.a : d.tincture.b;
    var parts = ['<path d="' + SHIELD + '" fill="' + one + '"/>'];

    // Each division is the second tincture, clipped to the shield.
    var shape = {
      pale:      '<rect x="50" y="0" width="50" height="120"/>',
      fess:      '<rect x="0" y="60" width="100" height="60"/>',
      bend:      '<path d="M0 0 H100 V30 L0 120 Z"/>',
      quarterly: '<rect x="50" y="0" width="50" height="60"/><rect x="0" y="60" width="50" height="60"/>',
      chief:     '<rect x="0" y="0" width="100" height="30"/>',
      plain:     '',
    }[d.division];

    if (shape) {
      parts.push('<g clip-path="url(#' + d.clipId + ')" fill="' + two + '">' + shape + '</g>');
    }
    if (d.bordered) {
      parts.push('<path d="' + SHIELD + '" fill="none" stroke="' + two +
                 '" stroke-width="7" stroke-linejoin="round"/>');
    }
    return parts.join('');
  }

  /* Returns SVG markup, not a DOM node, so the caller can drop it into a
     template string alongside the rest of a card. The clip path needs an id
     unique to the document, hence the counter — two crests sharing an id is the
     kind of bug that only shows up on the second card. */
  var seq = 0;

  function svg(id, opts) {
    opts = opts || {};
    var d = describe(id);
    d.clipId = 'crest-clip-' + (seq++);
    return '<svg class="crest" viewBox="0 0 100 120" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + d.clipId + '"><path d="' + SHIELD + '"/></clipPath></defs>' +
      '<g clip-path="url(#' + d.clipId + ')">' + field(d) + '</g>' +
      '</svg>';
  }

  /* The crest's own colours, for anything that wants to sit beside it — the
     card's rule line, a selected outline — without re-deriving the hash. */
  function tint(id) {
    var d = describe(id);
    return d.flipped
      ? { near: d.tincture.b, far: d.tincture.a }
      : { near: d.tincture.a, far: d.tincture.b };
  }

  return { svg: svg, tint: tint, describe: describe, hash: hash };
})();
