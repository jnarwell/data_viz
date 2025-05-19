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
const cache  = {};      // { Stack: rows[], Hold: rows[], Drop: rows[] }
let   rawRows = [];     // rows for the currently-selected test
let   chart   = null;   // Chart.js instance
let lastTestLoaded = null;
const PALETTE = [
  "#1f77b4", "#ff7f0e", "#2ca02c",
  "#d62728", "#9467bd", "#8c564b",
  "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"
];
let colourIndex = 0;
const colors = {};        // amphora → colour

const AMPH_COL = (row) =>
  row.hasOwnProperty("Amphora")  ? "Amphora"  :
  row.hasOwnProperty("Amphorae") ? "Amphorae" :
  Object.keys(row).find((k) => k.toLowerCase().startsWith("amphora"));

/* -------------------------------------------------------------
   2.  Helpers: getters for control states
------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);

function getXAxis()    { return $("#xAxis").value; }
function getYAxis()    { return $("#yAxis").value; }
function getMass()     { return $("input[name=mass]:checked").value; }
function getTest()     { return $("input[name=test]:checked").value; }
function getPattern()  { return $("input[name=pattern]:checked")?.value || "all"; }
function getSelectedAmphorae() {
  return Array.from(document.querySelectorAll(".amph-btn.active"))
              .map((b) => b.dataset.amphora);
}

/* baseTest("Hold_wine") → "Hold"  */
const baseTest = (str) => (str || "").split(/[_(]/)[0].trim();

/* Build or rebuild a <select> */
function buildSelect(id, options, defVal) {
  const sel = $( `#${id}` );
  sel.innerHTML = "";
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  });
  sel.value = options.includes(defVal) ? defVal : options[0] || "";
}

/* Show / hide the pattern toggle for Stack */
function togglePatternUI() {
  $("#stackPatternWrap").classList.toggle("d-none", getTest() !== "Stack");
}

function effectiveY(row, yKey) {
  if (Number.isFinite(row[yKey]) && row[yKey] !== 0) return row[yKey];
  // Stack often has compression instead
  if (yKey === "Max Tensile (MPa)" && Number.isFinite(row["Max Compressive (MPa)"]))
    return row["Max Compressive (MPa)"];
  return null;
}

/* -------------------------------------------------------------
   3.  Fetch + cache rows for a given test
------------------------------------------------------------- */
async function fetchRows(test) {
  if (cache[test]) return cache[test];

  const res = await fetch(CSV_BY_TEST[test]);
  if (!res.ok) throw new Error(`${test} CSV → ${res.statusText}`);
  const csv = await res.text();

  let rows = Papa.parse(csv, {
    header: true,
    dynamicTyping: true,
    transformHeader: (h) => h.trim(),
    transform: (val/*, col*/) => {
        const cleaned = String(val).replace(/[, ]+/g, "");
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : val;
    }
  }).data;

  rows = rows.filter((r) =>
    Object.values(r).some((v) => v !== null && v !== "")
);

  cache[test] = rows;
  return rows;
}
const patternOf = (testStr = "") =>
  /\bhex\b/i.test(testStr)  ? "Hex"  :
  /\brect\b/i.test(testStr) ? "Rect" :
  "unknown";

/* -------------------------------------------------------------
   4.  UI builders
------------------------------------------------------------- */
function buildAxisSelectors() {
  const numericCols = Object.keys(rawRows[0] || {}).filter((col) =>
    rawRows.some((r) => Number.isFinite(r[col]) && r[col] !== 0)
  );

  buildSelect(
    "xAxis",
    numericCols,
    "Load (N)" 
  );
  buildSelect(
    "yAxis",
    numericCols,
    numericCols.includes("Max Tensile (MPa)")
      ? "Max Tensile (MPa)"
      : numericCols[1] || numericCols[0]
  );
}

function populateAmphoraeList() {
  const test          = getTest();
  const patternFilter = test === "Stack" ? getPattern() : "all";
  const yKey          = getYAxis();
  let dropPattern = 0, dropTest = 0, dropY = 0;

function rowPasses(r) {
  const patternOK = (patternFilter === "all") || (patternOf(r.Test) === patternFilter);
  const testOK    = baseTest(r.Test) === test;
  const yVal      = effectiveY(r, yKey);
  const yOK       = Number.isFinite(yVal);

  if (!patternOK) dropPattern++;
  else if (!testOK) dropTest++;
  else if (!yOK) dropY++;

  return patternOK && testOK && yOK;
}

  const amphoraeSet = new Set();

  rawRows.forEach((row) => {
    let hitCount = 0; 
    const valid = rowPasses(row);

    if (valid) hitCount++;
    if (valid) amphoraeSet.add(row[AMPH_COL(row)]);
    console.log(`🟢 populateAmphoraeList → ${hitCount} rows survived filter for`, test, patternFilter);
  });

  const container = document.getElementById("amphoraeList");
  container.innerHTML = "";

  [...amphoraeSet].forEach((amp, idx) => {
    if (!colors[amp]){
      colors[amp] = PALETTE[colourIndex % PALETTE.length];
    colourIndex++;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-dark btn-sm amph-btn";
    btn.dataset.amphora = amp;
    btn.textContent = amp;

    if (idx === 0) btn.classList.add("active");   // default-select first

    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      updatePlot();
    });
    container.appendChild(btn);
  });
  console.log(
  `🚫 dropped rows → pattern:${dropPattern}  test:${dropTest}  y:${dropY}`
);
["Select All", "Deselect All"].forEach((label) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-outline-secondary btn-sm amph-btn";
  btn.textContent = label;
  btn.style.fontWeight = "500";
  btn.style.marginTop = "0.25rem";

  btn.addEventListener("click", () => {
    const buttons = container.querySelectorAll(".amph-btn");
    buttons.forEach((b) => {
      if (b.textContent !== label) {
        if (label === "Select All") b.classList.add("active");
        else b.classList.remove("active");
      }
    });
    updatePlot();
  });

  container.appendChild(btn);
});
}


/* -------------------------------------------------------------
   5.  Chart drawing
------------------------------------------------------------- */
function updatePlot() {
  const xKey = getXAxis();
  const yKey = getYAxis();
  const massKey = getMass();
  const test = getTest();
  const patternFilter = test === "Stack" ? getPattern() : "all";
  const selected = getSelectedAmphorae();

  const datasets = [];

  selected.forEach((amp) => {
    const rows = rawRows.filter(
  (r) =>
    r[AMPH_COL(r)] === amp &&
    baseTest(r.Test) === test &&
    (patternFilter === "all" || patternOf(r.Test) === patternFilter) &&
    Number.isFinite(r[xKey])
);


    if (!rows.length) return;

    const data = rows.map((r) => ({
    x: r[xKey],
    y: effectiveY(r, yKey),
    r: 5,
  })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));


    datasets.push({
      label: amp,
      data,
      backgroundColor: colors[amp],
      borderColor: colors[amp],
      showLine: false,
    });
  });

  if (chart) chart.destroy();

  const ctx = $("#chartCanvas");
  chart = new Chart(ctx, {
    type: "bubble",
    data: { datasets },
    options: {
        maintainAspectRatio: false,
      responsive: true,
      plugins: {
        legend: { position: "right" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const approxMass = (ctx.raw.r ** 2) / 16;
              return `${ctx.dataset.label}: (${ctx.raw.x}, ${ctx.raw.y}), mass ≈ ${approxMass.toFixed(2)} kg`;
            },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: xKey }, type: "linear" },
        y: { title: { display: true, text: yKey }, type: "linear" },
      },
    },
  });
}

/* -------------------------------------------------------------
   6.  Main: set listeners & first render
------------------------------------------------------------- */
function attachListeners() {
  document
    .querySelectorAll(
      "#xAxis, #yAxis, input[name=mass], input[name=test], input[name=pattern]"
    )
    .forEach((el) => el.addEventListener("change", onControlChange));
}

async function onControlChange() {
  
    try {
    togglePatternUI();

    const test = getTest();

    /* load rows only if we switched tests */
    if (test !== lastTestLoaded) {
  rawRows = await fetchRows(test);
  console.log(`▶ ${test} CSV loaded →`, rawRows.length, "rows");   // ← add
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
  onControlChange();   // initial draw
});
