// ─── DPS (DEPOSIT PENSION SCHEME) CALCULATOR ──────────────────────────────────
// Fixed monthly installment, fixed tenure, fixed annual rate.
// Interest compounds either monthly or yearly on the running balance
// (annuity-due convention: each period's deposits are added, then interest accrues).
// Optional AIT (source tax) deducted from interest earned, as Bangladeshi
// banks commonly withhold tax on DPS interest before crediting maturity value.

let state = {
  installment: 5000,
  tenureYears: 5,
  rate:        8,
  taxOn:       false,
  taxRate:     10,
};

const fmtBDT = n => '৳' + Math.round(n).toLocaleString('en-BD');

/**
 * Simulate month-by-month using the annuity-due convention: each month's
 * installment is deposited, then interest accrues that same month on the
 * running balance (matches standard bank DPS practice and the textbook
 * Future Value of Annuity Due formula).
 */
function simulate({ installment, tenureYears, rate, taxOn, taxRate }) {
  const totalMonths   = tenureYears * 12;
  const monthlyRate    = (rate / 100) / 12;

  let balance = 0;
  let cumulativeContrib = 0;
  let cumulativeInterestGross = 0;

  const yearly = [];
  let yearContrib = 0;
  let yearInterestGross = 0;

  for (let m = 1; m <= totalMonths; m++) {
    balance += installment;
    cumulativeContrib += installment;
    yearContrib += installment;

    const interest = balance * monthlyRate;
    balance += interest;
    cumulativeInterestGross += interest;
    yearInterestGross += interest;

    if (m % 12 === 0) {
      yearly.push({
        year: m / 12,
        contribThisYear: yearContrib,
        interestThisYear: yearInterestGross,
        cumulativeInterestGross,
        cumulativeContrib,
        balanceGross: balance,
      });
      yearContrib = 0;
      yearInterestGross = 0;
    }
  }

  // Apply tax on gross interest at maturity (simplified: applied to total interest,
  // not period-by-period, which matches how most banks present net maturity value)
  const taxAmount   = taxOn ? cumulativeInterestGross * (taxRate / 100) : 0;
  const netInterest = cumulativeInterestGross - taxAmount;
  const maturityValue = cumulativeContrib + netInterest;

  // Rescale yearly balances proportionally to reflect net-of-tax growth in the chart/table,
  // so the displayed trajectory ends exactly at the net maturity value.
  const netYearly = yearly.map(y => {
    const netInterestToDate = y.cumulativeInterestGross - (taxOn ? y.cumulativeInterestGross * (taxRate / 100) : 0);
    return {
      year: y.year,
      contribThisYear: y.contribThisYear,
      interestThisYear: taxOn ? y.interestThisYear * (1 - taxRate / 100) : y.interestThisYear,
      cumulativeInterest: netInterestToDate,
      cumulativeContrib: y.cumulativeContrib,
      balance: y.cumulativeContrib + netInterestToDate,
    };
  });

  return {
    totalDeposited: cumulativeContrib,
    grossInterest: cumulativeInterestGross,
    taxAmount,
    maturityValue,
    yearly: netYearly,
  };
}

// ─── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  const result = simulate(state);

  document.getElementById('dps-total-deposited').textContent = fmtBDT(result.totalDeposited);
  document.getElementById('dps-gross-interest').textContent  = fmtBDT(result.grossInterest);
  document.getElementById('dps-maturity-value').textContent  = fmtBDT(result.maturityValue);

  const taxCard = document.getElementById('dps-tax-card');
  const summaryRow = document.getElementById('dps-summary-row');
  if (state.taxOn) {
    taxCard.style.display = '';
    summaryRow.classList.add('calc-summary-row-4');
    document.getElementById('dps-tax-amount').textContent = '−' + fmtBDT(result.taxAmount);
  } else {
    taxCard.style.display = 'none';
    summaryRow.classList.remove('calc-summary-row-4');
  }

  renderChart(result.yearly);
  renderTable(result.yearly);
}

function renderChart(yearly) {
  const wrap   = document.getElementById('dps-bars-wrap');
  const labels = document.getElementById('dps-bars-labels');
  if (!yearly.length) { wrap.innerHTML = ''; labels.innerHTML = ''; return; }

  const maxBalance = Math.max(...yearly.map(y => y.balance), 1);

  wrap.innerHTML = yearly.map(y => {
    const contribH  = (y.cumulativeContrib / maxBalance) * 100;
    const interestH = (y.cumulativeInterest / maxBalance) * 100;
    return `
      <div class="calc-bar-col" title="Year ${y.year}: ${fmtBDT(y.balance)}">
        <div class="calc-bar-seg principal" style="height:${contribH}%"></div>
        <div class="calc-bar-seg interest" style="height:${interestH}%"></div>
      </div>
    `;
  }).join('');

  const step = yearly.length > 20 ? 5 : yearly.length > 10 ? 2 : 1;
  labels.innerHTML = yearly.map(y =>
    `<div class="calc-bar-label">${y.year % step === 0 || y.year === yearly.length ? y.year : ''}</div>`
  ).join('');
}

function renderTable(yearly) {
  const tbody = document.getElementById('dps-table-body');
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
function init() {
  // Installment: number input + slider, kept in sync
  const installmentInput  = document.getElementById('dps-installment');
  const installmentSlider = document.getElementById('dps-installment-slider');
  const updateInstallment = (val) => {
    const n = parseFloat(val);
    state.installment = isNaN(n) ? 0 : n;
    installmentInput.value = state.installment;
    installmentSlider.value = state.installment;
    render();
  };
  installmentInput.addEventListener('input', () => updateInstallment(installmentInput.value));
  installmentSlider.addEventListener('input', () => updateInstallment(installmentSlider.value));

  // Tenure: slider only, with a live label
  const tenureSlider  = document.getElementById('dps-tenure-slider');
  const tenureDisplay = document.getElementById('dps-tenure-display');
  tenureSlider.addEventListener('input', () => {
    state.tenureYears = parseInt(tenureSlider.value, 10);
    tenureDisplay.textContent = state.tenureYears + (state.tenureYears === 1 ? ' year' : ' years');
    render();
  });

  // Rate: number input + slider, kept in sync
  const rateInput  = document.getElementById('dps-rate');
  const rateSlider = document.getElementById('dps-rate-slider');
  const sliderMax  = parseFloat(rateSlider.max);
  const updateRate = (val) => {
    const n = parseFloat(val);
    state.rate = isNaN(n) ? 0 : n;
    rateInput.value = state.rate;
    rateSlider.value = Math.min(state.rate, sliderMax);
    render();
  };
  rateInput.addEventListener('input', () => updateRate(rateInput.value));
  rateSlider.addEventListener('input', () => updateRate(rateSlider.value));

  // Tax toggle
  const taxToggle = document.getElementById('dps-tax-toggle');
  const taxRateField = document.getElementById('dps-tax-rate-field');
  taxToggle.addEventListener('change', () => {
    state.taxOn = taxToggle.checked;
    taxRateField.style.display = state.taxOn ? '' : 'none';
    render();
  });

  const taxRateInput = document.getElementById('dps-tax-rate');
  taxRateInput.addEventListener('input', () => {
    const n = parseFloat(taxRateInput.value);
    state.taxRate = isNaN(n) ? 0 : n;
    render();
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);