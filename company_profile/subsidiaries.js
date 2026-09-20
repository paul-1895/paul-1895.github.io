/* ================================================================
   subsidiaries.js  —  Subsidiaries & Holding Companies
   Attaches to company.html · call initSubsidiaries(code)
   Data: /data/subsidiaries.json (static, research-backed — see
   research/ pipeline conventions; only companies with an identified
   parent/subsidiary/sister-concern structure have an entry).
   ================================================================ */
'use strict';

(function () {
  let dataPromise = null;

  function fetchData() {
    if (!dataPromise) {
      dataPromise = fetch('/data/subsidiaries.json')
        .then(r => r.ok ? r.json() : { companies: {} })
        .catch(() => ({ companies: {} }));
    }
    return dataPromise;
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── CSS (injected once) ──────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('subs-styles')) return;
    const s = document.createElement('style');
    s.id = 'subs-styles';
    s.textContent = `
.subs-section { margin-top: 20px; }
.subs-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 8px);
  padding: 20px 22px;
}
.subs-hd {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 14px;
  font-family: var(--mono); font-size: 10px; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 1.5px;
}
.subs-hd::before {
  content: ''; width: 8px; height: 8px; background: var(--accent);
  border-radius: 50%; box-shadow: 0 0 8px var(--accent-glow); flex-shrink: 0;
}
.subs-group-badge {
  display: inline-block; margin-bottom: 14px;
  font-family: var(--mono); font-size: 11px; font-weight: 700;
  color: var(--accent); background: rgba(88,166,255,.08);
  border: 1px solid var(--accent); border-radius: 6px;
  padding: 4px 10px;
}
.subs-block { margin-bottom: 16px; }
.subs-block:last-child { margin-bottom: 0; }
.subs-block-label {
  font-family: var(--mono); font-size: 9px; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px;
}
.subs-parent {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  font-size: 14px; color: var(--text-primary); font-weight: 600;
}
.subs-parent-rel { font-size: 11px; color: var(--text-muted); font-weight: 400; }
.subs-list { display: flex; flex-direction: column; gap: 8px; }
.subs-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
  background: rgba(255,255,255,.02);
}
.subs-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.subs-row-name { font-size: 13px; color: var(--text-primary); font-weight: 600; }
.subs-row-name a { color: inherit; text-decoration: none; }
.subs-row-name a:hover { color: var(--accent); text-decoration: underline; }
.subs-row-sector { font-size: 11px; color: var(--text-muted); }
.subs-row-own {
  font-family: var(--mono); font-size: 12px; font-weight: 700; color: var(--accent);
  white-space: nowrap; flex-shrink: 0;
}
.subs-sister-list { display: flex; flex-wrap: wrap; gap: 8px; }
.subs-sister-chip {
  font-size: 11px; color: var(--text-secondary);
  border: 1px solid var(--border); border-radius: 14px; padding: 4px 10px;
}
.subs-sources {
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);
  font-size: 10px; line-height: 1.6; color: var(--text-muted);
}
`;
    document.head.appendChild(s);
  }

  /* ── RENDER ───────────────────────────────────────────────── */
  function renderSubsidiary(sub) {
    const nameHtml = sub.ticker
      ? `<a href="company.html?code=${encodeURIComponent(sub.ticker)}">${escHtml(sub.name)}</a>`
      : escHtml(sub.name);
    return `
      <div class="subs-row">
        <div class="subs-row-main">
          <div class="subs-row-name">${nameHtml}${sub.ticker ? ` <span style="color:var(--text-muted);font-weight:400">(${escHtml(sub.ticker)})</span>` : ''}</div>
          ${sub.sector ? `<div class="subs-row-sector">${escHtml(sub.sector)}${sub.relationship ? ' · ' + escHtml(sub.relationship) : ''}</div>` : (sub.relationship ? `<div class="subs-row-sector">${escHtml(sub.relationship)}</div>` : '')}
        </div>
        ${sub.ownership ? `<div class="subs-row-own">${escHtml(sub.ownership)}</div>` : ''}
      </div>`;
  }

  function render(entry) {
    const container = document.getElementById('subsidiaries-section');
    if (!container) return;

    if (!entry) {
      container.innerHTML = '';
      return;
    }

    const blocks = [];

    if (entry.groupName) {
      blocks.push(`<div class="subs-group-badge">Part of ${escHtml(entry.groupName)}</div>`);
    }

    if (entry.parentCompanyName) {
      blocks.push(`
        <div class="subs-block">
          <div class="subs-block-label">Parent / Holding Company</div>
          <div class="subs-parent">
            ${escHtml(entry.parentCompanyName)}
            ${entry.parentRelationship ? `<span class="subs-parent-rel">— ${escHtml(entry.parentRelationship)}</span>` : ''}
          </div>
        </div>`);
    }

    if (entry.subsidiaries && entry.subsidiaries.length) {
      blocks.push(`
        <div class="subs-block">
          <div class="subs-block-label">Subsidiaries (${entry.subsidiaries.length})</div>
          <div class="subs-list">${entry.subsidiaries.map(renderSubsidiary).join('')}</div>
        </div>`);
    }

    if (entry.sisterConcerns && entry.sisterConcerns.length) {
      blocks.push(`
        <div class="subs-block">
          <div class="subs-block-label">Sister Concerns</div>
          <div class="subs-sister-list">
            ${entry.sisterConcerns.map(sc => `<span class="subs-sister-chip" title="${escAttr(sc.note || '')}">${escHtml(sc.name)}</span>`).join('')}
          </div>
        </div>`);
    }

    if (!blocks.length) {
      container.innerHTML = '';
      return;
    }

    const sourcesHtml = (entry.sources && entry.sources.length)
      ? `<div class="subs-sources">Sources: ${entry.sources.map(escHtml).join(' · ')}</div>`
      : '';

    container.innerHTML = `
      <div class="subs-section">
        <div class="subs-card">
          <div class="subs-hd">Subsidiaries &amp; Holding Companies</div>
          ${blocks.join('')}
          ${sourcesHtml}
        </div>
      </div>`;
  }

  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── INIT ─────────────────────────────────────────────────── */
  window.initSubsidiaries = async function (code) {
    injectCSS();
    const container = document.getElementById('subsidiaries-section');
    if (!container) return;
    try {
      const data = await fetchData();
      render((data.companies || {})[code] || null);
    } catch {
      container.innerHTML = '';
    }
  };
})();
