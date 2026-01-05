// Forma Embedded View SDK: recommended auto-import pattern via esm.sh :contentReference[oaicite:2]{index=2}
import { Forma } from "https://esm.sh/forma-embedded-view-sdk@0.88.0/auto";

const $ = (id) => document.getElementById(id);

const btnRefresh = $("btnRefresh");
const btnAll = $("btnAll");
const btnResetRates = $("btnResetRates");
const statusEl = $("status");
const tbody = $("tbody");
const toggleSqft = $("toggleSqft");
const currencySel = $("currency");

const areaTotalEl = $("areaTotal");
const costTotalEl = $("costTotal");
const notesEl = $("notes");

const SQM_TO_SQFT = 10.763910416709722;

// Persist rates per function name
const STORAGE_KEY = "forma_cost_calc_rates_v1";
let rates = loadRates();

function loadRates() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveRates() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
}

function setStatus(text, kind = "muted") {
  statusEl.textContent = text;
  statusEl.classList.remove("ok", "warn", "err", "muted");
  statusEl.classList.add(kind);
}

function fmtNumber(x, decimals = 0) {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function fmtMoney(x) {
  if (!Number.isFinite(x)) return "—";
  const cur = currencySel.value || "$";
  return `${cur}${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function getRate(functionName) {
  const v = rates[functionName];
  return Number.isFinite(v) ? v : 0;
}

function setRate(functionName, value) {
  rates[functionName] = value;
  saveRates();
}

function unitLabel() {
  return toggleSqft.checked ? "ft²" : "m²";
}

function convertAreaFromSDK_m2(valueM2) {
  return toggleSqft.checked ? valueM2 * SQM_TO_SQFT : valueM2;
}

function rateLabel() {
  return toggleSqft.checked ? `${currencySel.value}/ft²` : `${currencySel.value}/m²`;
}

function renderRows(rows) {
  // rows: [{ functionName, area_m2 }]
  tbody.innerHTML = "";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No function breakdown returned for this selection.</td></tr>`;
    areaTotalEl.textContent = "—";
    costTotalEl.textContent = "—";
    notesEl.textContent = "—";
    return;
  }

  const areaTotal_m2 = rows.reduce((s, r) => s + (Number.isFinite(r.area_m2) ? r.area_m2 : 0), 0);
  const areaTotal = convertAreaFromSDK_m2(areaTotal_m2);

  let costTotal = 0;

  for (const r of rows) {
    const area = convertAreaFromSDK_m2(r.area_m2);
    const rate = getRate(r.functionName);
    const cost = area * rate;
    costTotal += cost;

    const tr = document.createElement("tr");

    const tdFn = document.createElement("td");
    tdFn.textContent = r.functionName;

    const tdArea = document.createElement("td");
    tdArea.className = "right";
    tdArea.textContent = `${fmtNumber(area, 0)} ${unitLabel()}`;

    const tdRate = document.createElement("td");
    tdRate.className = "right";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "1";
    inp.min = "0";
    inp.value = String(rate);
    inp.title = `Rate (${rateLabel()})`;
    inp.addEventListener("input", () => {
      const v = Number(inp.value);
      setRate(r.functionName, Number.isFinite(v) ? v : 0);
      // re-render to update costs live
      renderRows(rows);
    });
    tdRate.appendChild(inp);

    const tdCost = document.createElement("td");
    tdCost.className = "right";
    tdCost.textContent = fmtMoney(cost);

    tr.appendChild(tdFn);
    tr.appendChild(tdArea);
    tr.appendChild(tdRate);
    tr.appendChild(tdCost);

    tbody.appendChild(tr);
  }

  areaTotalEl.textContent = `${fmtNumber(areaTotal, 0)} ${unitLabel()}`;
  costTotalEl.textContent = fmtMoney(costTotal);
  notesEl.textContent = `Rates in ${rateLabel()}`;
}

async function getPathsFromSelection() {
  // Selection API usage pattern is documented in SDK examples :contentReference[oaicite:3]{index=3}
  // Some SDK versions expose selection as getSelection() returning { paths }
  // but the d.ts example also shows getSelection() directly. We'll support both.
  const sel = await Forma.selection.getSelection();
  if (Array.isArray(sel)) return sel;
  if (sel?.paths && Array.isArray(sel.paths)) return sel.paths;
  return [];
}

async function calculateFunctionBreakdown(pathsOrNull) {
  // Area metrics API: Forma.areaMetrics.calculate({ paths }) :contentReference[oaicite:4]{index=4}
  const payload = pathsOrNull && pathsOrNull.length ? { paths: pathsOrNull } : {};
  const areaMetrics = await Forma.areaMetrics.calculate(payload);

  // builtInMetrics.grossFloorArea.functionBreakdown[] includes functionName + value :contentReference[oaicite:5]{index=5}
  const fb = areaMetrics?.builtInMetrics?.grossFloorArea?.functionBreakdown || [];

  const rows = [];
  for (const item of fb) {
    const v = item?.value;
    if (typeof v === "number" && Number.isFinite(v)) {
      rows.push({ functionName: item.functionName || item.functionId || "Unknown", area_m2: v });
    }
  }

  // sort descending by area
  rows.sort((a, b) => (b.area_m2 || 0) - (a.area_m2 || 0));
  return rows;
}

async function refreshFromSelection() {
  setStatus("Reading selection…", "muted");
  btnRefresh.disabled = true;
  btnAll.disabled = true;

  try {
    const paths = await getPathsFromSelection();
    if (!paths.length) {
      setStatus("No selection. Select elements in the scene first.", "warn");
      renderRows([]);
      return;
    }

    setStatus(`Calculating area metrics for ${paths.length} selected item(s)…`, "muted");
    const rows = await calculateFunctionBreakdown(paths);
    renderRows(rows);
    setStatus("Done.", "ok");
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || String(e)}`, "err");
  } finally {
    btnRefresh.disabled = false;
    btnAll.disabled = false;
  }
}

async function refreshAll() {
  setStatus("Calculating area metrics for entire model…", "muted");
  btnRefresh.disabled = true;
  btnAll.disabled = true;

  try {
    const rows = await calculateFunctionBreakdown(null);
    renderRows(rows);
    setStatus("Done.", "ok");
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || String(e)}`, "err");
  } finally {
    btnRefresh.disabled = false;
    btnAll.disabled = false;
  }
}

function resetRates() {
  rates = {};
  saveRates();
  setStatus("Rates reset.", "ok");

  // Re-render current rows if we have them by simulating a refresh (cheap + safe)
  refreshFromSelection().catch(() => {});
}

// UI events
btnRefresh.addEventListener("click", refreshFromSelection);
btnAll.addEventListener("click", refreshAll);
btnResetRates.addEventListener("click", resetRates);

toggleSqft.addEventListener("change", () => refreshFromSelection().catch(() => {}));
currencySel.addEventListener("change", () => refreshFromSelection().catch(() => {}));

// Startup
setStatus("SDK loaded. Ready.", "ok");
