/* The front door every game opens on.

   The markup and the fade live here rather than in each app, because they
   were the two things that could not be shared by copying a stylesheet: the
   markup was retyped per app, hand-copied SVG path and all, and the fade's
   duration was written four times -- once as 0.26s in landing.css and once
   as a bare 260 in each app's script. Change the CSS and three scripts go
   quietly out of step with it.

   Nothing here paints. Colours come from the --ld- tokens the app sets; see
   the header of landing.css.

   Usage, in full:

     Landing.open({
       host: '#screen-start',
       name: 'Letter Sounds',
       lede: 'Short practice. Real sounds. No guessing.',
       onStart: () => Audio3.unlock(),      // awaited; throw to refuse
       onGoing: () => {},                   // as the fade starts
       onLeave: () => Kid.show('home'),     // after the fade
     });

   Only host, name and onLeave are required.                              */

window.Landing = (function () {
  'use strict';

  /* The play triangle. Wordless on purpose: a five-year-old cannot read
     "Tap to start", and one of these games cannot use words at all. */
  var GLYPH =
    '<svg viewBox="0 0 24 24" class="landing-go-glyph" aria-hidden="true">' +
    '<path d="M8 5.5v13l11-6.5z"/></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function node(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel;
  }

  /* How long the door actually takes to fade, asked of the stylesheet rather
     than assumed. Returns 0 when there is no transition at all, which is what
     prefers-reduced-motion leaves us with. */
  function fadeMs(n) {
    var s = getComputedStyle(n);
    var secs = function (v) {
      return (v || '').split(',').reduce(function (max, part) {
        var f = parseFloat(part) || 0;
        return f > max ? f : max;
      }, 0);
    };
    return (secs(s.transitionDuration) + secs(s.transitionDelay)) * 1000;
  }

  function once(fn) {
    var done = false;
    return function () {
      if (done) return;
      done = true;
      fn();
    };
  }

  function open(opts) {
    var host = node(opts.host);
    if (!host) throw new Error('Landing.open: no host ' + opts.host);

    var pad = el('div', 'landing');
    var name = el('h1', 'landing-name', opts.name);
    var lede = opts.lede ? el('p', 'landing-lede', opts.lede) : null;

    var go = el('button', 'landing-go');
    go.type = 'button';
    go.setAttribute('aria-label', opts.label || 'Start');
    go.innerHTML = GLYPH;

    /* The caption carries what the button cannot say, and is also where
       "getting ready" and a refusal get said. */
    var capText = opts.cap || 'Tap to start';
    var cap = el('p', 'landing-cap', capText);
    var err = el('p', 'landing-err');

    pad.appendChild(name);
    if (lede) pad.appendChild(lede);
    pad.appendChild(go);
    pad.appendChild(cap);
    pad.appendChild(err);
    host.appendChild(pad);

    var gone = false;

    /* Fade the column, then hand back. The app is already behind it, which is
       what makes a game with scenery feel like it was there all along.

       transitionend is the signal; the timer is the safety net, because a tab
       in the background never fires it and the door must not be able to strand
       the app on itself. */
    function leave() {
      /* Once per door, not once at a time. Behaviour Garden also calls this
         when a garden arrives by share link, which can land after the child
         has already tapped through, and onLeave must not run twice. Opening a
         new door is Landing.open again. */
      if (gone) return;
      gone = true;
      /* At the top of the fade, not after it, so an app can bring its own
         chrome up as the door's words go down. On both paths -- a door
         dismissed from code has to do this too, or the app comes back to a
         screen still dressed for the door. */
      if (opts.onGoing) opts.onGoing();
      var finish = once(function () {
        if (opts.onLeave) opts.onLeave();
      });
      pad.classList.add('is-going');
      var ms = fadeMs(pad);
      if (!ms) return finish();
      pad.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, ms + 80);
    }

    go.addEventListener('click', function () {
      if (gone || go.disabled) return;
      err.textContent = '';

      if (!opts.onStart) return leave();

      /* Whatever onStart returns is awaited, so a game that has to load
         something can say so, and can refuse without the door disappearing
         out from under the message. */
      go.disabled = true;
      cap.textContent = opts.busy || capText;
      Promise.resolve()
        .then(function () { return opts.onStart(); })
        .then(function () {
          cap.textContent = capText;
          leave();
        })
        .catch(function (e) {
          if (window.console) console.error(e);
          go.disabled = false;
          cap.textContent = capText;
          err.textContent = opts.fail || 'That did not work. Try again.';
        });
    });

    return { el: pad, button: go, leave: leave };
  }

  return { open: open };
})();
