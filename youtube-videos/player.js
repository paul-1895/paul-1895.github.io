/* ═══════════════════════════════════════════════════════════
   player.js — YouTube Videos page: in-page modal player

   Implements window.YTPlayer.open(videoId) per the page's contract.
   Mirrors the proven pattern already used by learning/guide-videos.js
   and learning/topic.js: build the modal DOM once (lazily, on first
   use — not at parse time), load the YouTube IFrame Player API on
   demand, create a single YT.Player instance and reuse it across
   opens via loadVideoById(), default to 2x playback, and support
   Esc / backdrop-click / close-button to dismiss.

   No imports, no exports — plain <script>, attaches window.YTPlayer.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var YT_PLAYBACK_RATE = 2; // always start videos at 2x, matching the rest of the app

  var ROOT_ID          = 'ytPlayerModalRoot';
  var IFRAME_TARGET_ID = 'ytPlayerIframeTarget';

  var modalEl       = null; // .yt-modal — the full-screen backdrop, built once
  var frameWrapEl   = null; // holds the YT iframe target, sized to a 16:9 box
  var extLinkEl     = null; // "Open in YouTube" escape hatch in the header

  var ytPlayer       = null;  // YT.Player instance, created once and reused
  var ytPlayerReady  = false;
  var pendingVideoId = null;  // videoId requested before the player/API was ready

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function watchUrl(id) {
    return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
  }

  // ── modal DOM (built lazily into #ytPlayerModalRoot, reused after) ──
  function buildModal() {
    if (modalEl) return modalEl;

    var root = document.getElementById(ROOT_ID);
    if (!root) return null;

    modalEl = document.createElement('div');
    modalEl.className = 'yt-modal';
    modalEl.id = 'ytPlayerModal';
    modalEl.style.display = 'none';

    modalEl.innerHTML =
      '<div class="yt-modal-inner yt-player-modal-inner" role="dialog" aria-modal="true" aria-label="Video player">' +
        '<div class="yt-player-modal__header">' +
          '<span class="yt-player-modal__badge">YouTube <span class="yt-player-modal__speed">2&times; speed</span></span>' +
          '<div class="yt-player-modal__actions">' +
            '<a class="yt-player-modal__extlink" id="ytPlayerExtLink" href="#" target="_blank" rel="noopener">Open in YouTube&nbsp;↗</a>' +
            '<button type="button" class="yt-modal__close" id="ytPlayerCloseBtn" aria-label="Close video">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="yt-player-modal__frame-wrap" id="ytPlayerFrameWrap">' +
          '<div id="' + IFRAME_TARGET_ID + '"></div>' +
        '</div>' +
      '</div>';

    root.appendChild(modalEl);

    extLinkEl   = modalEl.querySelector('#ytPlayerExtLink');
    frameWrapEl = modalEl.querySelector('#ytPlayerFrameWrap');

    // Essential sizing for the video box (16:9) — kept inline since this
    // is a class the shared page CSS has no reason to know about; it
    // doesn't touch anything in the .yt-modal / .yt-modal-inner contract.
    frameWrapEl.style.position   = 'relative';
    frameWrapEl.style.width      = '100%';
    frameWrapEl.style.aspectRatio = '16 / 9';
    frameWrapEl.style.background  = '#000';
    frameWrapEl.style.overflow    = 'hidden';

    // Backdrop click (anywhere on .yt-modal that isn't the dialog itself)
    // closes; clicking inside the dialog does not bubble out of it.
    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) close();
    });
    modalEl.querySelector('#ytPlayerCloseBtn').addEventListener('click', close);
    if (extLinkEl) extLinkEl.addEventListener('click', function (e) { e.stopPropagation(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && modalEl.style.display !== 'none') close();
    });

    loadApi();
    return modalEl;
  }

  // ── YouTube IFrame Player API ──
  function loadApi() {
    if (window.YT && window.YT.Player) { onApiReady(); return; }
    if (document.getElementById('yt-api-script')) return; // already loading (possibly by another page module)

    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') { try { prev(); } catch (_) {} }
      onApiReady();
    };
    var s = document.createElement('script');
    s.id  = 'yt-api-script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function onApiReady() {
    if (ytPlayer) return; // already built (e.g. API finished loading twice)
    try {
      ytPlayer = new YT.Player(IFRAME_TARGET_ID, {
        width:  '100%',
        height: '100%',
        playerVars: {
          rel: 0,
          playsinline: 1
          // Note: the IFrame Player API has no documented playerVar for a
          // default playback rate — the 2x default below is applied via
          // setPlaybackRate() on ready and again on the PLAYING state,
          // which is the same fallback this app already relies on in
          // learning/guide-videos.js and learning/topic.js.
        },
        events: {
          onReady: function (e) {
            ytPlayerReady = true;
            if (frameWrapEl) frameWrapEl.classList.add('is-loaded');
            if (pendingVideoId) {
              var id = pendingVideoId;
              pendingVideoId = null;
              try { e.target.loadVideoById(id); } catch (_) {}
            }
            try { e.target.setPlaybackRate(YT_PLAYBACK_RATE); } catch (_) {}
          },
          onStateChange: function (e) {
            if (e.data === 1) { // YT.PlayerState.PLAYING
              try { e.target.setPlaybackRate(YT_PLAYBACK_RATE); } catch (_) {}
            }
          }
        }
      });
    } catch (_) {
      // API script loaded but construction failed for some reason — a
      // later open() call will find ytPlayer still null and just queue
      // the id again via pendingVideoId; nothing more to do here.
    }
  }

  // ── open / close ──
  function open(videoId) {
    if (!videoId) return;
    var modal = buildModal();
    if (!modal) return;

    if (extLinkEl) extLinkEl.href = watchUrl(videoId);
    if (frameWrapEl) frameWrapEl.classList.remove('is-loaded');

    modal.style.display = 'flex';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    if (ytPlayerReady && ytPlayer) {
      try {
        ytPlayer.loadVideoById(videoId);
        ytPlayer.setPlaybackRate(YT_PLAYBACK_RATE);
      } catch (_) {
        pendingVideoId = videoId;
      }
    } else {
      pendingVideoId = videoId;
      loadApi(); // no-op if already loading/loaded; covers the API-slow-to-init case
    }
  }

  function close() {
    if (ytPlayer && ytPlayerReady) {
      try { ytPlayer.stopVideo(); } catch (_) {}
    }
    if (modalEl) {
      modalEl.style.display = 'none';
      modalEl.classList.remove('open');
    }
    document.body.style.overflow = '';
  }

  window.YTPlayer = { open: open };
})();
