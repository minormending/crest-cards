/* The way in to the grown-up panel: a button you have to hold.

   Same reason landing.js exists. The styling was already shared -- .gu-corner,
   the ring, the sweep -- but the markup was copied into three index.html files
   and the hold was written three times, in three shapes, all agreeing on 1600ms
   by hand. Nothing enforced that agreement, and nothing shared the two details
   that actually matter: swallowing the click that follows a completed hold, and
   giving a child who taps it nothing to learn from.

   The duration is read from --gu-hold in grownup.css rather than repeated here,
   so the ring's sweep and the timer cannot disagree.

   Usage:

     const gate = Gate.mount({ onOpen: () => showPanel() });
     gate.hide();                  // mid-task, and while the panel is open

   Behaviour Garden's second way in -- a maths question, where a plain tap is
   the way through and the hold is off -- is `hold` as a function:

     Gate.mount({
       host: '#topbar', prepend: true, inline: true,
       hold: () => gateMode() === 'hold' && !unlocked,
       onOpen: openParent,
     });                                                                  */

window.Gate = (function () {
  'use strict';

  var RING =
    '<svg class="gu-ring" viewBox="0 0 48 48" aria-hidden="true">' +
    '<circle cx="24" cy="24" r="22"></circle></svg>';

  /* Sliders rather than a cog: a cog reads as "settings for this app" and this
     is closer to "not for you". */
  var GLYPH =
    '<svg class="gu-glyph" viewBox="0 0 24 24" aria-hidden="true">' +
    '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<path d="M3.5 8.5h8.5M18 8.5h2.5"></path>' +
    '<path d="M3.5 15.5h2.5M12 15.5h8.5"></path>' +
    '<circle cx="15" cy="8.5" r="3"></circle>' +
    '<circle cx="9" cy="15.5" r="3"></circle></g></svg>';

  function node(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
  }

  /* Asked of the stylesheet, not hardcoded. The ring's sweep is a CSS
     transition of the same length; a number repeated here could drift from it
     and the fill would finish early or late. */
  function holdMs(n) {
    var raw = getComputedStyle(n).getPropertyValue('--gu-hold').trim();
    var v = parseFloat(raw);
    if (!v) return 1600;
    return /ms\s*$/.test(raw) ? v : v * 1000;
  }

  function mount(opts) {
    opts = opts || {};

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gu-corner' + (opts.inline ? ' gu-corner--inline' : '');
    btn.setAttribute('aria-label', opts.label || 'Grown-up settings, press and hold');
    if (opts.id) btn.id = opts.id;
    btn.innerHTML = RING + GLYPH;

    /* Most games mount this during boot, on a screen it should not be offered
       on, so starting hidden is the safe default to be able to ask for. */
    if (opts.hidden) btn.hidden = true;

    var host = node(opts.host) || document.body;
    if (opts.prepend) host.insertBefore(btn, host.firstChild);
    else host.appendChild(btn);

    /* Either a fixed answer or one the app works out each time -- Behaviour
       Garden's depends on which gate is chosen and whether this session has
       already been let through. */
    function needsHold() {
      return typeof opts.hold === 'function' ? !!opts.hold()
           : opts.hold === undefined ? true
           : !!opts.hold;
    }

    var timer = null;
    var justHeld = false;

    function begin() {
      if (!needsHold()) return;
      /* keydown repeats while a key is down, and restarting the timer on every
         repeat means the hold never finishes. */
      if (btn.classList.contains('is-holding')) return;
      btn.classList.add('is-holding');
      clearTimeout(timer);
      timer = setTimeout(function () {
        btn.classList.remove('is-holding');
        justHeld = true;          // the pointerup that follows also fires click
        opts.onOpen();
      }, holdMs(btn));
    }

    function cancel() {
      clearTimeout(timer);
      btn.classList.remove('is-holding');
    }

    /* Cleared here rather than only when the click arrives, so the flag can
       never outlive the press that set it. Hold until it opens, then slide off
       the button instead of releasing on it, and no click follows -- without
       this the flag stays up and eats the next genuine tap. */
    btn.addEventListener('pointerdown', function () {
      justHeld = false;
      begin();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) {
      btn.addEventListener(e, cancel);
    });

    /* So the panel is never unreachable without a pointer. */
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); begin(); }
    });
    btn.addEventListener('keyup', cancel);
    btn.addEventListener('blur', cancel);

    btn.addEventListener('click', function () {
      if (justHeld) { justHeld = false; return; }
      if (!needsHold()) return opts.onOpen();
      /* A tap where a hold was needed. Acknowledge it and give nothing away:
         a wobble reads as "not that" to an adult and as nothing at all to a
         child, where a message would tell them there is something here. */
      btn.classList.remove('nudge-hold');
      void btn.offsetWidth;                 // restart the animation
      btn.classList.add('nudge-hold');
    });

    function toggle(on) { btn.hidden = !on; }

    return {
      el: btn,
      show: function () { toggle(true); },
      hide: function () { cancel(); toggle(false); },
      toggle: toggle,
    };
  }

  return { mount: mount };
})();
