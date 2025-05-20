/* -------------------------------------------------------------
   0.  CONFIG  — put the real URLs for each sheet tab here
------------------------------------------------------------- */
const CSV_BY_TEST = {
  Stack: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv",
  Hold:  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=0&single=true&output=csv",
  Drop:  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=0&single=true&output=csv",
};

/* -------------------------------------------------------------
   1.  Globals
------------------------------------------------------------- */
const cache  = {};
let rawRows = [];
let chart = null;
let lastTestLoaded = null;
let colourIndex = 0;
const colors = {};
const amphoraeMemory = { Stack: new Set(), Hold: new Set(), Drop: new Set() };
const PALETTE = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"
];

/* -------------------------------------------------------------
   2.  Utilities
------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const getXAxis = () => $("#xAxis").value;
const getYAxis = () => $("#yAxis").value;
const getMass = () => $("input[name=mass]:checked").value;
const getTest = () => $("input[name=test]:checked").value;
const getPattern = () => $("input[name=pattern]:checked")?.value || "all";
const getSelectedAmphorae = () =>
  Array.from(document.querySelectorAll(".amph-btn.active")).map(b => b.dataset.amphora);

const baseTest = (str) => (str || "").split(/[_(]/)[0].trim();
const patternOf = (testStr = "") =>
  /\bhex\b/i.test(testStr) ? "Hex" :
  /\brect\b/i.test(testStr) ? "Rect" : "unknown";
const normalizeAmphora = (name = "") => name.replace(/_(rect|hex)$/, "");

const AMPH_COL = (row) =>
  row.hasOwnProperty("Amphora") ? "Amphora" :
  row.hasOwnProperty("Amphorae") ? "Amphorae" :
  Object.keys(row).find((k) => k.toLowerCase().startsWith("amphora"));

const getUnit = (label) => {
  if (label.includes("Material Volume")) return "m³";
  if (label.includes("Internal Volume")) return "L";
  if (label.includes("Mass") || label.includes("(kg)")) return "kg";
  if (label.includes("MPa")) return "MPa";
  if (label.includes("Load")) return "N";
  if (label.includes("(m)")) return "m";
  return "";
};

const convertValue = (value, label) => {
  if (!Number.isFinite(value)) return null;
  if (label.includes("Material Volume")) return value / 1e9;
  if (label.includes("Internal Volume")) return value / 1e6;
  return value;
};

const valStr = (v, label) => {
  const conv = convertValue(v, label);
  const unit = getUnit(label);
  if (!Number.isFinite(conv)) return "–";
  const abs = Math.abs(conv);
  const formatted = abs >= 1e5 || abs < 1e-2
    ? conv.toExponential(2)
    : conv.toFixed(2);
  return `${formatted} ${unit}`;
};

/* -------------------------------------------------------------
   3.  Axis + Pattern Logic
------------------------------------------------------------- */
function togglePatternUI() {
  $("#stackPatternWrap").classList.toggle("d-none", getTest() !== "Stack");
}

function effectiveX(row, xKey) {
  const test = row.Test?.toLowerCase() || "";
  const n = row["n (layers)"], w = row["w (# pot)"], l = row["l (# pot)"];

  if (xKey === "Mass") {
    if (test.includes("wine")) return row["Mass (Wine) (kg)"];
    if (test.includes("oil"))  return row["Mass (Oil) (kg)"];
    return row["Mass (Empty) (kg)"];
  }

  let base = row[xKey];
  if (!Number.isFinite(base)) return null;

  if (xKey.includes("Volume")) base = convertValue(base, xKey);
  const needsScaling = xKey.includes("Volume");
  return needsScaling && n && w && l ? base * n * w * l : base;
}


function effectiveY(row, yKey) {
  const test = row.Test?.toLowerCase() || "";
  const n = row["n (layers)"], w = row["w (# pot)"], l = row["l (# pot)"];

  if (yKey === "Mass") {
    if (test.includes("wine")) return row["Mass (Wine) (kg)"];
    if (test.includes("oil"))  return row["Mass (Oil) (kg)"];
    return row["Mass (Empty) (kg)"];
  }

  let base = row[yKey];
  if (!Number.isFinite(base)) return null;

  if (yKey.includes("Volume")) base = convertValue(base, yKey);
  const needsScaling = yKey.includes("Volume");
  return needsScaling && n && w && l ? base * n * w * l : base;
}


/* -------------------------------------------------------------
   4.  Build UI
------------------------------------------------------------- */
function buildSelect(id, options, defVal) {
  const sel = $(`#${id}`);
  sel.innerHTML = "";
  options.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  });
  sel.value = options.includes(defVal) ? defVal : options[0] || "";
}

function buildAxisSelectors() {
  const numericCols = Object.keys(rawRows[0] || {}).filter((col) =>
    rawRows.some((r) => Number.isFinite(r[col]) && r[col] !== 0)
  );
  buildSelect("xAxis", numericCols, "Load (N)");
  buildSelect("yAxis", numericCols, numericCols.includes("Max Tensile (MPa)") ? "Max Tensile (MPa)" : numericCols[1]);
}

function populateAmphoraeList() {
  const test = getTest();
  amphoraeMemory[test] = new Set(getSelectedAmphorae().map(normalizeAmphora));
  const patternFilter = test === "Stack" ? getPattern() : "all";
  const yKey = getYAxis();
  const amphoraeSet = new Set();

  rawRows.forEach(row => {
    if (baseTest(row.Test) !== test) return;
    if (patternFilter !== "all" && patternOf(row.Test) !== patternFilter) return;
    if (!Number.isFinite(effectiveY(row, yKey))) return;
    amphoraeSet.add(row[AMPH_COL(row)]);
  });

  const container = $("#amphoraeList");
  container.innerHTML = "";

  [...amphoraeSet].forEach(amp => {
    if (!colors[amp]) colors[amp] = PALETTE[colourIndex++ % PALETTE.length];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-dark btn-sm amph-btn";
    btn.dataset.amphora = amp;
    btn.textContent = amp;
    if (amphoraeMemory[test]?.has(normalizeAmphora(amp))) {
      btn.classList.add("active");
    }
    btn.onclick = () => {
      btn.classList.toggle("active");
      updatePlot();
    };
    container.appendChild(btn);
  });

  ["Select All", "Deselect All"].forEach(label => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-secondary btn-sm amph-btn";
    btn.textContent = label;
    btn.style.fontWeight = "500";
    btn.style.marginTop = "0.25rem";
    btn.onclick = () => {
      container.querySelectorAll(".amph-btn").forEach(b => {
        if (b.textContent !== label) {
          label === "Select All"
            ? b.classList.add("active")
            : b.classList.remove("active");
        }
      });
      updatePlot();
    };
    container.appendChild(btn);
  });
}

/* -------------------------------------------------------------
   5.  Data Load + Chart
------------------------------------------------------------- */
async function fetchRows(test) {
  if (cache[test]) return cache[test];
  const res = await fetch(CSV_BY_TEST[test]);
  if (!res.ok) throw new Error(`Failed to load ${test}`);
  const csv = await res.text();
  let rows = Papa.parse(csv, {
    header: true,
    dynamicTyping: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => {
      const cleaned = String(v).replace(/[, ]+/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : v;
    }
  }).data;
  rows = rows.filter(r => Object.values(r).some(v => v !== null && v !== ""));
  cache[test] = rows;
  return rows;
}

function updatePlot() {
  const xKey = getXAxis();
  const yKey = getYAxis();
  const selected = getSelectedAmphorae();
  const test = getTest();
  const patternFilter = test === "Stack" ? getPattern() : "all";

  const datasets = selected.map(amp => {
    const data = rawRows.filter(r =>
      r[AMPH_COL(r)] === amp &&
      baseTest(r.Test) === test &&
      (patternFilter === "all" || patternOf(r.Test) === patternFilter) &&
      Number.isFinite(r[xKey])
    ).map(r => ({
      x: effectiveX(r, xKey),
      y: effectiveY(r, yKey),
      r: 5,
      __rawRow: r
    })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (!data.length) return null;

    return {
      label: amp,
      data: data.sort((a, b) => a.x - b.x),
      backgroundColor: colors[amp],
      borderColor: colors[amp],
      pointRadius: 5,
      borderWidth: 1,
      tension: 0.2,
      fill: false,
      spanGaps: true
    };
  }).filter(Boolean);

  if (chart) chart.destroy();

  chart = new Chart($("#chartCanvas"), {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        legend: { position: "right" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const r = ctx.raw.__rawRow || {};
              const xVal = effectiveX(r, getXAxis());
              const yVal = effectiveY(r, getYAxis());
              const basis = getMass();
              const potMass = r["Mass (Empty) (kg)"];
              const fillMass = r[basis];
              const n = r["n (layers)"], w = r["w (# pot)"], l = r["l (# pot)"];
              const totalMass = (n && w && l && potMass && fillMass)
                ? (n * w * l * fillMass + potMass)
                : NaN;
              const x = valStr(xVal, getXAxis());
              const y = valStr(yVal, getYAxis());
              const absMass = Math.abs(totalMass);
              const massStr = Number.isFinite(totalMass)
                ? (absMass >= 1e5 || absMass < 1e-2
                    ? `${totalMass.toExponential(2)} kg`
                    : `${totalMass.toFixed(2)} kg`)
                : "";
              return `${ctx.dataset.label}: (${x}, ${y})` +
                     (massStr ? `, total mass ≈ ${massStr}` : "");
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: `${xKey.replace(/\s*\(.*?\)/, "")} (${getUnit(xKey)})`
          },
          type: "linear"
        },
        y: {
          title: {
            display: true,
            text: `${yKey.replace(/\s*\(.*?\)/, "")} (${getUnit(yKey)})`
          },
          type: "linear"
        }
      }
    }
  });
}

/* -------------------------------------------------------------
   6.  Main
------------------------------------------------------------- */
function attachListeners() {
  ["#xAxis", "#yAxis"].forEach(sel =>
    $(sel).addEventListener("change", updatePlot)
  );
  ["mass", "test", "pattern"].forEach(name =>
    document.querySelectorAll(`input[name=${name}]`)
      .forEach(el => el.addEventListener("change", onControlChange))
  );
}

async function onControlChange() {
  try {
    togglePatternUI();
    const test = getTest();
    if (test !== lastTestLoaded) {
      rawRows = await fetchRows(test);
      buildAxisSelectors();
      lastTestLoaded = test;
    }
    populateAmphoraeList();
    updatePlot();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  attachListeners();
  onControlChange();
});
