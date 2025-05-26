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
  dropTensile: { label: "Drop Compressive", group: "drop", defaultSelected: false },
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

// Sorting state for ranking table
let currentSortColumn = 'overallRank';
let currentSortDirection = 'asc'; // 'asc' or 'desc'

// 3D Model System
let modelViewer = null;

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
  // Remove both _rect and _hex suffixes
  return String(name).replace(/[_\s]+(rect|hex)$/i, "").trim();
};

const AMPH_COL = (row) => {
  if (!row) return "";
  if (row.hasOwnProperty("Amphora")) return "Amphora";
  if (row.hasOwnProperty("Amphorae")) return "Amphorae";
  const keys = Object.keys(row);
  const amphoraKey = keys.find((k) => k && k.toLowerCase().startsWith("amphora"));
  return amphoraKey || "";
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
        // If we're deselecting the current sort column, reset to overall rank
        if (currentSortColumn === key) {
          currentSortColumn = 'overallRank';
          currentSortDirection = 'asc';
        }
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
          // If we're deselecting the current sort column, reset to overall rank
          if (currentSortColumn === col) {
            currentSortColumn = 'overallRank';
            currentSortDirection = 'asc';
          }
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
    // Reset sort to overall rank
    currentSortColumn = 'overallRank';
    currentSortDirection = 'asc';
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
  if (currentTest === "Drop") {
    defaultYAxis = "Max Compressive (MPa)";
  }
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
    
    const hasRectData = rawRows.some(r => {
      const match = baseTest(r.Test) === "Stack" && 
        patternOf(r.Test) === "Rect" &&
        normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
        Number.isFinite(r["Max Tensile (MPa)"]);
      return match;
    });
    
    const hasHexData = rawRows.some(r => {
      const match = baseTest(r.Test) === "Stack" && 
        patternOf(r.Test) === "Hex" &&
        normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
        Number.isFinite(r["Max Tensile (MPa)"]);
      return match;
    });
    
    const hasHoldData = rawRows.some(r => {
      const match = baseTest(r.Test) === "Hold" && 
        normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
        Number.isFinite(r["Max Tensile (MPa)"]);
      return match;
    });
    
    // Check for drop data - look for either compressive or tensile data
    const hasDropData = rawRows.some(r => {
      const match = baseTest(r.Test) === "Drop" && 
        normalizeAmphora(r[AMPH_COL(r)]) === normalizedName &&
        (Number.isFinite(r["Max Compressive (MPa)"]) || Number.isFinite(r["Max Tensile (MPa)"]));
      return match;
    });
    
    return hasRectData && hasHexData && hasHoldData && hasDropData;
  });
  
  if (completeAmphorae.length === 0) {
    return [];
  }
  
  try {
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
        dropCompressiveValues: [],
        dropCompressive: 0,
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
    
    // Process drop data - calculate mean compressive stress (or tensile if compressive not available)
    const dropRows = rawRows.filter(r => baseTest(r.Test) === "Drop");
    dropRows.forEach(row => {
      const amp = normalizeAmphora(row[AMPH_COL(row)]);
      if (!amphoraeData[amp]) return;
      
      // Prefer compressive data, fall back to tensile if compressive not available
      const compressive = row["Max Compressive (MPa)"] || 0;
      const tensile = row["Max Tensile (MPa)"] || 0;
      const value = compressive > 0 ? compressive : tensile;
      
      if (value <= 0) return;
      
      amphoraeData[amp].dropCompressiveValues.push(value);
    });
    
    // Calculate mean drop compressive for each amphora
    Object.values(amphoraeData).forEach(amp => {
      if (amp.dropCompressiveValues.length > 0) {
        const sum = amp.dropCompressiveValues.reduce((a, b) => a + b, 0);
        amp.dropCompressive = sum / amp.dropCompressiveValues.length;
      }
    });
    
    let results = Object.values(amphoraeData);
    
    results = results.filter(amp => {
      const valid = amp.rectTensile > 0 && 
        amp.hexTensile > 0 && 
        amp.holdTensile > 0 && 
        amp.dropCompressive > 0;
      return valid;
    });
    
    if (results.length === 0) {
      return [];
    }
    
    results.sort((a, b) => a.rectTensile - b.rectTensile);
    results.forEach((amp, i) => { amp.rectRank = i + 1; });
    
    results.sort((a, b) => a.hexTensile - b.hexTensile);
    results.forEach((amp, i) => { amp.hexRank = i + 1; });
    
    results.sort((a, b) => a.holdTensile - b.holdTensile);
    results.forEach((amp, i) => { amp.holdRank = i + 1; });
    
    results.sort((a, b) => a.dropCompressive - b.dropCompressive);
    results.forEach((amp, i) => { amp.dropRank = i + 1; });
    
    results.forEach(amp => {
      amp.overallScore = amp.rectRank + amp.hexRank + amp.holdRank + amp.dropRank;
    });
    
    results.sort((a, b) => a.overallScore - b.overallScore);
    results.forEach((amp, i) => { amp.overallRank = i + 1; });
    
    return results;
    
  } catch (error) {
    console.error("Error in data processing:", error);
    return [];
  }
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
  
  // Apply current sort
  const sortedRankings = [...rankings].sort((a, b) => {
    let aVal, bVal;
    
    // Get values based on column type
    switch(currentSortColumn) {
      case 'name':
        aVal = a.name || '';
        bVal = b.name || '';
        break;
      case 'overallRank':
        aVal = a.overallRank || 999;
        bVal = b.overallRank || 999;
        break;
      case 'holdRank':
        aVal = a.holdRank || 999;
        bVal = b.holdRank || 999;
        break;
      case 'holdTensile':
        aVal = a.holdTensile || 0;
        bVal = b.holdTensile || 0;
        break;
      case 'dropRank':
        aVal = a.dropRank || 999;
        bVal = b.dropRank || 999;
        break;
      case 'dropTensile':
        aVal = a.dropCompressive || 0;
        bVal = b.dropCompressive || 0;
        break;
      case 'rectRank':
        aVal = a.rectRank || 999;
        bVal = b.rectRank || 999;
        break;
      case 'rectTensile':
        aVal = a.rectTensile || 0;
        bVal = b.rectTensile || 0;
        break;
      case 'rectLoad':
        aVal = a.rectLoad || 0;
        bVal = b.rectLoad || 0;
        break;
      case 'rectFoS':
        aVal = a.rectFoS || 0;
        bVal = b.rectFoS || 0;
        break;
      case 'hexRank':
        aVal = a.hexRank || 999;
        bVal = b.hexRank || 999;
        break;
      case 'hexTensile':
        aVal = a.hexTensile || 0;
        bVal = b.hexTensile || 0;
        break;
      case 'hexLoad':
        aVal = a.hexLoad || 0;
        bVal = b.hexLoad || 0;
        break;
      case 'hexFoS':
        aVal = a.hexFoS || 0;
        bVal = b.hexFoS || 0;
        break;
      default:
        aVal = 0;
        bVal = 0;
    }
    
    // Compare values
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return currentSortDirection === 'asc' 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      return currentSortDirection === 'asc'
        ? aVal - bVal
        : bVal - aVal;
    }
  });
  
  const safeFormat = (value) => {
    if (value === undefined || value === null || isNaN(value) || value === 0) {
      return "–";
    }
    return Number(value).toFixed(2);
  };
  
  // Helper function to create sortable header
  const createSortableHeader = (columnKey, label, rowspan = false) => {
    const isCurrentSort = currentSortColumn === columnKey;
    const arrow = isCurrentSort 
      ? (currentSortDirection === 'asc' ? ' ↑' : ' ↓')
      : '';
    const style = 'cursor: pointer; user-select: none;';
    const onclick = `onclick="sortRankingTable('${columnKey}')"`;
    const title = 'title="Click to sort by this column"';
    
    if (rowspan) {
      return `<th rowspan="2" style="${style}" ${onclick} ${title}>${label}${arrow}</th>`;
    } else {
      return `<th style="${style}" ${onclick} ${title}>${label}${arrow}</th>`;
    }
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
    html += createSortableHeader('overallRank', 'Overall<br>Rank', true);
  }
  html += createSortableHeader('name', 'Amphora', true);
  
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
  if (selectedColumns.has("holdRank")) html += createSortableHeader('holdRank', 'Rank');
  if (selectedColumns.has("holdTensile")) html += createSortableHeader('holdTensile', 'Tensile (MPa)');
  if (selectedColumns.has("dropRank")) html += createSortableHeader('dropRank', 'Rank');
  if (selectedColumns.has("dropTensile")) html += createSortableHeader('dropTensile', 'Compressive (MPa)');
  if (selectedColumns.has("rectRank")) html += createSortableHeader('rectRank', 'Rank');
  if (selectedColumns.has("rectTensile")) html += createSortableHeader('rectTensile', 'Tensile (MPa)');
  if (selectedColumns.has("rectLoad")) html += createSortableHeader('rectLoad', 'Load (N)');
  if (selectedColumns.has("rectFoS")) html += createSortableHeader('rectFoS', 'FoS');
  if (selectedColumns.has("hexRank")) html += createSortableHeader('hexRank', 'Rank');
  if (selectedColumns.has("hexTensile")) html += createSortableHeader('hexTensile', 'Tensile (MPa)');
  if (selectedColumns.has("hexLoad")) html += createSortableHeader('hexLoad', 'Load (N)');
  if (selectedColumns.has("hexFoS")) html += createSortableHeader('hexFoS', 'FoS');
  html += `</tr></thead><tbody>`;
  
  // Table rows
  sortedRankings.forEach((amp) => {
    html += `<tr>`;
    if (selectedColumns.has("overallRank")) {
      html += `<td><strong>${amp.overallRank || '–'}</strong></td>`;
    }
    html += `<td>${amp.name || '–'}</td>`;
    if (selectedColumns.has("holdRank")) html += `<td>${amp.holdRank ? '#' + amp.holdRank : '–'}</td>`;
    if (selectedColumns.has("holdTensile")) html += `<td>${safeFormat(amp.holdTensile)} MPa</td>`;
    if (selectedColumns.has("dropRank")) html += `<td>${amp.dropRank ? '#' + amp.dropRank : '–'}</td>`;
    if (selectedColumns.has("dropTensile")) html += `<td>${safeFormat(amp.dropCompressive)} MPa</td>`;
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
  
  // Add hover listeners for table amphora names
  if (modelViewer) {
    const tableRows = tableEl.querySelectorAll('tbody tr');
    tableRows.forEach((row, index) => {
      const nameCell = row.querySelector('td:nth-child(' + (selectedColumns.has("overallRank") ? '2' : '1') + ')');
      if (nameCell) {
        nameCell.style.cursor = 'pointer';
        nameCell.addEventListener('mouseenter', (e) => {
          const ampData = sortedRankings[index];
          if (ampData) {
            // Pass null for rowData since we'll look it up
            modelViewer.show(ampData.name, e.clientX - 10, e.clientY, null);
          }
        });
        nameCell.addEventListener('mouseleave', () => {
          modelViewer.hide();
        });
      }
    });
  }
}

// Add global sorting function
window.sortRankingTable = function(columnKey) {
  if (currentSortColumn === columnKey) {
    // Toggle direction if clicking same column
    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    // New column - default to ascending
    currentSortColumn = columnKey;
    currentSortDirection = 'asc';
  }
  displayRankingTable();
};

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
        if ((Number.isFinite(row["Max Compressive (MPa)"]) || Number.isFinite(row["Max Tensile (MPa)"])) && Number.isFinite(row["Height (m)"])) {
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
    
    // Add mouseleave listener to hide popup when leaving chart
    chartCanvas.addEventListener('mouseleave', () => {
      if (modelViewer) {
        modelViewer.hide();
      }
    });

    chart = new Chart(chartCanvas, {
      type: "line",
      data: { datasets },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        interaction: {
          intersect: false,
          mode: 'point'
        },
        onHover: (event, activeElements) => {
          if (activeElements.length > 0 && modelViewer) {
            const element = activeElements[0];
            const dataset = datasets[element.datasetIndex];
            const dataPoint = dataset.data[element.index];
            const amphoraName = dataset.label;
            
            const canvasRect = chartCanvas.getBoundingClientRect();
            const mouseX = canvasRect.left + event.x - 10; // event.x is relative to canvas
            const mouseY = canvasRect.top + event.y;
            
            modelViewer.show(amphoraName, mouseX, mouseY, dataPoint.__rawRow);
          } else if (modelViewer) {
            modelViewer.hide();
          }
        },
        plugins: {
          legend: { 
            position: "right",
            onHover: null,  // Disable hover on legend items
            onLeave: null
          },
          tooltip: {
            enabled: true,
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
      // Reset sort to overall rank when switching to ranking view
      if (test !== lastTestLoaded) {
        currentSortColumn = 'overallRank';
        currentSortDirection = 'asc';
      }
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
   9.  3D Model Viewer
------------------------------------------------------------- */
class ModelViewer {
  constructor() {
  // Check if Three.js is loaded
  if (typeof THREE === 'undefined' || typeof THREE.STLLoader === 'undefined') {
    console.error('Three.js or STLLoader not loaded');
    return;
  }
  
  this.scene = null;
  this.camera = null;
  this.renderer = null;
  this.controls = null;
  this.model = null;
  this.animationId = null;
  this.popup = document.getElementById('model-popup');
  this.container = document.getElementById('model-container');
  this.loader = new THREE.STLLoader();
  this.currentAmphora = null;
  this.hideTimeout = null;
  this.showTimeout = null;
  this.cursorX = undefined;
  this.cursorY = undefined;
  
  this.init();
  
  // Track mouse position globally
  document.addEventListener('mousemove', (e) => {
    this.cursorX = e.clientX;
    this.cursorY = e.clientY;
    
    // Update position if popup is visible and cursor might overlap
    if (this.popup.classList.contains('show')) {
      this._updatePosition();
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (this.popup.classList.contains('show') && this.currentAmphora) {
      this._updatePosition();
    }
  });
}
  
  _updatePosition() {
  const chartWrap = document.getElementById('chart-wrap');
  if (!chartWrap) return;
  
  const rect = chartWrap.getBoundingClientRect();
  
  // Ensure chart wrap has dimensions
  if (rect.width === 0 || rect.height === 0) return;
  
  const popupWidth = 550;
  const popupHeight = 300;
  const margin = 20;
  
  // Check if popup fits in the chart area
  const availableWidth = rect.width - (margin * 2);
  
  if (availableWidth < popupWidth) {
    // Scale down the popup if needed
    const scale = availableWidth / popupWidth;
    this.popup.style.transform = `scale(${scale})`;
    this.popup.style.transformOrigin = 'top right';
  } else {
    this.popup.style.transform = '';
  }
  
  // Default position: top-right of chart area
  let left = rect.right - popupWidth - margin;
  let top = rect.top + margin;
  
  // Check if cursor would overlap with the popup in top-right position
  if (this.cursorX !== undefined && this.cursorY !== undefined) {
    const popupRight = left + popupWidth;
    const popupBottom = top + popupHeight;
    
    // Check if cursor is within the popup area (with a small buffer)
    const buffer = 10;
    const cursorInPopup = this.cursorX >= left - buffer && 
                         this.cursorX <= popupRight + buffer &&
                         this.cursorY >= top - buffer && 
                         this.cursorY <= popupBottom + buffer;
    
    if (cursorInPopup) {
      // Move to bottom-left corner instead
      left = rect.left + margin;
      top = rect.bottom - popupHeight - margin;
      
      // Update transform origin for bottom-left position if scaled
      if (availableWidth < popupWidth) {
        this.popup.style.transformOrigin = 'bottom left';
      }
    }
  }
  
  // Ensure it stays on screen
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  
  // If popup would go below viewport, adjust
  if (top + popupHeight > window.innerHeight - margin) {
    top = window.innerHeight - popupHeight - margin;
  }
  
  this.popup.style.left = `${left}px`;
  this.popup.style.top = `${top}px`;
}
  
  init() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f5f5);
    
    // Log available models for debugging
    console.log('3D Model Viewer initialized');
    console.log('Popup positioning: TOP-RIGHT corner of chart area');
    console.log('Expected model path format: ./models/[amphora_name].stl');
    console.log('Example: "Africana 2A" -> "./models/africana_2a.stl"');
    
    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.container.offsetWidth / this.container.offsetHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 200);
    
    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    
    // Controls setup
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.0;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    this.scene.add(directionalLight);
    
    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-100, -100, -50);
    this.scene.add(backLight);
  }
  
  formatModelFileName(amphoraName) {
    // Convert amphora name to filename format
    // First normalize the name to remove pattern suffixes
    let normalizedName = normalizeAmphora(amphoraName);
    
    // Handle specific naming corrections and mappings
    const directMappings = {
      // Exact mappings for known amphora types
      'africana 2a': 'africana_2a',
      'africana 2b': 'africana_2b',
      'dressel 1a': 'dressel_1a',
      'dressel 1b': 'dressel_1b',
      'dressel 20': 'dressel_20',
      'seagean': 'seaegean',  // Spelling correction
      'seaegean': 'seaegean', // Already correct spelling
      'canaanite kw214': 'canaanite_kw214',
      'cannanite kw214': 'canaanite_kw214', // Common misspelling
      // Add more direct mappings as needed
    };
    
    // First check for direct mapping
    const lowerName = normalizedName.toLowerCase().trim();
    if (directMappings[lowerName]) {
      return directMappings[lowerName] + '.stl';
    }
    
    // Otherwise, convert to filename format
    const filename = lowerName
      .replace(/\s+/g, '_')           // Replace spaces with underscores
      .replace(/[^\w_-]/g, '')        // Remove special characters except underscore and dash
      .replace(/_+/g, '_')            // Replace multiple underscores with single
      .replace(/^_|_$/g, '');         // Remove leading/trailing underscores
    
    return filename + '.stl';
  }
  
  loadModel(amphoraName) {
    // Clear previous model
    if (this.model) {
      this.scene.remove(this.model);
      this.model.geometry?.dispose();
      this.model.material?.dispose();
      this.model = null;
    }
    
    const fileName = this.formatModelFileName(amphoraName);
    // Use path relative to the HTML file location
    const modelPath = `models/${fileName}`;
    
    // Show loading state
    document.getElementById('model-loading').style.display = 'block';
    document.getElementById('model-error').style.display = 'none';
    
    // Try to load the model
    this.tryLoadModel(modelPath, amphoraName, fileName);
  }
  
  tryLoadModel(modelPath, amphoraName, fileName) {
    this.loader.load(
      modelPath,
      (geometry) => {
        // Success callback
        document.getElementById('model-loading').style.display = 'none';
        
        // Create material
        const material = new THREE.MeshPhongMaterial({
          color: 0xd4a574,  // Clay/terracotta color
          specular: 0x222222,
          shininess: 20,
          side: THREE.DoubleSide
        });
        
        // Create mesh
        this.model = new THREE.Mesh(geometry, material);
        this.model.castShadow = true;
        this.model.receiveShadow = true;
        
        // Center and scale the model
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // Center the geometry
        geometry.translate(-center.x, -center.y, -center.z);
        
        // Scale to fit
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 100 / maxDim;
        this.model.scale.set(scale, scale, scale);
        
        // Rotate to standard orientation (STL files often need rotation)
        this.model.rotation.x = -Math.PI / 2;
        
        this.scene.add(this.model);
        
        console.log(`Successfully loaded model: ${fileName}`);
      },
      (progress) => {
        // Progress callback (optional)
      },
      (error) => {
        // Error callback
        console.error(`Error loading model for ${amphoraName}:`, error);
        console.error(`Attempted to load: ${modelPath}`);
        console.log(`Normalized name: ${fileName}`);
        document.getElementById('model-loading').style.display = 'none';
        document.getElementById('model-error').style.display = 'block';
        document.getElementById('model-error').textContent = 
          `3D model not available (${fileName})`;
      }
    );
  }
  
  show(amphoraName, x, y, rowData) {
  // Update cursor position
  if (x !== undefined && y !== undefined) {
    this.cursorX = x;
    this.cursorY = y;
  }
  
  // Clear any pending timeouts
  if (this.hideTimeout) {
    clearTimeout(this.hideTimeout);
    this.hideTimeout = null;
  }
  if (this.showTimeout) {
    clearTimeout(this.showTimeout);
    this.showTimeout = null;
  }
  
  // If already showing a different amphora, switch immediately
  if (this.currentAmphora && this.currentAmphora !== amphoraName) {
    this.currentAmphora = amphoraName;
    this._displayPopup(amphoraName, rowData);
  } else {
    // Add small delay to prevent flickering
    this.showTimeout = setTimeout(() => {
      this.currentAmphora = amphoraName;
      this._displayPopup(amphoraName, rowData);
    }, 200); // 200ms delay to prevent flickering
  }
}
  
  _displayPopup(amphoraName, rowData) {
    // Update info panel
    document.getElementById('model-amphora-name').textContent = amphoraName;
    
    if (rowData) {
      const emptyMass = rowData["Mass (Empty) (kg)"] || 0;
      const wineMass = rowData["Mass (Wine) (kg)"] || 0;
      const oilMass = rowData["Mass (Oil)"] || rowData["Mass (Oil) (kg)"] || 0;
      const volume = rowData["Internal Volume (mm^3)"] || 0;
      
      document.getElementById('model-weight-empty').textContent = 
        emptyMass ? `${emptyMass.toFixed(2)} kg` : '-';
      document.getElementById('model-weight-wine').textContent = 
        wineMass ? `${(emptyMass + wineMass).toFixed(2)} kg` : '-';
      document.getElementById('model-weight-oil').textContent = 
        oilMass ? `${(emptyMass + oilMass).toFixed(2)} kg` : '-';
      document.getElementById('model-volume').textContent = 
        volume ? `${(volume / 1e6).toFixed(2)} L` : '-';
    } else {
      // Try to find data from rawRows
      const amphoraData = rawRows.find(r => 
        r[AMPH_COL(r)] === amphoraName || 
        normalizeAmphora(r[AMPH_COL(r)]) === normalizeAmphora(amphoraName)
      );
      
      if (amphoraData) {
        this._displayPopup(amphoraName, amphoraData);
        return;
      }
      
      // No data available
      document.getElementById('model-weight-empty').textContent = '-';
      document.getElementById('model-weight-wine').textContent = '-';
      document.getElementById('model-weight-oil').textContent = '-';
      document.getElementById('model-volume').textContent = '-';
    }
    
    // Load model
    this.loadModel(amphoraName);
    
    // Position popup in top-right corner of chart area
    this._updatePosition();
    this.popup.classList.add('show');
    
    // Start animation
    this.animate();
  }
  
  hide() {
    // Clear any pending show timeout
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
    
    // Add a small delay to prevent flicker when moving between elements
    this.hideTimeout = setTimeout(() => {
      this.popup.classList.remove('show');
      this.currentAmphora = null;
      
      // Stop animation
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      
      // Hide loading/error messages
      document.getElementById('model-loading').style.display = 'none';
      document.getElementById('model-error').style.display = 'none';
    }, 150); // Slightly longer delay for smoother transitions
  }
  
  animate() {
    if (!this.popup.classList.contains('show')) return;
    
    this.animationId = requestAnimationFrame(() => this.animate());
    
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  
  attachHoverListeners() {
    // No hover listeners for amphora selection buttons
    // Only chart data points and ranking table will trigger popups
  }
}

/* -------------------------------------------------------------
   10.  Initialization
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
  
  // Initialize 3D model viewer
  if (typeof THREE !== 'undefined' && typeof THREE.STLLoader !== 'undefined') {
    modelViewer = new ModelViewer();
    modelViewer.attachHoverListeners();
    
    // Log some example amphora names for debugging
    console.log('=== 3D Model System Ready ===');
    console.log('Hover over amphora names to see 3D models');
    console.log('Models should be in: docs/models/');
    console.log('File naming examples:');
    console.log('  "Africana 2A_rect" -> africana_2a.stl');
    console.log('  "Dressel 1A" -> dressel_1a.stl');
    console.log('  "Seagean" -> seaegean.stl (note spelling)');
    console.log('\nTo check all model requirements, run in console:');
    console.log('  checkModelRequirements()');
    
    // Add debug helper
    window.checkModelRequirements = function() {
      if (!rawRows || rawRows.length === 0) {
        console.error('No data loaded yet. Please wait for data to load and try again.');
        return;
      }

      const uniqueAmphorae = new Set();
      rawRows.forEach(row => {
        const amp = row[AMPH_COL(row)];
        if (amp) {
          uniqueAmphorae.add(amp);
        }
      });
      
      console.log('\n=== Required STL Files ===');
      const fileMap = new Map();
      
      [...uniqueAmphorae].sort().forEach(amp => {
        const normalized = normalizeAmphora(amp);
        const filename = modelViewer.formatModelFileName(amp);
        
        if (!fileMap.has(filename)) {
          fileMap.set(filename, []);
        }
        fileMap.get(filename).push(amp);
      });
      
      [...fileMap.entries()].sort().forEach(([filename, names]) => {
        console.log(`${filename} <- [${names.join(', ')}]`);
      });
    };
  } else {
    console.warn('Three.js not loaded - 3D model preview disabled');
  }
  
  attachListeners();
  onControlChange();
});