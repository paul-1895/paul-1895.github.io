// ─── COMPOUND INTEREST CALCULATOR ─────────────────────────────────────────────
// Supports: lump-sum principal + recurring monthly contribution,
// configurable compounding frequency, and start/end-of-period contribution timing.

let state = {
  principal:    100000,
  contribution: 0,
  rate:         10,     // annual %, nominal
  years:        10,
  freq:         1,      // compounding periods per year
  timing:       'end',  // 'end' | 'start'
};

const fmtBDT = n => '৳' + Math.round(n).toLocaleString('en-BD');

/**
 * Simulate year-by-year growth.
 * Contributions are monthly; interest compounds at `freq` periods/year.
 * For simplicity and clarity we step period-by-period (1/freq of a year),
 * applying contributions pro-rated to whichever periods they fall in,
 * then return both per-period and rolled-up per-year results.
 */
function simulate({ principal, contribution, rate, years, freq, timing }) {
  const periodsTotal     = years * freq;
  const ratePerPeriod    = (rate / 100) / freq;
  const monthsPerPeriod  = 12 / freq;
  const contribPerPeriod = contribution * monthsPerPeriod;

  let balance = principal;
  let cumulativeContrib = principal;
  let cumulativeInterest = 0;

  const yearly = []; // { year, contribThisYear, interestThisYear, cumulativeInterest, balance }
  let yearContrib = 0;
  let yearInterest = 0;

  for (let p = 1; p <= periodsTotal; p++) {
    if (timing === 'start') balance += contribPerPeriod;

    const interest = balance * ratePerPeriod;
    balance += interest;

    if (timing === 'end') balance += contribPerPeriod;

    cumulativeInterest += interest;
    cumulativeContrib  += contribPerPeriod;
    yearInterest += interest;
    yearContrib  += contribPerPeriod;

    if (p % freq === 0) {
      yearly.push({
        year: p / freq,
        contribThisYear: yearContrib,
        interestThisYear: yearInterest,
        cumulativeInterest,
        cumulativeContrib,
        balance,
      });
      yearContrib = 0;
      yearInterest = 0;
    }
  }

  return {
    futureValue: balance,
    totalInvested: cumulativeContrib,
    totalInterest: cumulativeInterest,
    yearly,
  };
}

// ─── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  const result = simulate(state);

  document.getElementById('ci-total-invested').textContent = fmtBDT(result.totalInvested);
  document.getElementById('ci-total-interest').textContent = fmtBDT(result.totalInterest);
  document.getElementById('ci-future-value').textContent   = fmtBDT(result.futureValue);

  renderChart(result.yearly);
  renderTable(result.yearly);
}

const MAX_CHART_BARS = 60;

// Group consecutive years into buckets so the chart never exceeds MAX_CHART_BARS
// columns, regardless of how long the time period is. Each bucket's balance/
// cumulative figures come from its last year; per-bucket contribution/interest
// are summed across the years it spans.
function bucketizeYearly(yearly, maxBars) {
  if (yearly.length <= maxBars) {
    return yearly.map(y => ({ ...y, yearStart: y.year, yearEnd: y.year }));
  }
  const bucketSize = Math.ceil(yearly.length / maxBars);
  const buckets = [];
  for (let i = 0; i < yearly.length; i += bucketSize) {
    const slice = yearly.slice(i, i + bucketSize);
    const last = slice[slice.length - 1];
    buckets.push({
      yearStart: slice[0].year,
      yearEnd: last.year,
      contribThisYear: slice.reduce((s, y) => s + y.contribThisYear, 0),
      interestThisYear: slice.reduce((s, y) => s + y.interestThisYear, 0),
      cumulativeContrib: last.cumulativeContrib,
      cumulativeInterest: last.cumulativeInterest,
      balance: last.balance,
    });
  }
  return buckets;
}

function renderChart(yearly) {
  const wrap   = document.getElementById('ci-bars-wrap');
  const labels = document.getElementById('ci-bars-labels');
  if (!yearly.length) { wrap.innerHTML = ''; labels.innerHTML = ''; return; }

  const buckets = bucketizeYearly(yearly, MAX_CHART_BARS);
  const maxBalance = Math.max(...buckets.map(b => b.balance), 1);

  wrap.innerHTML = buckets.map(b => {
    const contribH = (b.cumulativeContrib / maxBalance) * 100;
    const interestH = (b.cumulativeInterest / maxBalance) * 100;
    const rangeLabel = b.yearStart === b.yearEnd ? `Year ${b.yearStart}` : `Years ${b.yearStart}–${b.yearEnd}`;
    return `
      <div class="calc-bar-col" title="${rangeLabel}: ${fmtBDT(b.balance)}">
        <div class="calc-bar-seg principal" style="height:${contribH}%"></div>
        <div class="calc-bar-seg interest" style="height:${interestH}%"></div>
      </div>
    `;
  }).join('');

  // Thin out labels if there are many buckets, to avoid crowding
  const step = buckets.length > 30 ? 5 : buckets.length > 15 ? 2 : 1;
  labels.innerHTML = buckets.map((b, i) => {
    const show = i === 0 || i === buckets.length - 1 || (i + 1) % step === 0;
    return `<div class="calc-bar-label">${show ? b.yearEnd : ''}</div>`;
  }).join('');
}

function renderTable(yearly) {
  const tbody = document.getElementById('ci-table-body');
  if (!yearly.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">No data</td></tr>';
    return;
  }
  tbody.innerHTML = yearly.map(y => `
    <tr>
      <td>Year ${y.year}</td>
      <td>${fmtBDT(y.contribThisYear)}</td>
      <td class="ci-interest">${fmtBDT(y.interestThisYear)}</td>
      <td class="ci-interest">${fmtBDT(y.cumulativeInterest)}</td>
      <td>${fmtBDT(y.balance)}</td>
    </tr>
  `).join('');
}

// ─── INPUT WIRING ──────────────────────────────────────────────────────────────
function syncPair(inputId, sliderId, key, parser = parseFloat) {
  const input  = document.getElementById(inputId);
  const slider = document.getElementById(sliderId);

  const update = (val) => {
    const n = parser(val);
    state[key] = isNaN(n) ? 0 : n;
    input.value = state[key];
    slider.value = state[key];
    render();
  };

  input.addEventListener('input', () => update(input.value));
  slider.addEventListener('input', () => update(slider.value));
}

function init() {
  syncPair('ci-principal', 'ci-principal-slider', 'principal');
  syncPair('ci-contribution', 'ci-contribution-slider', 'contribution');

  const rateInput  = document.getElementById('ci-rate');
  const rateSlider = document.getElementById('ci-rate-slider');
  const sliderMax  = parseFloat(rateSlider.max);

  const updateRate = (val) => {
    const n = parseFloat(val);
    state.rate = isNaN(n) ? 0 : n;
    rateInput.value = state.rate;
    // Slider only covers up to its max; clamp display without altering the typed value.
    rateSlider.value = Math.min(state.rate, sliderMax);
    render();
  };
  rateInput.addEventListener('input', () => updateRate(rateInput.value));
  rateSlider.addEventListener('input', () => updateRate(rateSlider.value));

  const yearsInput  = document.getElementById('ci-years');
  const yearsSlider = document.getElementById('ci-years-slider');
  const yearsSliderMax = parseFloat(yearsSlider.max);

  const updateYears = (val) => {
    const n = Math.max(1, parseInt(val, 10));
    state.years = isNaN(n) ? 1 : n;
    yearsInput.value = state.years;
    // Slider only covers up to its max; clamp display without altering the typed value.
    yearsSlider.value = Math.min(state.years, yearsSliderMax);
    render();
  };
  yearsInput.addEventListener('input', () => updateYears(yearsInput.value));
  yearsSlider.addEventListener('input', () => updateYears(yearsSlider.value));

  document.querySelectorAll('.calc-toggle-btn[data-freq]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-toggle-btn[data-freq]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.freq = parseInt(btn.dataset.freq, 10);
      render();
    });
  });

  document.querySelectorAll('.calc-toggle-btn[data-timing]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.calc-toggle-btn[data-timing]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.timing = btn.dataset.timing;
      render();
    });
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);