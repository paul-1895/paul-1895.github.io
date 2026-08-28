'use strict';

/* ════════════════════════════════════════════════════════════
   investment-process.js
   Static long-form playbook page — no live data fetching. Wires
   up smooth-scroll table-of-contents navigation with scrollspy
   highlighting, the shared theme toggle, and an on-demand
   Bengali translation toggle (mirrors startup-plan.js's version).
   ════════════════════════════════════════════════════════════ */

function initScrollspy() {
  const links = Array.from(document.querySelectorAll('.ip-toc-link'));
  const sections = links
    .map(link => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (!sections.length) return;

  const order = sections.map(s => s.id);
  const visible = new Set();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visible.add(entry.target.id);
      else visible.delete(entry.target.id);
    });
    // Multiple sections can straddle the thin detection band at once (e.g. a
    // short section between two tall ones); only the furthest-scrolled one
    // should read as active, so a single link is ever highlighted.
    const activeId = order.filter(id => visible.has(id)).pop();
    links.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href').slice(1) === activeId);
    });
  }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });

  sections.forEach(sec => observer.observe(sec));

  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Bengali translation toggle
   Machine-translates the plan's text via the shared /api/translate
   proxy (same Google Translate endpoint the newspaper page's
   "Translate to Bengali" button uses) — best-effort, not a
   guaranteed-accurate translation. Numeric/date figures (stat
   values, bar-chart values, TOC/slide/pillar numbers, roadmap
   phase timing, and the minute-range meeting agenda) are left
   untranslated: short "X-Y" style ranges have been observed to
   get mistranslated into unrelated numbers rather than staying a
   relative range (e.g. "Year 1-3" -> a fabricated "1971-1975" on
   the companion Startup Plan page), so anything in that shape is
   excluded here too.
   ════════════════════════════════════════════════════════════ */

const LANG_EXCLUDE_SELECTOR = '.ip-stat-val, .ip-bar-value, .ip-toc-num, .ip-phase-when, .ip-timeline-date, .ip-slide-num, .ip-pillar-num, svg, script, style';

function collectTranslatableTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || el.closest(LANG_EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function translateFragment(text) {
  try {
    const res = await fetch(`/api/translate?text=${encodeURIComponent(text)}&to=bn`);
    if (!res.ok) return text;
    const data = await res.json();
    return data.translated || text;
  } catch {
    return text;
  }
}

function initLanguageToggle() {
  const btn = document.getElementById('lang-toggle-btn');
  const label = document.getElementById('lang-label');
  const note = document.getElementById('ipLangNote');
  const revertBtn = document.getElementById('ipLangRevertBtn');
  if (!btn) return;

  const root = document.querySelector('main.ip-page-root');
  const footer = document.querySelector('footer.site-footer');
  const cache = new Map(); // original trimmed text -> translated text
  let textNodes = null;
  let originals = null;
  let isBengali = false;
  let busy = false;

  function ensureNodes() {
    if (textNodes) return;
    textNodes = [
      ...collectTranslatableTextNodes(root),
      ...collectTranslatableTextNodes(footer),
    ];
    originals = textNodes.map((n) => n.nodeValue);
  }

  async function toBengali() {
    ensureNodes();
    const uncached = Array.from(new Set(originals)).filter((s) => !cache.has(s));
    if (uncached.length) {
      const translations = await runLimited(uncached, 5, translateFragment);
      uncached.forEach((s, i) => cache.set(s, translations[i]));
    }
    textNodes.forEach((node, i) => { node.nodeValue = cache.get(originals[i]) || originals[i]; });
    document.body.classList.add('lang-bn');
    document.documentElement.lang = 'bn';
  }

  function toEnglish() {
    if (textNodes) textNodes.forEach((node, i) => { node.nodeValue = originals[i]; });
    document.body.classList.remove('lang-bn');
    document.documentElement.lang = 'en';
  }

  function setLabel() {
    if (label) label.textContent = isBengali ? 'English' : 'বাংলা';
    btn.setAttribute('data-tooltip', isBengali ? 'Show original (English)' : 'Machine-translate this page to Bengali');
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    if (!isBengali) {
      if (label) label.textContent = 'Translating…';
      try {
        await toBengali();
        isBengali = true;
        if (note) note.style.display = 'flex';
      } catch (err) {
        console.error('[investment-process] Bengali translation failed:', err);
      }
    } else {
      toEnglish();
      isBengali = false;
      if (note) note.style.display = 'none';
    }
    setLabel();
    btn.disabled = false;
    busy = false;
  }

  btn.addEventListener('click', toggle);
  if (revertBtn) revertBtn.addEventListener('click', () => { if (isBengali) toggle(); });
}

document.addEventListener('DOMContentLoaded', () => {
  initScrollspy();
  initLanguageToggle();
});
