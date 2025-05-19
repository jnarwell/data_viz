/*  Amphorae Dashboard logic
 *  -- fetch CSV → build UI → plot with Chart.js
 */

const SHEET_URL =
  "https://api.allorigins.win/raw?url=" +
  encodeURIComponent(
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
  );

let rawRows = [];
let chart;          // Chart.js instance
const colors = {};  // amphora->color map for consistency

// ───────────────────────────────────────────────────────────
// 1) Fetch + parse
// ───────────────────────────────────────────────────────────
async function loadData() {
  const res = await fetch(SHEET_URL);
  const csv = await res.text();

  rawRows = Papa.parse(csv, {
    header: true,
    dynamicTyping: true,
  }).data;

  buildUI();
  updatePlot();   // first draw
}

window.addEventListener("DOMContentLoaded", loadData);

// ───────────────────────────────────────────────────────────
// 2) Build amphora buttons for current test
// ───────────────────────────────────────────────────────────
function buildUI() {
  document
    .querySelectorAll(
      "#xAxis, #yAxis, input[name=mass], input[name=test], input[name=pattern]"
    )
    .forEach((el) => el.addEventListener("change", onControlChange));

  onControlChange(); // will populate amphorae list
}

function populateAmphoraeList() {
  const test = getTest();
  const patternFilter =
    test === "Stack" ? getPattern() : "all";

  const amphoraeSet = new Set();

  rawRows.forEach((row) => {
    const valid =
      row["Test"] === test &&
      (patternFilter === "all" || row["Pattern"] === patternFilter) &&
      row["Max Tensile (MPa)"] > 0;

    if (valid) amphoraeSet.add(row["Amphora"]);
  });

  const container = document.getElementById("amphoraeList");
  container.innerHTML = "";

  amphoraeSet.forEach((amp) => {
    // pick consistent random color
    if (!colors[amp]) {
      colors[amp] =
        "hsl(" + Math.floor(Math.random() * 360) + " 70% 50%)";
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-dark btn-sm amph-btn";
    btn.textContent = amp;
    btn.dataset.amphora = amp;

    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      updatePlot();
    });

    container.appendChild(btn);
  });
}

// ───────────────────────────────────────────────────────────
// 3) Handlers + helpers
// ───────────────────────────────────────────────────────────
function getXAxis() {
  return document.getElementById("xAxis").value;
}
function getYAxis() {
  return document.getElementById("yAxis").value;
}
function getMass() {
  return document.querySelector("input[name=mass]:checked").value;
}
function getTest() {
  return document.querySelector("input[name=test]:checked").value;
}
function getPattern() {
  return document.querySelector("input[name=pattern]:checked")?.value || "all";
}
function getSelectedAmphorae() {
  return Array.from(document.querySelectorAll(".amph-btn.active")).map(
    (b) => b.dataset.amphora
  );
}

// Toggle stack pattern UI visibility
function togglePatternUI() {
  const wrap = document.getElementById("stackPatternWrap");
  wrap.classList.toggle("d-none", getTest() !== "Stack");
}

// Called whenever any control changes
function onControlChange() {
  togglePatternUI();
  populateAmphoraeList(); // rebuild list when test or pattern changes
  updatePlot();
}

// ───────────────────────────────────────────────────────────
// 4) Chart drawing
// ───────────────────────────────────────────────────────────
function updatePlot() {
  if (!rawRows.length) return;

  const xKey = getXAxis();
  const yKey = getYAxis();
  const massKey = getMass();
  const test = getTest();
  const patternFilter =
    test === "Stack" ? getPattern() : "all";
  const selected = getSelectedAmphorae();

  // Build datasets
  const dataSets = [];

  selected.forEach((amp) => {
    const rows = rawRows.filter(
      (r) =>
        r["Amphora"] === amp &&
        r["Test"] === test &&
        (patternFilter === "all" || r["Pattern"] === patternFilter) &&
        r[yKey] > 0 &&
        r[xKey] > 0
    );

    if (!rows.length) return;

    const data = rows.map((r) => ({
      x: r[xKey],
      y: r[yKey],
      //  encode mass as bubble radius (~pixels)
      r:
        typeof r[massKey] === "number"
          ? Math.max(4, Math.sqrt(r[massKey]) * 4)
          : 6,
    }));

    dataSets.push({
      label: amp,
      data,
      backgroundColor: colors[amp],
      borderColor: colors[amp],
      showLine: false,
    });
  });

  // (Re)draw
  const ctx = document.getElementById("chartCanvas");

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "bubble",
    data: { datasets: dataSets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right" },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: (${ctx.raw.x}, ${ctx.raw.y}), mass ≈ ${(
                ctx.raw.r ** 2 /
                16
              ).toFixed(2)} kg`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: xKey },
          type: "linear",
        },
        y: {
          title: { display: true, text: yKey },
          type: "linear",
        },
      },
    },
  });
}
