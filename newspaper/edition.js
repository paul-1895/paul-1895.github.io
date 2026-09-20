'use strict';

// ─── Renders one self-published edition as a printable front page ────────────
// Everything on this page comes from the frozen story snapshot stored with the
// edition, so it reads exactly as it did the day it was published — no lookups
// against the live news feed.

(function () {
  const statusEl = document.getElementById('ed-status');
  const paperEl = document.getElementById('ed-paper');
  const printBtnEl = document.getElementById('ed-print-btn');
  const copyBtnEl = document.getElementById('ed-copy-btn');

  const MAX_LEAD_PARAS = 5;
  const MAX_FEATURE_PARAS = 2;
  const MAX_STRAP_CODES = 14;
  // Kept in sync with WORLD_CODE/WORLD_LABEL in news-scraper/global-tickers.js
  const WORLD_CODE = 'WORLD';
  const WORLD_LABEL = 'World markets';

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.style.display = message ? 'block' : 'none';
    statusEl.classList.toggle('np-status--error', !!isError);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatDateline(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = String(dateStr).split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function formatShortDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Body paragraphs, longest-available first: the scraped article text if we
  // have it, otherwise the source's own summary.
  function bodyParagraphs(story, maxParas) {
    const raw = story.content || story.description || '';
    const paras = raw.split('\n\n').map((p) => p.trim()).filter(Boolean);
    return paras.slice(0, maxParas);
  }

  function buildKicker(story) {
    const isWorld = story.scope === 'world';
    if (!isWorld && !story.stockCode && !story.stockName) return null;

    const kicker = el('div', 'ed-kicker');
    if (isWorld) kicker.appendChild(el('span', 'ed-kicker-world', 'World'));
    // WORLD is the "no single company" bucket, already said by the World tag.
    if (story.stockCode && story.stockCode !== WORLD_CODE) {
      kicker.appendChild(el('span', 'ed-kicker-code', story.stockCode));
    }
    if (story.stockName && story.stockName !== WORLD_LABEL) {
      kicker.appendChild(el('span', 'ed-kicker-name', story.stockName));
    }
    return kicker;
  }

  function buildByline(story) {
    const bits = [];
    if (story.siteName) bits.push(story.siteName);
    const dateStr = formatShortDate(story.publishedAt);
    if (dateStr) bits.push(dateStr);
    if (!bits.length) return null;
    return el('div', 'ed-byline', bits.join(' · '));
  }

  function buildSourceLink(story, label) {
    if (!story.url) return null;
    const link = el('a', 'ed-source-link', label);
    link.href = story.url;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  function buildEditorNoteLine(story) {
    if (!story.note) return null;
    const note = el('p', 'ed-story-note');
    note.appendChild(el('span', 'ed-story-note-label', "Editor's note"));
    note.appendChild(document.createTextNode(story.note));
    return note;
  }

  function appendIfPresent(parent, node) {
    if (node) parent.appendChild(node);
  }

  function buildLead(story) {
    const section = el('section', 'ed-lead');

    appendIfPresent(section, buildKicker(story));
    section.appendChild(el('h2', 'ed-lead-headline', story.headline));
    appendIfPresent(section, buildByline(story));

    if (story.image) {
      const img = el('img', 'ed-lead-image');
      img.src = story.image;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      section.appendChild(img);
    }

    appendIfPresent(section, buildEditorNoteLine(story));

    const body = el('div', 'ed-lead-body');
    bodyParagraphs(story, MAX_LEAD_PARAS).forEach((p) => body.appendChild(el('p', null, p)));
    if (body.childElementCount) section.appendChild(body);

    appendIfPresent(section, buildSourceLink(story, 'Full report at the source →'));
    return section;
  }

  function buildFeature(story) {
    const article = el('article', 'ed-feature');

    appendIfPresent(article, buildKicker(story));
    article.appendChild(el('h3', 'ed-feature-headline', story.headline));
    appendIfPresent(article, buildByline(story));

    if (story.image) {
      const img = el('img', 'ed-feature-image');
      img.src = story.image;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      article.appendChild(img);
    }

    appendIfPresent(article, buildEditorNoteLine(story));

    const body = el('div', 'ed-feature-body');
    bodyParagraphs(story, MAX_FEATURE_PARAS).forEach((p) => body.appendChild(el('p', null, p)));
    if (body.childElementCount) article.appendChild(body);

    appendIfPresent(article, buildSourceLink(story, 'Read on →'));
    return article;
  }

  function buildBrief(story) {
    const item = el('li', 'ed-brief');

    if (story.stockCode) item.appendChild(el('span', 'ed-brief-code', story.stockCode));
    item.appendChild(el('span', 'ed-brief-headline', story.headline));

    const tail = [];
    if (story.siteName) tail.push(story.siteName);
    const dateStr = formatShortDate(story.publishedAt);
    if (dateStr) tail.push(dateStr);
    if (tail.length) item.appendChild(el('span', 'ed-brief-source', tail.join(' · ')));

    if (story.note) item.appendChild(el('span', 'ed-brief-note', story.note));
    appendIfPresent(item, buildSourceLink(story, 'Source →'));

    return item;
  }

  function buildStrap(edition, stories) {
    const codes = Array.from(new Set(
      stories.map((s) => s.stockCode).filter((c) => c && c !== WORLD_CODE)
    ));
    const sources = Array.from(new Set(stories.map((s) => s.siteName).filter(Boolean)));
    const worldCount = stories.filter((s) => s.scope === 'world').length;

    const strap = el('div', 'ed-strap');
    strap.appendChild(el('span', 'ed-strap-item ed-strap-item--nowrap',
      `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`));
    if (worldCount) {
      strap.appendChild(el('span', 'ed-strap-item ed-strap-item--nowrap',
        `${worldCount} international`));
    }
    if (codes.length) {
      const shown = codes.slice(0, MAX_STRAP_CODES).join(' · ');
      const extra = codes.length - MAX_STRAP_CODES;
      strap.appendChild(el('span', 'ed-strap-item',
        `In this edition: ${shown}${extra > 0 ? ` +${extra} more` : ''}`));
    }
    if (sources.length) {
      strap.appendChild(el('span', 'ed-strap-item', `Sourced from ${sources.join(', ')}`));
    }
    return strap;
  }

  function renderEdition(edition) {
    const stories = Array.isArray(edition.stories) ? edition.stories : [];
    const leads = stories.filter((s) => s.slot === 'lead');
    const briefs = stories.filter((s) => s.slot === 'brief');
    // Anything not explicitly a lead or a brief runs as a feature, including
    // an unrecognised slot from an older edition.
    const features = stories.filter((s) => s.slot !== 'lead' && s.slot !== 'brief');

    paperEl.innerHTML = '';

    // ── Masthead ──
    const masthead = el('div', 'ed-masthead');
    const top = el('div', 'ed-masthead-top');
    top.appendChild(el('span', null, formatDateline(edition.editionDate)));
    top.appendChild(el('span', null, 'Self-published · DSE Live Market'));
    masthead.appendChild(top);
    masthead.appendChild(el('h1', 'ed-title', edition.name));
    if (edition.tagline) masthead.appendChild(el('p', 'ed-tagline', edition.tagline));
    paperEl.appendChild(masthead);
    paperEl.appendChild(el('div', 'np-rule'));
    paperEl.appendChild(buildStrap(edition, stories));

    // ── Body: leads + features on the left, editor's note + briefs aside ──
    const body = el('div', 'ed-body');
    const main = el('div', 'ed-main');

    leads.forEach((s) => main.appendChild(buildLead(s)));

    if (features.length) {
      const grid = el('div', 'ed-features');
      features.forEach((s) => grid.appendChild(buildFeature(s)));
      main.appendChild(grid);
    }

    body.appendChild(main);

    const side = el('aside', 'ed-side');

    if (edition.editorNote) {
      const box = el('section', 'ed-note-box');
      box.appendChild(el('div', 'ed-side-label', 'From the editor'));
      edition.editorNote.split('\n').map((p) => p.trim()).filter(Boolean)
        .forEach((p) => box.appendChild(el('p', null, p)));
      side.appendChild(box);
    }

    if (briefs.length) {
      const box = el('section', 'ed-briefs-box');
      box.appendChild(el('div', 'ed-side-label', 'In brief'));
      const list = el('ul', 'ed-briefs');
      briefs.forEach((s) => list.appendChild(buildBrief(s)));
      box.appendChild(list);
      side.appendChild(box);
    }

    if (side.childElementCount) body.appendChild(side); else body.classList.add('ed-body--no-side');

    paperEl.appendChild(body);

    // ── Colophon ──
    const colophon = el('div', 'ed-colophon');
    const published = formatShortDate(edition.createdAt);
    const updated = edition.updatedAt && edition.updatedAt !== edition.createdAt
      ? formatShortDate(edition.updatedAt) : null;
    colophon.textContent = [
      `${edition.name} — compiled from published market coverage`,
      published ? `first published ${published}` : null,
      updated && updated !== published ? `last revised ${updated}` : null,
    ].filter(Boolean).join(' · ');
    paperEl.appendChild(colophon);

    paperEl.style.display = 'block';
    setStatus('');
    document.title = `${edition.name} — ${edition.editionDate}`;
  }

  async function init() {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      setStatus('No edition selected. Open one from "My editions" on the newspaper page.', true);
      return;
    }

    try {
      const res = await fetch(`/api/news/editions/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `responded with ${res.status}`);
      renderEdition(data.edition);
    } catch (err) {
      console.error('[edition] Failed to load edition:', err);
      setStatus('Could not load this edition: ' + err.message, true);
    }
  }

  if (printBtnEl) printBtnEl.addEventListener('click', () => window.print());

  if (copyBtnEl) {
    copyBtnEl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        copyBtnEl.textContent = 'Link copied';
      } catch {
        copyBtnEl.textContent = 'Copy failed';
      }
      setTimeout(() => { copyBtnEl.textContent = 'Copy link'; }, 1800);
    });
  }

  init();
})();
