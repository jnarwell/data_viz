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

// Ranking table column configuration
const RANKING_COLUMNS = {
  overallRank: { label: "Overall Rank", group: "core", defaultSelected: true },
  holdRank: { label: "Hold Rank", group: "hold", defaultSelected: true },
  holdTensile: { label: "Hold Tensile", group: "hold", defaultSelected: false },
  dropRank: { label: "Drop Rank", group: "drop", defaultSelected: true },
  dropTensile: { label: "Drop Tensile", group: "drop", defaultSelected: false },
  rectRank: { label: "Rect Rank", group: "rect", defaultSelected: true },
  rectTensile: { label: "Rect Tensile", group: "rect", defaultSelected: false },
  rectLoad: { label: "Rect Load", group: "rect", defaultSelected: false },
  rectFoS: { label: "Rect FoS", group: "rect", defaultSelected: false },
  hexRank: { label: "Hex Rank", group: "hex", defaultSelected: true },
  hexTensile: { label: "Hex Tensile", group: "hex", defaultSelected: false },
  hexLoad: { label: "Hex Load", group: "hex", defaultSelected: false },
  hexFoS: { label: "Hex FoS", group: "hex", defaultSelected: false }
};

let selectedColumns = new Set();

/* -------------------------------------------------------------
   2.  Utilities
------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const getXAxis = () => $("#xAxis")?.value || "";
const getYAxis = () => $("#yAxis")?.value || "";
const getMass = () => $("input[name=mass]:checked")?.value || "Mass (Empty) (kg)";
const getTest = () => $("input[name=test]:checked")?.value || "Stack";
const getPattern = () => $("input[name=pattern]:checked")?.value || "all";
const getSelectedAmphorae = () =>
  Array.from(document.querySelectorAll(".amph-btn.active")).map(b => b.dataset.amphora);

const baseTest = (str) => {
  if (str === null || str === undefined) return "";
  return String(str).split(/[_(]/)[0].trim();
};

const patternOf = (testStr) => {
  if (testStr === null || testStr === undefined) testStr = "";
  testStr = String(testStr);
  return /\bhex\b/i.test(testStr) ? "Hex" :
         /\brect\b/i.test(testStr) ? "Rect" : "unknown";
};

const normalizeAmphora = (name) => {
  if (name === null || name === undefined) return "";
  return String(name).replace(/_(rect|hex)$/, "");
};

const AMPH_COL = (row) => {
  if (!row) return "";
  if (row.hasOwnProperty("Amphora")) return "Amphora";
  if (row.hasOwnProperty("Amphorae")) return "Amphorae";
  return Object.keys(row).find((k) => k.toLowerCase().startsWith("amphora")) || "";
};

const getUnit = (label) => {
  if (!label) return "";
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
  if (label && label.includes("Material Volume")) return value / 1e9;
  if (label && label.includes("Internal Volume")) return value / 1e6;
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

const getFillType = (testName) => {
  if (testName === null || testName === undefined) return "Empty";
  const test = String(testName).toLowerCase();
  if (test.includes("wine")) return "Wine";
  if (test.includes("oil")) return "Oil";
  return "Empty";
};

const getEffectiveMass = (row, fillType) => {
  if (!row) return 0;
  
  if (fillType === "Empty") {
    return row["Mass (Empty) (kg)"] || 0;
  } else if (fillType === "Wine") {
    const emptyMass = row["Mass (Empty) (kg)"] || 0;
    const wineMass = row["Mass (Wine) (kg)"] || 0;
    return emptyMass + wineMass;
  } else if (fillType === "Oil") {
    const emptyMass = row["Mass (Empty) (kg)"] || 0;
    const oilMass = row["Mass (Oil)"] || 0;
    return emptyMass + oilMass;
  }
  return 0;
};

/* -------------------------------------------------------------
   3.  Ranking Column Controls
------------------------------------------------------------- */
function initializeSelectedColumns() {
  selectedColumns.clear();
  Object.entries(RANKING_COLUMNS).forEach(([key, config]) => {
    if (config.defaultSelected) {
      selectedColumns.add(key);
    }
  });
}

function buildColumnControls() {
  const container = document.getElementById("columnControls");
  if (!container) return;
  
  container.innerHTML = "";
  
  Object.entries(RANKING_COLUMNS).forEach(([key, config]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm btn-outline-primary column-toggle-btn";
    btn.dataset.column = key;
    btn.textContent = config.label;
    
    if (selectedColumns.has(key)) {
      btn.classList.add("active");
    }
    
    btn.addEventListener("click", function() {
      this.classList.toggle("active");
      if (this.classList.contains("active")) {
        selectedColumns.add(key);
      } else {
        selectedColumns.delete(key);
      }
      updateColumnControlButtons();
      displayRankingTable();
    });
    
    container.appendChild(btn);
  });
}

function attachColumnControlListeners() {
  // Test type control buttons
  document.querySelectorAll(".test-control-btn").forEach(btn => {
    btn.addEventListener("click", function() {
      const testType = this.dataset.test;
      const isCurrentlyActive = this.classList.contains("active");
      
      // Define column groups for each test type
      const testTypeColumns = {
        rankings: ["holdRank", "dropRank", "rectRank", "hexRank"],
        hold: ["holdRank", "holdTensile"],
        drop: ["dropRank", "dropTensile"],
        rect: ["rectRank", "rectTensile", "rectLoad", "rectFoS"],
        hex: ["hexRank", "hexTensile", "hexLoad", "hexFoS"]
      };
      
      if (isCurrentlyActive) {
        // If clicking the active button, deselect its columns
        this.classList.remove("active");
        testTypeColumns[testType].forEach(col => {
          selectedColumns.delete(col);
        });
      } else {
        // Activate this button and add its columns
        this.classList.add("active");
        
        // Always ensure overall rank is selected
        selectedColumns.add("overallRank");
        
        // Add columns for this test type
        testTypeColumns[testType].forEach(col => {
          selectedColumns.add(col);
        });
      }
      
      // Update UI and table
      updateColumnControlButtons();
      displayRankingTable();
    });
  });
  
  // Select All/Deselect All buttons
  document.getElementById("selectAllColumns")?.addEventListener("click", function() {
    selectedColumns.clear();
    Object.keys(RANKING_COLUMNS).forEach(key => selectedColumns.add(key));
    updateColumnControlButtons();
    displayRankingTable();
  });
  
  document.getElementById("deselectAllColumns")?.addEventListener("click", function() {
    selectedColumns.clear();
    selectedColumns.add("overallRank"); // Always keep overall rank
    updateColumnControlButtons();
    displayRankingTable();
  });
}

function updateColumnControlButtons() {
  // Update individual column toggle buttons
  document.querySelectorAll(".column-toggle-btn").forEach(btn => {
    const key = btn.dataset.column;
    if (selectedColumns.has(key)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  
  // Update quick control buttons based on current selection
  const testTypeColumns = {
    rankings: ["holdRank", "dropRank", "rectRank", "hexRank"],
    hold: ["holdRank", "holdTensile"],
    drop: ["dropRank", "dropTensile"],
    rect: ["rectRank", "rectTensile", "rectLoad", "rectFoS"],
    hex: ["hexRank", "hexTensile", "hexLoad", "hexFoS"]
  };
  
  document.querySelectorAll(".test-control-btn").forEach(btn => {
    const testType = btn.dataset.test;
    const requiredColumns = testTypeColumns[testType];
    
    // Check if ALL columns for this test type are selected
    const allSelected = requiredColumns.every(col => selectedColumns.has(col));
    
    if (allSelected) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

/* -------------------------------------------------------------
   4.  Axis + Pattern Logic
------------------------------------------------------------- */
function toggleUIControls() {
  const test = getTest();
  const isRanking = test === "Ranking";
  
  // Show/hide stack pattern UI
  const stackPatternWrap = document.getElementById("stackPatternWrap");
  if (stackPatternWrap) {
    stackPatternWrap.classList.toggle("d-none", test !== "Stack");
  }
  
  // Show/hide ranking controls
  const rankingControlsCard = document.getElementById("rankingControlsCard");
  if (rankingControlsCard) {
    rankingControlsCard.classList.toggle("d-none", !isRanking);
  }
  
  // Show/hide mass toggle based on test
  const massGroup = document.getElementById("massGroup");
  if (massGroup) {
    const massCard = massGroup.closest(".card");
    if (massCard) {
      massCard.classList.toggle("d-none", test === "Hold" || isRanking);
    }
  }
  
  // Show/hide axis selectors based on ranking mode
  const xAxis = document.getElementById("xAxis");
  if (xAxis) {
    const axisCard = xAxis.closest(".card");
    if (axisCard) {
      axisCard.classList.toggle("d-none", isRanking);
    }
  }
  
  // Toggle between chart and table views
  const chartCanvas = document.getElementById("chartCanvas");
  const rankingTable = document.getElementById("rankingTable");
  
  if (chartCanvas) chartCanvas.classList.toggle("d-none", isRanking);
  if (rankingTable) rankingTable.classList.toggle("d-none", !isRanking);
}

function effectiveX(row, xKey) {
  if (xKey === "Mass") {
    const test = baseTest(row?.Test || "");
    if (test === "Hold") {
      const fillType = getFillType(row?.Test);
      return getEffectiveMass(row, fillType);
    } else {
      const fillType = getMass() === "Mass (Wine) (kg)" ? "Wine" : 
                      (getMass() === "Mass (Oil)" || getMass() === "Mass (Oil) (kg)") ? "Oil" : "Empty";
      
      const massPerPot = getEffectiveMass(row, fillType);
      
      if (test === "Stack") {
        const n = row["n (layers)"];
        const w = row["w (# pot)"];
        const l = row["l (# pot)"];
        
        if (Number.isFinite(n) && Number.isFinite(w) && Number.isFinite(l) && Number.isFinite(massPerPot)) {
          return massPerPot * n * w * l;
        }
      }
      
      return massPerPot;
    }
  }

  if (baseTest(row?.Test || "") === "Hold" && xKey?.includes("Mass")) {
    const fillType = getFillType(row?.Test);
    return getEffectiveMass(row, fillType);
  }

  const test = baseTest(row?.Test || "");
  if (test === "Stack" && xKey?.includes("Mass")) {
    let massPerPot;
    if (xKey === "Mass (Wine) (kg)") {
      massPerPot = getEffectiveMass(row, "Wine");
    } else if (xKey === "Mass (Oil) (kg)" || xKey === "Mass (Oil)") {
      massPerPot = getEffectiveMass(row, "Oil");
    } else {
      massPerPot = row?.[xKey] || 0;
    }
    
    const n = row["n (layers)"];
    const w = row["w (# pot)"];
    const l = row["l (# pot)"];
    
    if (Number.isFinite(n) && Number.isFinite(w) && Number.isFinite(l) && Number.isFinite(massPerPot)) {
      return massPerPot * n * w * l;
    }
    
    return massPerPot;
  }

  if (xKey?.includes("Mass")) {
    const massBasis = getMass();
    
    if (massBasis === "Mass (Wine) (kg)") {
      return getEffectiveMass(row, "Wine");
    } else if (massBasis === "Mass (Oil) (kg)" || massBasis === "Mass (Oil)") {
      return getEffectiveMass(row, "Oil");
    }
    return row?.[massBasis] || 0;
  }

  const n = row["n (layers)"], w = row["w (# pot)"], l = row["l (# pot)"];

  let base = row?.[xKey];
  if (!Number.isFinite(base)) return null;

  if (xKey?.includes("Volume")) base = convertValue(base, xKey);
  const needsScaling = xKey?.includes("Volume");
  return needsScaling && n && w && l ? base * n * w * l : base;
}

function effectiveY(row, yKey) {
  if (yKey === "Mass") {
    const test = baseTest(row?.Test || "");
    if (test === "Hold") {
      const fillType = getFillType(row?.Test);
      return getEffectiveMass(row, fillType);
    } else {
      const fillType = getMass() === "Mass (Wine) (kg)" ? "Wine" : 
                      (getMass() === "Mass (Oil)" || getMass() === "Mass (Oil) (kg)") ? "Oil" : "Empty";
      
      const massPerPot = getEffectiveMass(row, fillType);
      
      if (test === "Stack") {
        const n = row["n (layers)"];
        const w = row["w (# pot)"];
        const l = row["l (# pot)"];
        
        if (Number.isFinite(n) && Number.isFinite(w) && Number.isFinite(l) && Number.isFinite(massPerPot)) {
          return massPerPot * n * w * l;
        }
      }
      
      return massPerPot;
    }
  }

  if (baseTest(row?.Test || "") === "Hold" && yKey?.includes("Mass")) {
    const fillType = getFillType(row?.Test);
    return getEffectiveMass(row, fillType);
  }

  const test = baseTest(row?.Test || "");
  if (test === "Stack" && yKey?.includes("Mass")) {
    let massPerPot;
    if (yKey === "Mass (Wine) (kg)") {
      massPerPot = getEffectiveMass(row, "Wine");
    } else if (yKey === "Mass (Oil) (kg)" || yKey === "Mass (Oil)") {
      massPerPot = getEffectiveMass(row, "Oil");
    } else {
      massPerPot = row?.[yKey] || 0;
    }
    
    const n = row["n (layers)"];
    const w = row["w (# pot)"];
    const l = row["l (# pot)"];
    
    if (Number.isFinite(n) && Number.isFinite(w) && Number.isFinite(l) && Number.isFinite(massPerPot)) {
      return massPerPot * n * w * l;
    }
    
    return massPerPot;
  }

  if (yKey?.includes("Mass")) {
    const massBasis = getMass();
    
    if (massBasis === "Mass (Wine) (kg)") {
      return getEffectiveMass(row, "Wine");
    } else if (massBasis === "Mass (Oil) (kg)" || massBasis === "Mass (Oil)") {
      return getEffectiveMass(row, "Oil");
    }
    return row?.[massBasis] || 0;
  }

  const n = row["n (layers)"], w = row["w (# pot)"], l = row["l (# pot)"];

  let base = row?.[yKey];
  if (!Number.isFinite(base)) return null;

  if (yKey?.includes("Volume")) base = convertValue(base, yKey);
  const needsScaling = yKey?.includes("Volume");
  return needsScaling && n && w && l ? base * n * w * l : base;
}

/* -------------------------------------------------------------
   5.  Build UI
------------------------------------------------------------- */
function buildSelect(id, options, defVal) {
  const sel = document.getElementById(id);
  if (!sel) return;
  
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
  const allCols = Object.keys(rawRows[0] || {}).filter((col) =>
    rawRows.some((r) => Number.isFinite(r[col]) && r[col] !== 0)
  );
  
  const massRegex = /^Mass\s*\((Empty|Wine|Oil)\)(\s*\(kg\))?$/;
  const filteredCols = allCols.filter(col => !massRegex.test(col));
  
  const xAxisPriority = [
    "Load (N)",
    "Mass",
    "Height (m)"
  ];
  
  const yAxisPriority = [
    "Max Tensile (MPa)",
    "Max Compressive (MPa)",
    "Factor of Safety"
  ];
  
  let xAxisCols = [...xAxisPriority];
  let yAxisCols = [...yAxisPriority];
  
  if (!xAxisCols.includes("Mass") && allCols.some(col => massRegex.test(col))) {
    xAxisCols.push("Mass");
  }
  
  filteredCols.forEach(col => {
    if (!xAxisCols.includes(col)) {
      xAxisCols.push(col);
    }
    if (!yAxisCols.includes(col)) {
      yAxisCols.push(col);
    }
  });
  
  xAxisCols = xAxisCols.filter(col => col === "Mass" || filteredCols.includes(col));
  yAxisCols = yAxisCols.filter(col => col === "Mass" || filteredCols.includes(col));
  
  const currentTest = getTest();
  let defaultXAxis = "Load (N)";
  
  if (currentTest === "Drop") {
    defaultXAxis = "Height (m)";
  } else if (currentTest === "Hold") {
    defaultXAxis = xAxisCols.includes("Mass") ? "Mass" : "Load (N)";
  }
  
  if (!xAxisCols.includes(defaultXAxis)) {
    defaultXAxis = xAxisCols[0];
  }
  
  let defaultYAxis = "Max Tensile (MPa)";
  if (!yAxisCols.includes(defaultYAxis)) {
    defaultYAxis = yAxisCols[0];
  }
  
  buildSelect("xAxis", xAxisCols, defaultXAxis);
  buildSelect("yAxis", yAxisCols, defaultYAxis);
}

/* -------------------------------------------------------------
   6.  Rankings Table Functions 
------------------------------------------------------------- */
function calculateRankings() {
  const selected = getSelectedAmphorae();
  if (!selected || !selected.length) return [];
  
  const completeAmphorae = selected.filter(amphora => {
    if (!amphora) return false;
    const normalizedName = normalizeAmphora(amphora);
    
    const hasRectData = rawRows.some(r => 
      baseTest(r.Test) === "Stack" && 
      patternOf(r.Test) === "Rect" &&
      normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
      Number.isFinite(r["Max Tensile (MPa)"])
    );
    
    const hasHexData = rawRows.some(r => 
      baseTest(r.Test) === "Stack" && 
      patternOf(r.Test) === "Hex" &&
      normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
      Number.isFinite(r["Max Tensile (MPa)"])
    );
    
    const hasHoldData = rawRows.some(r => 
      baseTest(r.Test) === "Hold" && 
      normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
      Number.isFinite(r["Max Tensile (MPa)"])
    );
    
    const hasDropData = rawRows.some(r => 
      baseTest(r.Test) === "Drop" && 
      normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
      Number.isFinite(r["Max Tensile (MPa)"])
    );
    
    return hasRectData && hasHexData && hasHoldData && hasDropData;
  });
  
  if (completeAmphorae.length === 0) {
    return [];
  }
  
  const stackRows = rawRows.filter(r => baseTest(r.Test) === "Stack");
  const rectRows = stackRows.filter(r => patternOf(r.Test) === "Rect");
  const hexRows = stackRows.filter(r => patternOf(r.Test) === "Hex");
  
  const selectedRectRows = rectRows.filter(r => {
    const ampName = r[AMPH_COL(r)];
    if (!ampName) return false;
    const normalizedName = normalizeAmphora(ampName);
    return completeAmphorae.some(a => a === ampName || normalizeAmphora(a) === normalizedName);
  });
  
  const selectedHexRows = hexRows.filter(r => {
    const ampName = r[AMPH_COL(r)];
    if (!ampName) return false;
    const normalizedName = normalizeAmphora(ampName);
    return completeAmphorae.some(a => a === ampName || normalizeAmphora(a) === normalizedName);
  });
  
  const safeRectRows = selectedRectRows.filter(r => (r["Factor of Safety"] || 0) >= 1);
  const safeHexRows = selectedHexRows.filter(r => (r["Factor of Safety"] || 0) >= 1);
  
  function findReferenceLoad(rows) {
    const amphoraeClosestFoS = {};
    
    rows.forEach(row => {
      const amp = normalizeAmphora(row[AMPH_COL(row)]);
      const fos = row["Factor of Safety"] || 0;
      const load = row["Load (N)"] || 0;
      
      if (fos <= 0 || load <= 0) return;
      
      const diffFromFoS1 = Math.abs(fos - 1);
      
      if (!amphoraeClosestFoS[amp] || diffFromFoS1 < amphoraeClosestFoS[amp].diffFromFoS1) {
        amphoraeClosestFoS[amp] = { load, fos, diffFromFoS1 };
      }
    });
    
    let maxLoad = 0;
    Object.values(amphoraeClosestFoS).forEach(point => {
      if (point.load > maxLoad) {
        maxLoad = point.load;
      }
    });
    
    return maxLoad;
  }
  
  let refRectLoad = findReferenceLoad(safeRectRows);
  let refHexLoad = findReferenceLoad(safeHexRows);
  
  if (refRectLoad === 0) {
    refRectLoad = Math.max(...selectedRectRows.map(r => r["Load (N)"] || 0).filter(v => v > 0), 0);
  }
  
  if (refHexLoad === 0) {
    refHexLoad = Math.max(...selectedHexRows.map(r => r["Load (N)"] || 0).filter(v => v > 0), 0);
  }
  
  const amphoraeData = {};
  completeAmphorae.forEach(amp => {
    const normalizedName = normalizeAmphora(amp);
    amphoraeData[normalizedName] = {
      name: amp,
      rectLoad: 0,
      rectFoS: 0,
      rectTensile: 0,
      hexLoad: 0,
      hexFoS: 0,
      hexTensile: 0,
      holdTensileValues: [],
      holdTensile: 0,
      dropTensileValues: [],
      dropTensile: 0,
      volume: 0,
      rectRank: 0,
      hexRank: 0,
      holdRank: 0,
      dropRank: 0,
      overallScore: 0,
      overallRank: 0
    };
  });
  
  function findClosestToRef(rows, refLoad, ampName) {
    let closestRow = null;
    let minDiff = Infinity;
    
    rows.forEach(row => {
      const amp = normalizeAmphora(row[AMPH_COL(row)]);
      if (amp !== ampName) return;
      
      const load = row["Load (N)"] || 0;
      if (load <= 0) return;
      
      const diff = Math.abs(load - refLoad);
      if (diff < minDiff) {
        minDiff = diff;
        closestRow = row;
      }
    });
    
    return closestRow;
  }
  
  completeAmphorae.forEach(amp => {
    const normalizedName = normalizeAmphora(amp);
    
    const rectRow = findClosestToRef(rectRows, refRectLoad, normalizedName);
    if (rectRow) {
      amphoraeData[normalizedName].rectLoad = rectRow["Load (N)"] || 0;
      amphoraeData[normalizedName].rectFoS = rectRow["Factor of Safety"] || 0;
      amphoraeData[normalizedName].rectTensile = rectRow["Max Tensile (MPa)"] || 0;
      amphoraeData[normalizedName].volume = (rectRow["Internal Volume (mm^3)"] || 0) / 1e6;
    }
    
    const hexRow = findClosestToRef(hexRows, refHexLoad, normalizedName);
    if (hexRow) {
      amphoraeData[normalizedName].hexLoad = hexRow["Load (N)"] || 0;
      amphoraeData[normalizedName].hexFoS = hexRow["Factor of Safety"] || 0;
      amphoraeData[normalizedName].hexTensile = hexRow["Max Tensile (MPa)"] || 0;
    }
  });
  
  const holdRows = rawRows.filter(r => baseTest(r.Test) === "Hold");
  holdRows.forEach(row => {
    const amp = normalizeAmphora(row[AMPH_COL(row)]);
    if (!amphoraeData[amp]) return;
    
    const tensile = row["Max Tensile (MPa)"] || 0;
    if (tensile <= 0) return;
    
    amphoraeData[amp].holdTensileValues.push(tensile);
  });
  
  Object.values(amphoraeData).forEach(amp => {
    if (amp.holdTensileValues.length > 0) {
      const sum = amp.holdTensileValues.reduce((a, b) => a + b, 0);
      amp.holdTensile = sum / amp.holdTensileValues.length;
    }
  });
  
  const dropRows = rawRows.filter(r => baseTest(r.Test) === "Drop");
  dropRows.forEach(row => {
    const amp = normalizeAmphora(row[AMPH_COL(row)]);
    if (!amphoraeData[amp]) return;
    
    const tensile = row["Max Tensile (MPa)"] || 0;
    if (tensile <= 0) return;
    
    amphoraeData[amp].dropTensileValues.push(tensile);
  });
  
  Object.values(amphoraeData).forEach(amp => {
    if (amp.dropTensileValues.length > 0) {
      const sum = amp.dropTensileValues.reduce((a, b) => a + b, 0);
      amp.dropTensile = sum / amp.dropTensileValues.length;
    }
  });
  
  let results = Object.values(amphoraeData);
  
  results = results.filter(amp => 
    amp.rectTensile > 0 && 
    amp.hexTensile > 0 && 
    amp.holdTensile > 0 && 
    amp.dropTensile > 0
  );
  
  if (results.length === 0) {
    return [];
  }
  
  results.sort((a, b) => a.rectTensile - b.rectTensile);
  results.forEach((amp, i) => { amp.rectRank = i + 1; });
  
  results.sort((a, b) => a.hexTensile - b.hexTensile);
  results.forEach((amp, i) => { amp.hexRank = i + 1; });
  
  results.sort((a, b) => a.holdTensile - b.holdTensile);
  results.forEach((amp, i) => { amp.holdRank = i + 1; });
  
  results.sort((a, b) => a.dropTensile - b.dropTensile);
  results.forEach((amp, i) => { amp.dropRank = i + 1; });
  
  results.forEach(amp => {
    amp.overallScore = amp.rectRank + amp.hexRank + amp.holdRank + amp.dropRank;
  });
  
  results.sort((a, b) => a.overallScore - b.overallScore);
  results.forEach((amp, i) => { amp.overallRank = i + 1; });
  
  return results;
}

function displayRankingTable() {
  const rankings = calculateRankings();
  const tableEl = document.getElementById("rankingTable");
  
  if (!tableEl) {
    console.error("Ranking table element not found");
    return;
  }
  
  const selected = getSelectedAmphorae();
  const missingAmphorae = selected.filter(amp => 
    !rankings.some(r => r.name === amp)
  );
  
  if (!rankings.length) {
    tableEl.innerHTML = `
      <div class="alert alert-info">
        <strong>No complete data available.</strong><br>
        Please select at least one amphora with complete test data.
      </div>`;
    return;
  }
  
  const safeFormat = (value) => {
    if (value === undefined || value === null || isNaN(value) || value === 0) {
      return "–";
    }
    return Number(value).toFixed(2);
  };
  
  let html = '';
  
  if (missingAmphorae.length > 0 && missingAmphorae.some(amp => amp && amp.trim())) {
    html += `
      <div class="alert alert-warning mb-3">
        <strong>Data Availability Notice:</strong><br>
        The following selected amphorae do not appear in rankings due to incomplete data: 
        <strong>${missingAmphorae.join(", ")}</strong><br>
        Amphorae must have data for all test types (Stack in both Rect and Hex arrangements, Hold, and Drop) to be included.
      </div>
    `;
  }
  
  // Build table headers based on selected columns
  html += `<table class="table table-striped table-hover"><thead>`;
  
  // First header row
  html += `<tr>`;
  if (selectedColumns.has("overallRank")) {
    html += `<th rowspan="2">Overall<br>Rank</th>`;
  }
  html += `<th rowspan="2">Amphora</th>`;
  
  // Group headers
  const hasHoldColumns = selectedColumns.has("holdRank") || selectedColumns.has("holdTensile");
  const hasDropColumns = selectedColumns.has("dropRank") || selectedColumns.has("dropTensile");
  const hasRectColumns = selectedColumns.has("rectRank") || selectedColumns.has("rectTensile") || 
                        selectedColumns.has("rectLoad") || selectedColumns.has("rectFoS");
  const hasHexColumns = selectedColumns.has("hexRank") || selectedColumns.has("hexTensile") || 
                       selectedColumns.has("hexLoad") || selectedColumns.has("hexFoS");
  
  if (hasHoldColumns) {
    const holdColCount = (selectedColumns.has("holdRank") ? 1 : 0) + 
                        (selectedColumns.has("holdTensile") ? 1 : 0);
    html += `<th colspan="${holdColCount}">Hold</th>`;
  }
  
  if (hasDropColumns) {
    const dropColCount = (selectedColumns.has("dropRank") ? 1 : 0) + 
                        (selectedColumns.has("dropTensile") ? 1 : 0);
    html += `<th colspan="${dropColCount}">Drop</th>`;
  }
  
  if (hasRectColumns) {
    const rectColCount = (selectedColumns.has("rectRank") ? 1 : 0) + 
                        (selectedColumns.has("rectTensile") ? 1 : 0) +
                        (selectedColumns.has("rectLoad") ? 1 : 0) +
                        (selectedColumns.has("rectFoS") ? 1 : 0);
    html += `<th colspan="${rectColCount}">Rect Stack</th>`;
  }
  
  if (hasHexColumns) {
    const hexColCount = (selectedColumns.has("hexRank") ? 1 : 0) + 
                       (selectedColumns.has("hexTensile") ? 1 : 0) +
                       (selectedColumns.has("hexLoad") ? 1 : 0) +
                       (selectedColumns.has("hexFoS") ? 1 : 0);
    html += `<th colspan="${hexColCount}">Hex Stack</th>`;
  }
  
  html += `</tr>`;
  
  // Second header row
  html += `<tr>`;
  if (selectedColumns.has("holdRank")) html += `<th>Rank</th>`;
  if (selectedColumns.has("holdTensile")) html += `<th>Tensile (MPa)</th>`;
  if (selectedColumns.has("dropRank")) html += `<th>Rank</th>`;
  if (selectedColumns.has("dropTensile")) html += `<th>Tensile (MPa)</th>`;
  if (selectedColumns.has("rectRank")) html += `<th>Rank</th>`;
  if (selectedColumns.has("rectTensile")) html += `<th>Tensile (MPa)</th>`;
  if (selectedColumns.has("rectLoad")) html += `<th>Load (N)</th>`;
  if (selectedColumns.has("rectFoS")) html += `<th>FoS</th>`;
  if (selectedColumns.has("hexRank")) html += `<th>Rank</th>`;
  if (selectedColumns.has("hexTensile")) html += `<th>Tensile (MPa)</th>`;
  if (selectedColumns.has("hexLoad")) html += `<th>Load (N)</th>`;
  if (selectedColumns.has("hexFoS")) html += `<th>FoS</th>`;
  html += `</tr></thead><tbody>`;
  
  // Table rows
  rankings.forEach((amp) => {
    html += `<tr>`;
    if (selectedColumns.has("overallRank")) {
      html += `<td><strong>${amp.overallRank || '–'}</strong></td>`;
    }
    html += `<td>${amp.name || '–'}</td>`;
    if (selectedColumns.has("holdRank")) html += `<td>${amp.holdRank ? '#' + amp.holdRank : '–'}</td>`;
    if (selectedColumns.has("holdTensile")) html += `<td>${safeFormat(amp.holdTensile)} MPa</td>`;
    if (selectedColumns.has("dropRank")) html += `<td>${amp.dropRank ? '#' + amp.dropRank : '–'}</td>`;
    if (selectedColumns.has("dropTensile")) html += `<td>${safeFormat(amp.dropTensile)} MPa</td>`;
    if (selectedColumns.has("rectRank")) html += `<td>${amp.rectRank ? '#' + amp.rectRank : '–'}</td>`;
    if (selectedColumns.has("rectTensile")) html += `<td>${safeFormat(amp.rectTensile)} MPa</td>`;
    if (selectedColumns.has("rectLoad")) html += `<td>${safeFormat(amp.rectLoad)} N</td>`;
    if (selectedColumns.has("rectFoS")) html += `<td>${safeFormat(amp.rectFoS)}</td>`;
    if (selectedColumns.has("hexRank")) html += `<td>${amp.hexRank ? '#' + amp.hexRank : '–'}</td>`;
    if (selectedColumns.has("hexTensile")) html += `<td>${safeFormat(amp.hexTensile)} MPa</td>`;
    if (selectedColumns.has("hexLoad")) html += `<td>${safeFormat(amp.hexLoad)} N</td>`;
    if (selectedColumns.has("hexFoS")) html += `<td>${safeFormat(amp.hexFoS)}</td>`;
    html += `</tr>`;
  });
  
  html += `</tbody></table>`;
  
  tableEl.innerHTML = html;
}

function populateAmphoraeList() {
  const test = getTest();
  amphoraeMemory[test] = new Set(getSelectedAmphorae().map(normalizeAmphora));
  const patternFilter = test === "Stack" ? getPattern() : "all";
  const yKey = getYAxis();
  const amphoraeSet = new Set();
  
  if (test === "Ranking") {
    const stackAmphorae = new Set();
    const holdAmphorae = new Set();
    const dropAmphorae = new Set();
    
    rawRows.forEach(row => {
      const baseTestType = baseTest(row.Test);
      const amphora = normalizeAmphora(row[AMPH_COL(row)]);
      
      if (baseTestType === "Stack") {
        if (Number.isFinite(row["Max Tensile (MPa)"]) && Number.isFinite(row["Load (N)"])) {
          stackAmphorae.add(amphora);
        }
      } else if (baseTestType === "Hold") {
        if (Number.isFinite(row["Max Tensile (MPa)"])) {
          holdAmphorae.add(amphora);
        }
      } else if (baseTestType === "Drop") {
        if (Number.isFinite(row["Max Tensile (MPa)"]) && Number.isFinite(row["Height (m)"])) {
          dropAmphorae.add(amphora);
        }
      }
    });
    
    stackAmphorae.forEach(amp => {
      if (holdAmphorae.has(amp) && dropAmphorae.has(amp)) {
        amphoraeSet.add(amp);
      }
    });
  } else {
    rawRows.forEach(row => {
      if (baseTest(row.Test) !== test) return;
      if (patternFilter !== "all" && patternOf(row.Test) !== patternFilter) return;
      if (!Number.isFinite(effectiveY(row, yKey))) return;
      amphoraeSet.add(row[AMPH_COL(row)]);
    });
  }

  const container = document.getElementById("amphoraeList");
  if (!container) return;
  
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
    
    btn.addEventListener("click", function() {
      this.classList.toggle("active");
      const currentTest = getTest();
      if (currentTest === "Ranking") {
        displayRankingTable();
      } else {
        updatePlot();
      }
    });
    
    container.appendChild(btn);
  });

  ["Select All", "Deselect All"].forEach(label => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline-secondary btn-sm util-btn";
    btn.textContent = label;
    btn.style.fontWeight = "500";
    btn.style.marginTop = "0.25rem";
    
    btn.addEventListener("click", function() {
      const buttons = container.querySelectorAll(".amph-btn");
      buttons.forEach(b => {
        label === "Select All"
          ? b.classList.add("active")
          : b.classList.remove("active");
      });
      
      const currentTest = getTest();
      if (currentTest === "Ranking") {
        displayRankingTable();
      } else {
        updatePlot();
      }
    });
    
    container.appendChild(btn);
  });
}

/* -------------------------------------------------------------
   7.  Data Load + Chart
------------------------------------------------------------- */
async function fetchRows(test) {
  if (cache[test]) return cache[test];
  try {
    const res = await fetch(CSV_BY_TEST[test]);
    if (!res.ok) throw new Error(`Failed to load ${test}`);
    const csv = await res.text();
    let rows = Papa.parse(csv, {
      header: true,
      dynamicTyping: true,
      transformHeader: (h) => h.trim(),
      transform: (v, field) => {
        if (field && (field.includes("Mass") || field.includes("Load") || 
            field.includes("Volume") || field.includes("MPa") || field.includes("(m)"))) {
          const cleaned = String(v).replace(/[, ]+/g, "");
          const n = parseFloat(cleaned);
          return Number.isFinite(n) ? n : v;
        }
        return v;
      }
    }).data;
    rows = rows.filter(r => Object.values(r).some(v => v !== null && v !== ""));
    cache[test] = rows;
    return rows;
  } catch (error) {
    console.error(`Error fetching ${test} data:`, error);
    return [];
  }
}

function processHoldTestData(selected, xKey, yKey) {
  const datasets = [];
  
  for (const amp of selected) {
    const baseAmpName = normalizeAmphora(amp);
    
    const rows = rawRows.filter(r => 
      normalizeAmphora(r[AMPH_COL(r)]) === baseAmpName && 
      baseTest(r.Test) === "Hold"
    );
    
    if (!rows.length) continue;
    
    const data = [];
    
    for (const r of rows) {
      const fillType = getFillType(r.Test);
      
      let x, y;
      if (xKey === "Mass" || xKey?.includes("Mass")) {
        x = getEffectiveMass(r, fillType);
      } else {
        x = r[xKey];
      }
      
      if (yKey === "Mass" || yKey?.includes("Mass")) {
        y = getEffectiveMass(r, fillType);
      } else {
        y = r[yKey];
      }
      
      if (Number.isFinite(x) && Number.isFinite(y)) {
        data.push({
          x: x,
          y: y,
          r: 5,
          __rawRow: r,
          __fillType: fillType
        });
      }
    }
    
    data.sort((a, b) => a.x - b.x);
    
    if (data.length > 0) {
      datasets.push({
        label: baseAmpName,
        data: data,
        backgroundColor: colors[baseAmpName] || colors[amp],
        borderColor: colors[baseAmpName] || colors[amp],
        pointRadius: 5,
        borderWidth: 1,
        tension: 0.2,
        fill: false,
        spanGaps: true
      });
    }
  }
  
  return datasets;
}

function updatePlot() {
  try {
    const xKey = getXAxis();
    const yKey = getYAxis();
    const selected = getSelectedAmphorae();
    const test = getTest();
    const patternFilter = test === "Stack" ? getPattern() : "all";
    const isHoldTest = test === "Hold";

    let datasets = [];
    
    if (isHoldTest && (xKey === "Mass" || yKey === "Mass")) {
      datasets = processHoldTestData(selected, xKey, yKey);
    } else {
      datasets = selected.map(amp => {
        const data = rawRows.filter(r =>
          r[AMPH_COL(r)] === amp &&
          baseTest(r.Test) === test &&
          (patternFilter === "all" || patternOf(r.Test) === patternFilter)
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
    }

    if (chart) chart.destroy();
    
    const chartCanvas = document.getElementById("chartCanvas");
    if (!chartCanvas) {
      console.error("Chart canvas not found");
      return;
    }

    chart = new Chart(chartCanvas, {
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
                const fillType = ctx.raw.__fillType;
                const test = baseTest(r.Test || "");
                
                const xVal = ctx.raw.x;
                const yVal = ctx.raw.y;
                const x = valStr(xVal, getXAxis());
                const y = valStr(yVal, getYAxis());
                
                let label = `${ctx.dataset.label}`;
                
                if (test === "Hold" && fillType) {
                  label += ` (${fillType})`;
                }
                
                label += `: (${x}, ${y})`;
                
                if (test !== "Hold") {
                  const massBasis = getMass();
                  const n = r["n (layers)"];
                  const w = r["w (# pot)"];
                  const l = r["l (# pot)"];
                  
                  let totalMass;
                  const fillType = massBasis === "Mass (Wine) (kg)" ? "Wine" : 
                                  (massBasis === "Mass (Oil)" || massBasis === "Mass (Oil) (kg)") ? "Oil" : "Empty";
                  
                  const massPerPot = getEffectiveMass(r, fillType);
                  
                  totalMass = Number.isFinite(n) && Number.isFinite(w) && 
                              Number.isFinite(l) && Number.isFinite(massPerPot)
                              ? (n * w * l * massPerPot)
                              : NaN;
                  
                  if (Number.isFinite(totalMass)) {
                    const absMass = Math.abs(totalMass);
                    const massStr = absMass >= 1e5 || absMass < 1e-2
                      ? `${totalMass.toExponential(2)} kg`
                      : `${totalMass.toFixed(2)} kg`;
                    label += `, total mass ≈ ${massStr}`;
                  }
                }
                
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: xKey === "Mass" 
                ? `Mass (${getUnit("Mass (kg)")})` 
                : `${(xKey || "").replace(/\s*\(.*?\)/, "")} (${getUnit(xKey)})`
            },
            type: "linear"
          },
          y: {
            title: {
              display: true,
              text: yKey === "Mass" 
                ? `Mass (${getUnit("Mass (kg)")})`
                : `${(yKey || "").replace(/\s*\(.*?\)/, "")} (${getUnit(yKey)})`
            },
            type: "linear"
          }
        }
      }
    });
  } catch (err) {
    console.error("Error updating plot:", err);
  }
}

/* -------------------------------------------------------------
   8.  Main
------------------------------------------------------------- */
async function onControlChange() {
  try {
    const test = getTest();
    
    if (test !== lastTestLoaded) {
      if (test === "Ranking") {
        try {
          const promises = [];
          
          if (!cache["Stack"]) {
            promises.push(fetchRows("Stack").then(data => {
              cache["Stack"] = data;
              return data;
            }));
          }
          
          if (!cache["Hold"]) {
            promises.push(fetchRows("Hold").then(data => {
              cache["Hold"] = data;
              return data;
            }));
          }
          
          if (!cache["Drop"]) {
            promises.push(fetchRows("Drop").then(data => {
              cache["Drop"] = data;
              return data;
            }));
          }
          
          const results = await Promise.all(promises);
          
          rawRows = [
            ...(cache["Stack"] || []), 
            ...(cache["Hold"] || []), 
            ...(cache["Drop"] || [])
          ];
        } catch (err) {
          console.error("Error loading data for ranking:", err);
          rawRows = [];
        }
      } else {
        rawRows = await fetchRows(test);
      }
      
      buildAxisSelectors();
      lastTestLoaded = test;
    }
    
    toggleUIControls();
    populateAmphoraeList();
    
    if (test === "Ranking") {
      displayRankingTable();
    } else {
      updatePlot();
    }
  } catch (err) {
    console.error("Error in onControlChange:", err);
    alert(`Error: ${err.message}`);
  }
}

function attachListeners() {
  ["xAxis", "yAxis"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.addEventListener("change", updatePlot);
  });
  
  ["mass", "test", "pattern"].forEach(name => {
    document.querySelectorAll(`input[name=${name}]`)
      .forEach(el => el.addEventListener("change", onControlChange));
  });
}

/* -------------------------------------------------------------
   9.  Initialization
------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const chartBody = document.querySelector("#chart-wrap .card-body");
  if (chartBody) {
    const rankingTable = document.createElement("div");
    rankingTable.id = "rankingTable";
    rankingTable.className = "d-none";
    chartBody.appendChild(rankingTable);
  }
  
  // Initialize ranking column selection
  initializeSelectedColumns();
  buildColumnControls();
  attachColumnControlListeners();
  
  attachListeners();
  onControlChange();
});