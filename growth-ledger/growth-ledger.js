// Growth Ledger — feature inventory + commit-history report.
// The commit-history numbers (STATS minus "pages shipped", the weekly
// chart, and the timeline) are fetched from /data/growth-ledger-stats.json,
// which routes/growth-ledger-data.js regenerates from `git log` on every
// server start and every weekend (see routes/growth-ledger-scheduler.js).
// The feature catalog below is still hand-maintained — there's no single
// accurate registry of app pages to derive it from.
(function () {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function fmtShort(isoDate) {
    const [y, m, d] = isoDate.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  }

  const CATEGORIES = [
    {
      label: "Markets",
      items: [
        ["Live Market", "Real-time DSE table with sortable rankings and index snapshot"],
        ["Candlestick Chart", "TradingView-style chart with Analysis, Valuation and S&R panels, trade markers"],
        ["Screener", "Master-detail stock screener with saved technical scans"],
        ["Newspaper", "Self-published daily edition, world-news scrape, Bengali translation"],
        ["Economic Impact", "Macro indicators laid against market moves"],
      ],
    },
    {
      label: "Strategy",
      items: [
        ["Super Model", "Composite signal backtest across the exchange"],
        ["Minervini Model", "Trend-template screen for stage-2 breakouts"],
        ["MACD + 50 EMA", "Moving-average crossover backtest, all listed stocks"],
        ["Random Strategies", "MCDA dividend scorer and a real-bank ranking hub"],
        ["Demo Trade", "Paper-trading sandbox"],
      ],
    },
    {
      label: "Portfolio",
      items: [
        ["Portfolio Manager", "Holdings, allocation, and performance"],
        ["Trades", "Trade log with a turnover breakdown modal"],
        ["Gain Projection", "Goal tracking with multi-scenario projections"],
        ["Currency Portfolio", "Holdings valued in world currencies, with a world map"],
        ["Ultimate Report", "Consolidated portfolio report"],
      ],
    },
    {
      label: "Tools",
      items: [
        ["Calculators", "Compound interest, DPS, and grid-buy"],
        ["Learning Hub", "16 guides — candlestick patterns, indicators, sector primers"],
        ["Fundamentals", "Per-company fundamentals grid, 398 tickers"],
        ["What-if", "Scenario simulator"],
        ["Dream Goals · Tasks · Startup Plan · Investment Process", "Planning and tracking pages"],
      ],
    },
    {
      label: "Data infrastructure",
      items: [
        ["Bank Financials", "36 DSE banks, 15 years quarterly (2011–2026), 1,741 filings, cross-bank benchmarking"],
        ["Historical Prices", "396 tickers, back to 2015"],
        ["Annual Report Archive", "76 bank-year filings converted to searchable text"],
        ["Mutual Fund Portfolios", "25 funds tracked, with a compare tool"],
      ],
    },
    {
      label: "Platform",
      items: [
        ["Sign-in Gate", "Trusted-device auth; private data no longer served publicly"],
        ["Settings", "Site-wide display engine — looks, contrast, sharing"],
        ["Static Site Pipeline", "Publishes a read-only mirror of ~33 pages to GitHub Pages"],
        ["Mobile Pass", "Every page reworked to fit a phone"],
      ],
    },
  ];

  /* ---------------- Feature catalog (static) ---------------- */

  const catGrid = document.getElementById("glCatGrid");
  CATEGORIES.forEach(cat => {
    const card = document.createElement("div");
    card.className = "gl-cat";
    const rows = cat.items.map(([name, desc]) =>
      `<div class="gl-feat"><div class="gl-feat-name">${name}</div><div class="gl-feat-desc">${desc}</div></div>`
    ).join("");
    card.innerHTML = `<span class="gl-cat-chip">${cat.label}</span>${rows}`;
    catGrid.appendChild(card);
  });

  /* ---------------- Tooltip ---------------- */

  const tooltip = document.createElement("div");
  tooltip.className = "gl-tooltip";
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);

  function showTooltip(evt, html) {
    tooltip.innerHTML = html;
    tooltip.classList.add("show");
    positionTooltip(evt);
  }
  function positionTooltip(evt) {
    const pt = evt.touches ? evt.touches[0] : evt;
    tooltip.style.left = pt.clientX + "px";
    tooltip.style.top = (pt.clientY - 12) + "px";
  }
  function hideTooltip() { tooltip.classList.remove("show"); }

  /* ---------------- SVG helpers ---------------- */

  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ---------------- Stat row ---------------- */

  function renderStatRow(data) {
    const stats = [
      { n: "59", l: "pages shipped" },
      { n: String(data.commits), l: "commits" },
      { n: String(data.weeksBuilding), l: "weeks building" },
      { n: `${data.bankFinancials.banks} × ${data.bankFinancials.yearSpan}yr`, l: "bank financials" },
      { n: String(data.tickersOfPriceHistory), l: "tickers of price history" },
    ];
    const statRow = document.getElementById("glStatRow");
    stats.forEach(s => {
      const d = document.createElement("div");
      d.className = "gl-stat";
      d.innerHTML = `<div class="gl-stat-val">${s.n}</div><div class="gl-stat-label">${s.l}</div>`;
      statRow.appendChild(d);
    });
  }

  /* ---------------- Timeline ---------------- */

  function renderTimeline(timeline) {
    const tlList = document.getElementById("glTimeline");
    timeline.forEach(t => {
      const item = document.createElement("div");
      item.className = "gl-phase" + (t.peak ? " peak" : "");
      let figuresHtml = "";
      if (t.figures) {
        figuresHtml = `<div class="gl-figures">${t.figures.map(([n, l]) =>
          `<div><div class="gl-fig-val">${n}</div><div class="gl-fig-label">${l}</div></div>`
        ).join("")}</div>`;
      }
      item.innerHTML = `
        <div class="gl-phase-hd">
          <span class="gl-phase-title">${t.headline}</span>
          <span class="gl-phase-when">${t.range}</span>
        </div>
        <p>${t.text}</p>
        ${figuresHtml}`;
      tlList.appendChild(item);
    });
  }

  /* ---------------- Bar chart ---------------- */

  function renderBarChart(weeks) {
    const svg = document.getElementById("glBarChart");
    if (!svg) return;
    const W = 900, H = 300;
    const padL = 6, padR = 6, padT = 44, padB = 34;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = weeks.length;
    const gap = 8;
    const barW = (innerW - gap * (n - 1)) / n;
    const maxVal = Math.max(...weeks.map(w => w.n));

    svg.setAttribute("aria-label",
      `Bar chart of commits per week from ${weeks[0].range} to ${weeks[n - 1].range}, showing a peak of ${maxVal} commits.`);

    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "gl-zero-baseline" }));

    weeks.forEach((w, i) => {
      const x = padL + i * (barW + gap);
      const h = w.n === 0 ? 0 : Math.max((w.n / maxVal) * innerH, 4);
      const y = H - padB - h;
      const isPeak = w.n === maxVal;

      const rect = el("rect", {
        x: x.toFixed(1), y: y.toFixed(1), width: barW.toFixed(1), height: h.toFixed(1),
        rx: 2, class: "gl-bar" + (isPeak ? " peak" : ""), tabindex: "0",
        "aria-label": `Week of ${w.range}: ${w.n} commits`,
      });
      const tipHtml = () => `<b>${w.range}</b><br><span class="muted">commits</span> ${w.n}${w.note ? `<br><span class="muted">${w.note}</span>` : ""}`;
      rect.addEventListener("mouseenter", e => showTooltip(e, tipHtml()));
      rect.addEventListener("mousemove", positionTooltip);
      rect.addEventListener("mouseleave", hideTooltip);
      rect.addEventListener("focus", e => showTooltip(e, tipHtml()));
      rect.addEventListener("blur", hideTooltip);
      svg.appendChild(rect);

      if (i === 0 || w.month !== weeks[i - 1].month) {
        const t = el("text", { x: (x + barW / 2).toFixed(1), y: H - padB + 16, class: "gl-axis-label" });
        t.textContent = w.month;
        svg.appendChild(t);
      }
    });

    const peakIdx = weeks.findIndex(w => w.n === maxVal);
    const px = padL + peakIdx * (barW + gap) + barW / 2;
    const callY = padT - 10;
    svg.appendChild(el("line", { x1: px, x2: px, y1: callY + 4, y2: H - padB - innerH + 4, class: "gl-callout-line" }));
    const label = el("text", { x: px, y: callY - 4, class: "gl-callout-text", "text-anchor": px > W - 160 ? "end" : "middle" });
    const peakNote = weeks[peakIdx].note || "peak week";
    label.innerHTML = `<tspan x="${px}" dy="0">${maxVal} commits</tspan><tspan class="sub" x="${px}" dy="13">${peakNote}</tspan>`;
    svg.appendChild(label);
  }

  /* ---------------- Cumulative area chart ---------------- */

  function renderAreaChart(weeks, startLabel, endLabel) {
    const svg = document.getElementById("glAreaChart");
    if (!svg) return;
    const W = 900, H = 200;
    const padL = 6, padR = 6, padT = 16, padB = 26;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = weeks.length;
    const maxCum = weeks[weeks.length - 1].cum;

    svg.setAttribute("aria-label",
      `Line chart of cumulative commits climbing from 0 to ${maxCum} over ${n} weeks.`);

    const xAt = i => padL + (innerW * i) / (n - 1);
    const yAt = v => padT + innerH - (v / maxCum) * innerH;

    let dLine = "";
    let dArea = `M ${xAt(0).toFixed(1)} ${yAt(0).toFixed(1)} `;
    weeks.forEach((w, i) => {
      const x = xAt(i), y = yAt(w.cum);
      dLine += (i === 0 ? "M " : "L ") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      dArea += "L " + x.toFixed(1) + " " + y.toFixed(1) + " ";
    });
    dArea += `L ${xAt(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${xAt(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;

    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: "gl-zero-baseline" }));
    svg.appendChild(el("path", { d: dArea, class: "gl-area-fill" }));
    svg.appendChild(el("path", { d: dLine, class: "gl-area-line" }));

    const maxWeekN = Math.max(...weeks.map(w => w.n));
    weeks.forEach((w, i) => {
      const x = xAt(i), y = yAt(w.cum);
      const isPeak = w.n === maxWeekN;
      const dot = el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 4, class: "gl-area-dot" + (isPeak ? " peak" : ""), tabindex: "0",
        "aria-label": `Cumulative through ${w.range}: ${w.cum} commits` });
      const tipHtml = () => `<b>${w.range}</b><br><span class="muted">total so far</span> ${w.cum}<br><span class="muted">+${w.n} this week</span>`;
      dot.addEventListener("mouseenter", e => showTooltip(e, tipHtml()));
      dot.addEventListener("mousemove", positionTooltip);
      dot.addEventListener("mouseleave", hideTooltip);
      dot.addEventListener("focus", e => showTooltip(e, tipHtml()));
      dot.addEventListener("blur", hideTooltip);
      svg.appendChild(dot);

      if (i === 0 || i === n - 1) {
        const t = el("text", { x: x.toFixed(1), y: H - padB + 16, class: "gl-axis-label",
          "text-anchor": i === 0 ? "start" : "end" });
        t.textContent = i === 0 ? startLabel : endLabel;
        svg.appendChild(t);
      }
    });
  }

  /* ---------------- Table view ---------------- */

  function renderTable(weeks) {
    const tableWrap = document.getElementById("glTableWrap");
    const maxWeekN = Math.max(...weeks.map(w => w.n));
    const rows = weeks.map(w =>
      `<tr${w.n === maxWeekN ? ' class="peak"' : ""}><td>${w.range}</td><td>${w.n}</td><td>${w.cum}</td></tr>`
    ).join("");
    tableWrap.innerHTML = `
      <table class="gl-data">
        <thead><tr><th>Week</th><th>Commits</th><th>Cumulative</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    const toggleBtn = document.getElementById("glTableToggle");
    toggleBtn.addEventListener("click", () => {
      const open = tableWrap.classList.toggle("open");
      toggleBtn.setAttribute("aria-expanded", String(open));
      toggleBtn.textContent = open ? "Hide table" : "View as table";
    });
  }

  /* ---------------- Prose (hero / velocity / footer) ---------------- */

  function renderProse(data) {
    const weeks = data.weeks;
    const peak = weeks.find(w => w.peak) || weeks[weeks.length - 1];
    const startMonth = MONTHS_FULL[Number(data.startDate.split("-")[1]) - 1];
    const genDate = new Date(data.generatedAt);
    const nowMonth = MONTHS_FULL[genDate.getMonth()];

    const heroWeeks = document.getElementById("glHeroWeeks");
    if (heroWeeks) heroWeeks.textContent = String(data.weeksBuilding);

    const velocity = document.getElementById("glVelocityText");
    if (velocity) {
      const span = startMonth === nowMonth ? startMonth : `${startMonth}–${nowMonth}`;
      velocity.textContent = `${data.weeksBuilding} weeks of commit activity, ${span}. The single week that outweighs the rest of the project combined: ${peak.range}${peak.note ? ` — ${peak.note}` : ""}.`;
    }

    const footer = document.getElementById("glFooterMeta");
    if (footer) {
      const synced = genDate.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      footer.textContent = `Compiled from local git history · ${data.commits} commits since ${fmtShort(data.startDate)} · synced ${synced} · refreshes automatically every weekend`;
    }
  }

  /* ---------------- Load + render ---------------- */

  fetch("/data/growth-ledger-stats.json", { cache: "no-store" })
    .then(res => { if (!res.ok) throw new Error(`status ${res.status}`); return res.json(); })
    .then(data => {
      renderStatRow(data);
      renderProse(data);
      renderTimeline(data.timeline);
      renderBarChart(data.weeks);
      const startLabel = fmtShort(data.startDate);
      const lastWeek = data.weeks[data.weeks.length - 1];
      const endLabel = `${lastWeek.range.split(" – ")[0]} · ${lastWeek.cum}`;
      renderAreaChart(data.weeks, startLabel, endLabel);
      renderTable(data.weeks);
    })
    .catch(err => {
      console.error("Growth Ledger: failed to load commit-history data", err);
      const statRow = document.getElementById("glStatRow");
      if (statRow) statRow.innerHTML = `<div class="gl-stat"><div class="gl-stat-label">Commit-history data unavailable (${err.message}). Run: node -e "require('./routes/growth-ledger-data').regenerate()"</div></div>`;
    });

})();
