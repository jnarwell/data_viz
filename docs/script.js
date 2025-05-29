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
    let alerts = '';
    let tableContent = html;
    
    // Extract alerts
    const alertRegex = /<div class="alert[\s\S]*?<\/div>/g;
    const alertMatches = html.match(alertRegex);
    if (alertMatches) {
      alerts = alertMatches.join('');
      tableContent = html.replace(alertRegex, '');
    }
    
    // Build final HTML with scrollable table
    tableEl.innerHTML = `
      ${alerts}
      <div class="table-responsive" style="max-height: calc(100vh - 400px); overflow-y: auto; overflow-x: auto; position: relative;">
        ${tableContent}
      </div>
    `;
    
    // Make headers sticky (add after setting innerHTML)
    const tableElement = tableEl.querySelector('table');
    if (tableElement) {
      const thead = tableElement.querySelector('thead');
      if (thead) {
        thead.style.position = 'sticky';
        thead.style.top = '0';
        thead.style.backgroundColor = '#fff';
        thead.style.zIndex = '10';
        thead.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      }
    }
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
    if (selectedColumns.has("holdTensile")) html += `<td>${safeFormat(amp.holdTensile)}</td>`;
    if (selectedColumns.has("dropRank")) html += `<td>${amp.dropRank ? '#' + amp.dropRank : '–'}</td>`;
    if (selectedColumns.has("dropTensile")) html += `<td>${safeFormat(amp.dropCompressive)}</td>`;
    if (selectedColumns.has("rectRank")) html += `<td>${amp.rectRank ? '#' + amp.rectRank : '–'}</td>`;
    if (selectedColumns.has("rectTensile")) html += `<td>${safeFormat(amp.rectTensile)}</td>`;
    if (selectedColumns.has("rectLoad")) html += `<td>${safeFormat(amp.rectLoad)}</td>`;
    if (selectedColumns.has("rectFoS")) html += `<td>${safeFormat(amp.rectFoS)}</td>`;
    if (selectedColumns.has("hexRank")) html += `<td>${amp.hexRank ? '#' + amp.hexRank : '–'}</td>`;
    if (selectedColumns.has("hexTensile")) html += `<td>${safeFormat(amp.hexTensile)}</td>`;
    if (selectedColumns.has("hexLoad")) html += `<td>${safeFormat(amp.hexLoad)}</td>`;
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
   10.  Download Functionality
------------------------------------------------------------- */
class DownloadManager {
  constructor() {
    this.attachListeners();
  }
  
  attachListeners() {
    document.addEventListener('click', (e) => {
      if (e.target.matches('.download-option')) {
        e.preventDefault();
        const format = e.target.dataset.format;
        this.download(format);
      }
    });
  }
  
  download(format) {
    const test = getTest();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const baseFilename = `amphorae-${test.toLowerCase()}-${timestamp}`;
    
    if (test === 'Ranking') {
      this.downloadRanking(format, baseFilename);
    } else {
      this.downloadChart(format, baseFilename);
    }
  }
  
  downloadChart(format, filename) {
    switch (format) {
      case 'png':
        this.downloadChartAsPNG(filename);
        break;
      case 'pdf':
        this.downloadChartAsPDF(filename);
        break;
      case 'xlsx':
        this.downloadChartAsExcel(filename);
        break;
      case 'csv':
        this.downloadChartAsCSV(filename);
        break;
      case 'txt':
        this.downloadChartAsText(filename);
        break;
    }
  }
  
  downloadRanking(format, filename) {
    switch (format) {
      case 'png':
        this.downloadRankingAsPNG(filename);
        break;
      case 'pdf':
        this.downloadRankingAsPDF(filename);
        break;
      case 'xlsx':
        this.downloadRankingAsExcel(filename);
        break;
      case 'csv':
        this.downloadRankingAsCSV(filename);
        break;
      case 'txt':
        this.downloadRankingAsText(filename);
        break;
    }
  }
  
  // Chart download methods
  downloadChartAsPNG(filename) {
    const canvas = document.getElementById('chartCanvas');
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  
  downloadChartAsPDF(filename) {
    const canvas = document.getElementById('chartCanvas');
    const imgData = canvas.toDataURL('image/png');
    
    // Create PDF with landscape orientation for better chart display
    const pdf = new jspdf.jsPDF('landscape', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    // Add title
    pdf.setFontSize(16);
    pdf.text(`Amphorae ${getTest()} Test Results`, pdfWidth / 2, 15, { align: 'center' });
    
    // Add metadata
    pdf.setFontSize(10);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 10, 25);
    pdf.text(`X-Axis: ${getXAxis()}`, 10, 30);
    pdf.text(`Y-Axis: ${getYAxis()}`, 10, 35);
    
    // Add chart
    const imgWidth = pdfWidth - 20;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const yPos = 45;
    
    pdf.addImage(imgData, 'PNG', 10, yPos, imgWidth, Math.min(imgHeight, pdfHeight - yPos - 10));
    pdf.save(`${filename}.pdf`);
  }
  
  getChartData() {
    const xAxis = getXAxis();
    const yAxis = getYAxis();
    const test = getTest();
    const selected = getSelectedAmphorae();
    const patternFilter = test === "Stack" ? getPattern() : "all";
    
    const data = [];
    
    selected.forEach(amp => {
      const rows = rawRows.filter(r =>
        r[AMPH_COL(r)] === amp &&
        baseTest(r.Test) === test &&
        (patternFilter === "all" || patternOf(r.Test) === patternFilter)
      );
      
      rows.forEach(row => {
        const x = effectiveX(row, xAxis);
        const y = effectiveY(row, yAxis);
        
        if (Number.isFinite(x) && Number.isFinite(y)) {
          data.push({
            Amphora: amp,
            [xAxis]: x,
            [yAxis]: y,
            Test: row.Test,
            Pattern: patternOf(row.Test)
          });
        }
      });
    });
    
    return data;
  }
  
  downloadChartAsExcel(filename) {
    const data = this.getChartData();
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Add data sheet
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Chart Data');
    
    // Add metadata sheet
    const metadata = [
      { Property: 'Test Type', Value: getTest() },
      { Property: 'X-Axis', Value: getXAxis() },
      { Property: 'Y-Axis', Value: getYAxis() },
      { Property: 'Pattern Filter', Value: getPattern() },
      { Property: 'Generated', Value: new Date().toLocaleString() },
      { Property: 'Selected Amphorae', Value: getSelectedAmphorae().join(', ') }
    ];
    const metaSheet = XLSX.utils.json_to_sheet(metadata);
    XLSX.utils.book_append_sheet(wb, metaSheet, 'Metadata');
    
    // Save file
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }
  
  downloadChartAsCSV(filename) {
    const data = this.getChartData();
    const csv = Papa.unparse(data);
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  downloadChartAsText(filename) {
    const data = this.getChartData();
    const xAxis = getXAxis();
    const yAxis = getYAxis();
    
    let text = `Amphorae ${getTest()} Test Results\n`;
    text += `Generated: ${new Date().toLocaleString()}\n`;
    text += `X-Axis: ${xAxis}\n`;
    text += `Y-Axis: ${yAxis}\n`;
    text += `Pattern Filter: ${getPattern()}\n`;
    text += `\n${'='.repeat(80)}\n\n`;
    
    // Group by amphora
    const byAmphora = {};
    data.forEach(row => {
      if (!byAmphora[row.Amphora]) byAmphora[row.Amphora] = [];
      byAmphora[row.Amphora].push(row);
    });
    
    Object.entries(byAmphora).forEach(([amp, rows]) => {
      text += `${amp}\n${'-'.repeat(amp.length)}\n`;
      rows.forEach(row => {
        text += `  ${xAxis}: ${row[xAxis].toFixed(2)}, ${yAxis}: ${row[yAxis].toFixed(2)}`;
        if (row.Pattern !== 'unknown') text += ` (${row.Pattern})`;
        text += '\n';
      });
      text += '\n';
    });
    
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  // Ranking download methods
  downloadRankingAsPNG(filename) {
    const rankingTable = document.getElementById('rankingTable');
    
    html2canvas(rankingTable, {
      backgroundColor: '#ffffff',
      scale: 2 // Higher quality
    }).then(canvas => {
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }
  
  downloadRankingAsPDF(filename) {
    const rankings = calculateRankings();
    const pdf = new jspdf.jsPDF('portrait', 'mm', 'a4');
    
    // Add title
    pdf.setFontSize(16);
    pdf.text('Amphorae Ranking Report', 105, 15, { align: 'center' });
    
    // Add metadata
    pdf.setFontSize(10);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 10, 25);
    pdf.text(`Number of Amphorae: ${rankings.length}`, 10, 30);
    
    // Create table
    const tableData = rankings.map(amp => {
      const row = [amp.name, amp.overallRank];
      
      if (selectedColumns.has('holdRank')) row.push(amp.holdRank);
      if (selectedColumns.has('holdTensile')) row.push(amp.holdTensile.toFixed(2));
      if (selectedColumns.has('dropRank')) row.push(amp.dropRank);
      if (selectedColumns.has('dropTensile')) row.push(amp.dropCompressive.toFixed(2));
      if (selectedColumns.has('rectRank')) row.push(amp.rectRank);
      if (selectedColumns.has('rectTensile')) row.push(amp.rectTensile.toFixed(2));
      if (selectedColumns.has('hexRank')) row.push(amp.hexRank);
      if (selectedColumns.has('hexTensile')) row.push(amp.hexTensile.toFixed(2));
      
      return row;
    });
    
    const headers = ['Amphora'];
    if (selectedColumns.has('overallRank')) headers.push('Overall Rank');
    if (selectedColumns.has('holdRank')) headers.push('Hold Rank');
    if (selectedColumns.has('holdTensile')) headers.push('Hold Tensile');
    if (selectedColumns.has('dropRank')) headers.push('Drop Rank');
    if (selectedColumns.has('dropTensile')) headers.push('Drop Comp.');
    if (selectedColumns.has('rectRank')) headers.push('Rect Rank');
    if (selectedColumns.has('rectTensile')) headers.push('Rect Tensile');
    if (selectedColumns.has('hexRank')) headers.push('Hex Rank');
    if (selectedColumns.has('hexTensile')) headers.push('Hex Tensile');
    
    // Use autoTable if available, otherwise create simple table
    let yPos = 40;
    const cellWidth = 190 / headers.length;
    
    // Headers
    pdf.setFontSize(9);
    pdf.setFont(undefined, 'bold');
    headers.forEach((header, i) => {
      pdf.text(header, 10 + i * cellWidth, yPos);
    });
    
    // Data
    pdf.setFont(undefined, 'normal');
    pdf.setFontSize(8);
    tableData.forEach((row, rowIndex) => {
      yPos += 6;
      if (yPos > 280) {
        pdf.addPage();
        yPos = 20;
      }
      
      row.forEach((cell, i) => {
        pdf.text(String(cell), 10 + i * cellWidth, yPos);
      });
    });
    
    pdf.save(`${filename}.pdf`);
  }
  
  downloadRankingAsExcel(filename) {
    const rankings = calculateRankings();
    const wb = XLSX.utils.book_new();
    
    // Prepare data for selected columns
    const data = rankings.map(amp => {
      const row = { Amphora: amp.name };
      
      if (selectedColumns.has('overallRank')) row['Overall Rank'] = amp.overallRank;
      if (selectedColumns.has('holdRank')) row['Hold Rank'] = amp.holdRank;
      if (selectedColumns.has('holdTensile')) row['Hold Tensile (MPa)'] = amp.holdTensile;
      if (selectedColumns.has('dropRank')) row['Drop Rank'] = amp.dropRank;
      if (selectedColumns.has('dropTensile')) row['Drop Compressive (MPa)'] = amp.dropCompressive;
      if (selectedColumns.has('rectRank')) row['Rect Rank'] = amp.rectRank;
      if (selectedColumns.has('rectTensile')) row['Rect Tensile (MPa)'] = amp.rectTensile;
      if (selectedColumns.has('rectLoad')) row['Rect Load (N)'] = amp.rectLoad;
      if (selectedColumns.has('rectFoS')) row['Rect FoS'] = amp.rectFoS;
      if (selectedColumns.has('hexRank')) row['Hex Rank'] = amp.hexRank;
      if (selectedColumns.has('hexTensile')) row['Hex Tensile (MPa)'] = amp.hexTensile;
      if (selectedColumns.has('hexLoad')) row['Hex Load (N)'] = amp.hexLoad;
      if (selectedColumns.has('hexFoS')) row['Hex FoS'] = amp.hexFoS;
      
      return row;
    });
    
    // Add ranking sheet
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Rankings');
    
    // Add summary sheet
    const summary = [
      { Metric: 'Total Amphorae', Value: rankings.length },
      { Metric: 'Generated', Value: new Date().toLocaleString() },
      { Metric: 'Best Overall', Value: rankings[0]?.name || '-' },
      { Metric: 'Selected Columns', Value: Array.from(selectedColumns).join(', ') }
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }
  
  downloadRankingAsCSV(filename) {
    const rankings = calculateRankings();
    
    // Prepare data for selected columns
    const data = rankings.map(amp => {
      const row = { Amphora: amp.name };
      
      if (selectedColumns.has('overallRank')) row['Overall Rank'] = amp.overallRank;
      if (selectedColumns.has('holdRank')) row['Hold Rank'] = amp.holdRank;
      if (selectedColumns.has('holdTensile')) row['Hold Tensile (MPa)'] = amp.holdTensile;
      if (selectedColumns.has('dropRank')) row['Drop Rank'] = amp.dropRank;
      if (selectedColumns.has('dropTensile')) row['Drop Compressive (MPa)'] = amp.dropCompressive;
      if (selectedColumns.has('rectRank')) row['Rect Rank'] = amp.rectRank;
      if (selectedColumns.has('rectTensile')) row['Rect Tensile (MPa)'] = amp.rectTensile;
      if (selectedColumns.has('rectLoad')) row['Rect Load (N)'] = amp.rectLoad;
      if (selectedColumns.has('rectFoS')) row['Rect FoS'] = amp.rectFoS;
      if (selectedColumns.has('hexRank')) row['Hex Rank'] = amp.hexRank;
      if (selectedColumns.has('hexTensile')) row['Hex Tensile (MPa)'] = amp.hexTensile;
      if (selectedColumns.has('hexLoad')) row['Hex Load (N)'] = amp.hexLoad;
      if (selectedColumns.has('hexFoS')) row['Hex FoS'] = amp.hexFoS;
      
      return row;
    });
    
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  downloadRankingAsText(filename) {
    const rankings = calculateRankings();
    
    let text = `Amphorae Ranking Report\n`;
    text += `${'='.repeat(80)}\n`;
    text += `Generated: ${new Date().toLocaleString()}\n`;
    text += `Total Amphorae: ${rankings.length}\n`;
    text += `\n${'='.repeat(80)}\n\n`;
    
    rankings.forEach(amp => {
      text += `${amp.name}\n${'-'.repeat(amp.name.length)}\n`;
      text += `  Overall Rank: #${amp.overallRank}\n`;
      
      if (selectedColumns.has('holdRank') || selectedColumns.has('holdTensile')) {
        text += `  Hold Test: `;
        if (selectedColumns.has('holdRank')) text += `Rank #${amp.holdRank}`;
        if (selectedColumns.has('holdTensile')) text += ` (${amp.holdTensile.toFixed(2)} MPa)`;
        text += '\n';
      }
      
      if (selectedColumns.has('dropRank') || selectedColumns.has('dropTensile')) {
        text += `  Drop Test: `;
        if (selectedColumns.has('dropRank')) text += `Rank #${amp.dropRank}`;
        if (selectedColumns.has('dropTensile')) text += ` (${amp.dropCompressive.toFixed(2)} MPa)`;
        text += '\n';
      }
      
      if (selectedColumns.has('rectRank') || selectedColumns.has('rectTensile')) {
        text += `  Rect Stack: `;
        if (selectedColumns.has('rectRank')) text += `Rank #${amp.rectRank}`;
        if (selectedColumns.has('rectTensile')) text += ` (${amp.rectTensile.toFixed(2)} MPa)`;
        if (selectedColumns.has('rectLoad')) text += ` Load: ${amp.rectLoad.toFixed(2)} N`;
        if (selectedColumns.has('rectFoS')) text += ` FoS: ${amp.rectFoS.toFixed(2)}`;
        text += '\n';
      }
      
      if (selectedColumns.has('hexRank') || selectedColumns.has('hexTensile')) {
        text += `  Hex Stack: `;
        if (selectedColumns.has('hexRank')) text += `Rank #${amp.hexRank}`;
        if (selectedColumns.has('hexTensile')) text += ` (${amp.hexTensile.toFixed(2)} MPa)`;
        if (selectedColumns.has('hexLoad')) text += ` Load: ${amp.hexLoad.toFixed(2)} N`;
        if (selectedColumns.has('hexFoS')) text += ` FoS: ${amp.hexFoS.toFixed(2)}`;
        text += '\n';
      }
      
      text += '\n';
    });
    
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}


/* -------------------------------------------------------------
   11.  Initialization
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
  
  // Initialize download manager
  const downloadManager = new DownloadManager();
  
  attachListeners();
  onControlChange();
});

/* -------------------------------------------------------------
   COMPLETE ASTM Ranking System with Simplified Display
   Add this entire code to the END of your script.js file
------------------------------------------------------------- */

// Store the original displayRankingTable function
window.displayRankingTableOriginal = displayRankingTable;

// ASTM Ranking System Class
class ASTMRankingSystem {
  constructor() {
    this.config = {
      outlierDetection: {
        method: 'grubbs',
        significanceLevel: 0.05,
        maxIterations: 5
      },
      interpolation: {
        minDataPoints: 3
      },
      ranking: {
        weights: {
          rectTensile: 0.20,
          hexTensile: 0.20,
          holdTensile: 0.25,
          dropCompressive: 0.25,
          volumeEfficiency: 0.10
        }
      },
      safetyFactors: {
        minSampleSize: 3,
        interpolated: 1.15,
        extrapolated: 1.25
      }
    };
  }

  // Main ranking function
  calculateRankings(rawRows, selectedAmphorae) {
    if (!selectedAmphorae || !selectedAmphorae.length) return [];
    
    const preparedData = this.prepareData(rawRows, selectedAmphorae);
    const processedData = this.processAllTestTypes(preparedData);
    const completeAmphorae = this.filterCompleteAmphorae(processedData);
    
    if (completeAmphorae.length === 0) return [];
    
    const referencePoints = this.findReferencePoints(processedData);
    const comparisonData = this.createComparisonMatrix(
      processedData, 
      completeAmphorae, 
      referencePoints
    );
    const rankings = this.applyTOPSIS(comparisonData);
    
    this.calculateSubRankings(rankings, processedData);
    this.addQualityMetrics(rankings, processedData);
    
    return rankings;
  }

  prepareData(rawRows, selectedAmphorae) {
    const data = {
      stack: { rect: {}, hex: {} },
      hold: {},
      drop: {}
    };
    
    rawRows.forEach(row => {
      const amphora = this.normalizeAmphora(row[this.AMPH_COL(row)]);
      const baseTest = this.baseTest(row.Test);
      
      if (!selectedAmphorae.some(a => this.normalizeAmphora(a) === amphora)) {
        return;
      }
      
      if (baseTest === 'Stack') {
        const pattern = this.patternOf(row.Test).toLowerCase();
        if (!data.stack[pattern][amphora]) {
          data.stack[pattern][amphora] = [];
        }
        data.stack[pattern][amphora].push(this.extractStackData(row));
      } else if (baseTest === 'Hold') {
        if (!data.hold[amphora]) {
          data.hold[amphora] = [];
        }
        data.hold[amphora].push(this.extractHoldData(row));
      } else if (baseTest === 'Drop') {
        if (!data.drop[amphora]) {
          data.drop[amphora] = [];
        }
        data.drop[amphora].push(this.extractDropData(row));
      }
    });
    
    return data;
  }

  // In the ASTMRankingSystem class, replace the processAllTestTypes method with this enhanced version:

  processAllTestTypes(data) {
    // First pass: find the minimum sample size across all tests
    let minSampleSize = Infinity;
    
    // Check stack tests
    ['rect', 'hex'].forEach(pattern => {
      Object.entries(data.stack[pattern]).forEach(([amphora, samples]) => {
        if (samples && samples.length > 0) {
          minSampleSize = Math.min(minSampleSize, samples.length);
        }
      });
    });
    
    // Check hold tests
    Object.entries(data.hold).forEach(([amphora, samples]) => {
      if (samples && samples.length > 0) {
        minSampleSize = Math.min(minSampleSize, samples.length);
      }
    });
    
    // Check drop tests
    Object.entries(data.drop).forEach(([amphora, samples]) => {
      if (samples && samples.length > 0) {
        minSampleSize = Math.min(minSampleSize, samples.length);
      }
    });
    
    // Ensure we have at least 3 samples for statistical validity
    minSampleSize = Math.max(minSampleSize, 3);
    
    console.log(`Normalized outlier detection using n=${minSampleSize} (smallest dataset size)`);
    
    // Second pass: process with normalized sample size
    const processed = {
      stack: { rect: {}, hex: {} },
      hold: {},
      drop: {}
    };
    
    // Process stack tests
    ['rect', 'hex'].forEach(pattern => {
      Object.entries(data.stack[pattern]).forEach(([amphora, samples]) => {
        processed.stack[pattern][amphora] = this.processSamples(samples, 'stack', minSampleSize);
      });
    });
    
    // Process hold tests
    Object.entries(data.hold).forEach(([amphora, samples]) => {
      processed.hold[amphora] = this.processSamples(samples, 'hold', minSampleSize);
    });
    
    // Process drop tests
    Object.entries(data.drop).forEach(([amphora, samples]) => {
      processed.drop[amphora] = this.processSamples(samples, 'drop', minSampleSize);
    });
    
    return processed;
  }

  // Update processSamples to accept maxSampleSize parameter
  processSamples(samples, testType, maxSampleSize = null) {
    if (!samples || samples.length === 0) {
      return { valid: false, sampleSize: 0 };
    }
    
    // If we have more samples than maxSampleSize, select a subset
    let samplesForOutlierDetection = samples;
    if (maxSampleSize && samples.length > maxSampleSize) {
      // Option 1: Take the most recent samples
      // samplesForOutlierDetection = samples.slice(-maxSampleSize);
      
      // Option 2: Take evenly distributed samples
      samplesForOutlierDetection = this.selectEvenlyDistributed(samples, maxSampleSize);
      
      // Option 3: Random sampling (less preferred for reproducibility)
      // samplesForOutlierDetection = this.randomSample(samples, maxSampleSize);
    }
    
    // Remove outliers only from the subset
    const cleanSubset = this.removeOutliers(samplesForOutlierDetection, testType);
    
    // Identify which samples were kept after outlier removal
    const keptIndices = new Set();
    cleanSubset.forEach(cleanSample => {
      const index = samples.findIndex(s => 
        s.tensile === cleanSample.tensile && 
        s.load === cleanSample.load &&
        s.fos === cleanSample.fos
      );
      if (index !== -1) keptIndices.add(index);
    });
    
    // If we had to subset, apply the outlier detection results proportionally to the full dataset
    let cleanSamples;
    if (maxSampleSize && samples.length > maxSampleSize) {
      // Calculate outlier ratio from subset
      const outlierRatio = (samplesForOutlierDetection.length - cleanSubset.length) / samplesForOutlierDetection.length;
      
      // Apply similar ratio to full dataset
      const expectedCleanSize = Math.round(samples.length * (1 - outlierRatio));
      
      // Sort samples by their test values and remove extreme values
      const values = this.extractTestValues(samples, testType);
      const sortedIndices = values
        .map((v, i) => ({ value: v, index: i }))
        .sort((a, b) => a.value - b.value)
        .map(item => item.index);
      
      // Remove outliers from both ends
      const outliersToRemove = samples.length - expectedCleanSize;
      const removeFromEachEnd = Math.floor(outliersToRemove / 2);
      const removeFromStart = removeFromEachEnd;
      const removeFromEnd = outliersToRemove - removeFromStart;
      
      const outlierIndices = new Set([
        ...sortedIndices.slice(0, removeFromStart),
        ...sortedIndices.slice(-removeFromEnd)
      ]);
      
      cleanSamples = samples.filter((_, i) => !outlierIndices.has(i));
    } else {
      // If no subsetting needed, use standard outlier removal
      cleanSamples = cleanSubset;
    }
    
    // Calculate statistics
    const stats = this.calculateStatistics(cleanSamples);
    
    // Assess sample quality
    const quality = this.assessSampleQuality(cleanSamples.length);
    
    return {
      valid: true,
      originalSamples: samples,
      cleanSamples: cleanSamples,
      sampleSize: cleanSamples.length,
      statistics: stats,
      quality: quality,
      outlierCount: samples.length - cleanSamples.length,
      normalizedDetection: maxSampleSize && samples.length > maxSampleSize,
      detectionSampleSize: Math.min(samples.length, maxSampleSize || samples.length)
    };
  }

  // Helper method to select evenly distributed samples
  selectEvenlyDistributed(samples, n) {
    if (samples.length <= n) return samples;
    
    const result = [];
    const step = (samples.length - 1) / (n - 1);
    
    for (let i = 0; i < n; i++) {
      const index = Math.round(i * step);
      result.push(samples[index]);
    }
    
    return result;
  }

  // Alternative: Random sampling (if preferred)
  randomSample(samples, n) {
    if (samples.length <= n) return samples;
    
    const shuffled = [...samples].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  // Update the quality metrics to include normalization info
  addQualityMetrics(rankings, processedData) {
    rankings.forEach(ranking => {
      const amphora = ranking.amphora;
      const metrics = {
        rectQuality: this.getTestQuality(processedData.stack.rect[amphora]),
        hexQuality: this.getTestQuality(processedData.stack.hex[amphora]),
        holdQuality: this.getTestQuality(processedData.hold[amphora]),
        dropQuality: this.getTestQuality(processedData.drop[amphora]),
        // Add normalization indicators
        rectNormalized: processedData.stack.rect[amphora]?.normalizedDetection || false,
        hexNormalized: processedData.stack.hex[amphora]?.normalizedDetection || false,
        holdNormalized: processedData.hold[amphora]?.normalizedDetection || false,
        dropNormalized: processedData.drop[amphora]?.normalizedDetection || false
      };
      
      // Overall quality score
      const qualityScores = Object.values(metrics)
        .filter(v => typeof v === 'number' && v !== null);
      metrics.overall = qualityScores.length > 0 
        ? this.mean(qualityScores) 
        : 0;
      
      ranking.qualityMetrics = metrics;
    });
  }

  processSamples(samples, testType) {
    if (!samples || samples.length === 0) {
      return { valid: false, sampleSize: 0 };
    }
    
    const cleanSamples = this.removeOutliers(samples, testType);
    const stats = this.calculateStatistics(cleanSamples);
    const quality = this.assessSampleQuality(cleanSamples.length);
    
    return {
      valid: true,
      originalSamples: samples,
      cleanSamples: cleanSamples,
      sampleSize: cleanSamples.length,
      statistics: stats,
      quality: quality,
      outlierCount: samples.length - cleanSamples.length
    };
  }

  removeOutliers(samples, testType) {
    let cleanSamples = [...samples];
    let iterations = 0;
    
    while (iterations < this.config.outlierDetection.maxIterations) {
      if (cleanSamples.length < 3) break;
      
      const values = this.extractTestValues(cleanSamples, testType);
      const result = this.grubbsTest(values);
      
      if (result.outlierFound) {
        cleanSamples.splice(result.outlierIndex, 1);
      } else {
        break;
      }
      iterations++;
    }
    
    return cleanSamples;
  }

  grubbsTest(values) {
    const n = values.length;
    if (n < 3) return { outlierFound: false };
    
    const mean = this.mean(values);
    const stdDev = this.stdDev(values, mean);
    
    if (stdDev === 0) return { outlierFound: false };
    
    let maxG = 0;
    let maxIndex = -1;
    
    values.forEach((value, i) => {
      const g = Math.abs(value - mean) / stdDev;
      if (g > maxG) {
        maxG = g;
        maxIndex = i;
      }
    });
    
    const criticalValue = this.grubbsCriticalValue(n, this.config.outlierDetection.significanceLevel);
    
    return {
      outlierFound: maxG > criticalValue,
      outlierIndex: maxIndex,
      gStatistic: maxG,
      criticalValue: criticalValue
    };
  }

  calculateStatistics(samples) {
    if (samples.length === 0) {
      return { valid: false };
    }
    
    const values = samples.map(s => s.tensile || s.compressive || 0);
    const mean = this.mean(values);
    const stdDev = this.stdDev(values, mean);
    
    const sem = stdDev / Math.sqrt(samples.length);
    const tValue = this.tDistributionValue(samples.length - 1, 0.025);
    const ci95Lower = mean - tValue * sem;
    const ci95Upper = mean + tValue * sem;
    
    let bootstrap = null;
    if (samples.length < 10) {
      bootstrap = this.bootstrapConfidence(values);
    }
    
    return {
      valid: true,
      mean: mean,
      median: this.median(values),
      stdDev: stdDev,
      sem: sem,
      ci95: { lower: ci95Lower, upper: ci95Upper },
      bootstrap: bootstrap,
      min: Math.min(...values),
      max: Math.max(...values),
      cv: stdDev / mean
    };
  }

  findReferencePoints(processedData) {
    const refs = {
      rect: { load: 0, fos: 1.0 },
      hex: { load: 0, fos: 1.0 }
    };
    
    ['rect', 'hex'].forEach(pattern => {
      const loads = [];
      
      Object.values(processedData.stack[pattern]).forEach(ampData => {
        if (!ampData.valid) return;
        
        ampData.cleanSamples.forEach(sample => {
          if (sample.fos >= 0.9 && sample.fos <= 1.1) {
            loads.push({
              load: sample.load,
              fos: sample.fos,
              diff: Math.abs(sample.fos - 1.0)
            });
          }
        });
      });
      
      if (loads.length > 0) {
        loads.sort((a, b) => a.diff - b.diff);
        refs[pattern].load = this.mean(loads.slice(0, 5).map(l => l.load));
      } else {
        const safeLoads = [];
        Object.values(processedData.stack[pattern]).forEach(ampData => {
          if (!ampData.valid) return;
          const safeSamples = ampData.cleanSamples.filter(s => s.fos >= 1);
          if (safeSamples.length > 0) {
            safeLoads.push(Math.max(...safeSamples.map(s => s.load)));
          }
        });
        refs[pattern].load = safeLoads.length > 0 ? this.mean(safeLoads) : 1000;
      }
    });
    
    return refs;
  }

  createComparisonMatrix(processedData, amphorae, referencePoints) {
    const matrix = [];
    
    amphorae.forEach(amphora => {
      const row = {
        amphora: amphora,
        data: {}
      };
      
      ['rect', 'hex'].forEach(pattern => {
        const ampData = processedData.stack[pattern][amphora];
        if (ampData && ampData.valid) {
          const interpolated = this.interpolateToLoad(
            ampData.cleanSamples,
            referencePoints[pattern].load
          );
          
          row.data[`${pattern}Tensile`] = interpolated.tensile;
          row.data[`${pattern}Load`] = interpolated.load;
          row.data[`${pattern}FoS`] = interpolated.fos;
          row.data[`${pattern}Confidence`] = interpolated.confidence;
        }
      });
      
      const holdData = processedData.hold[amphora];
      if (holdData && holdData.valid) {
        row.data.holdTensile = holdData.statistics.mean;
        row.data.holdConfidence = this.calculateConfidence(holdData);
      }
      
      const dropData = processedData.drop[amphora];
      if (dropData && dropData.valid) {
        row.data.dropCompressive = dropData.statistics.mean;
        row.data.dropConfidence = this.calculateConfidence(dropData);
      }
      
      const volumeData = this.findVolumeData(amphora, processedData);
      if (volumeData) {
        row.data.volumeEfficiency = volumeData;
      }
      
      matrix.push(row);
    });
    
    return matrix;
  }

  interpolateToLoad(samples, targetLoad) {
    const sorted = samples.sort((a, b) => a.load - b.load);
    
    let lower = null;
    let upper = null;
    
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].load <= targetLoad) {
        lower = sorted[i];
      }
      if (sorted[i].load >= targetLoad && !upper) {
        upper = sorted[i];
      }
    }
    
    if (!lower && !upper) {
      return { tensile: 0, load: targetLoad, fos: 0, confidence: 0 };
    }
    
    if (!lower) {
      return {
        tensile: upper.tensile * this.config.safetyFactors.extrapolated,
        load: targetLoad,
        fos: upper.fos,
        confidence: 0.5
      };
    }
    
    if (!upper) {
      return {
        tensile: lower.tensile * this.config.safetyFactors.extrapolated,
        load: targetLoad,
        fos: lower.fos,
        confidence: 0.5
      };
    }
    
    const ratio = (targetLoad - lower.load) / (upper.load - lower.load);
    const tensile = lower.tensile + ratio * (upper.tensile - lower.tensile);
    const fos = lower.fos + ratio * (upper.fos - lower.fos);
    
    return {
      tensile: tensile * this.config.safetyFactors.interpolated,
      load: targetLoad,
      fos: fos,
      confidence: 0.8
    };
  }

  applyTOPSIS(comparisonMatrix) {
    const criteria = [
      { name: 'rectTensile', type: 'cost', weight: this.config.ranking.weights.rectTensile },
      { name: 'hexTensile', type: 'cost', weight: this.config.ranking.weights.hexTensile },
      { name: 'holdTensile', type: 'cost', weight: this.config.ranking.weights.holdTensile },
      { name: 'dropCompressive', type: 'cost', weight: this.config.ranking.weights.dropCompressive },
      { name: 'volumeEfficiency', type: 'benefit', weight: this.config.ranking.weights.volumeEfficiency }
    ];
    
    const normalized = this.normalizeMatrix(comparisonMatrix, criteria);
    const weighted = this.applyWeights(normalized, criteria);
    const { positive, negative } = this.findIdealSolutions(weighted, criteria);
    
    const rankings = weighted.map(row => {
      let dPositive = 0;
      let dNegative = 0;
      
      criteria.forEach(criterion => {
        const value = row.weighted[criterion.name] || 0;
        dPositive += Math.pow(value - positive[criterion.name], 2);
        dNegative += Math.pow(value - negative[criterion.name], 2);
      });
      
      dPositive = Math.sqrt(dPositive);
      dNegative = Math.sqrt(dNegative);
      
      const closeness = dNegative / (dPositive + dNegative + 1e-10);
      
      return {
        name: row.amphora,
        amphora: row.amphora,
        closeness: closeness,
        dPositive: dPositive,
        dNegative: dNegative,
        rectTensile: row.data.rectTensile || 0,
        rectLoad: row.data.rectLoad || 0,
        rectFoS: row.data.rectFoS || 0,
        hexTensile: row.data.hexTensile || 0,
        hexLoad: row.data.hexLoad || 0,
        hexFoS: row.data.hexFoS || 0,
        holdTensile: row.data.holdTensile || 0,
        dropCompressive: row.data.dropCompressive || 0,
        volume: row.data.volume || 0
      };
    });
    
    rankings.sort((a, b) => b.closeness - a.closeness);
    
    rankings.forEach((item, index) => {
      item.overallRank = index + 1;
      item.overallScore = item.closeness;
    });
    
    return rankings;
  }

  normalizeMatrix(matrix, criteria) {
    const normalized = [];
    
    const factors = {};
    criteria.forEach(criterion => {
      const values = matrix
        .map(row => row.data[criterion.name] || 0)
        .filter(v => v > 0);
      
      if (values.length > 0) {
        factors[criterion.name] = Math.sqrt(
          values.reduce((sum, v) => sum + v * v, 0)
        );
      } else {
        factors[criterion.name] = 1;
      }
    });
    
    matrix.forEach(row => {
      const normRow = {
        amphora: row.amphora,
        data: row.data,
        normalized: {},
        weighted: {}
      };
      
      criteria.forEach(criterion => {
        const value = row.data[criterion.name] || 0;
        normRow.normalized[criterion.name] = factors[criterion.name] > 0 
          ? value / factors[criterion.name] 
          : 0;
      });
      
      normalized.push(normRow);
    });
    
    return normalized;
  }

  applyWeights(normalized, criteria) {
    normalized.forEach(row => {
      criteria.forEach(criterion => {
        row.weighted[criterion.name] = 
          row.normalized[criterion.name] * criterion.weight;
      });
    });
    
    return normalized;
  }

  findIdealSolutions(weighted, criteria) {
    const positive = {};
    const negative = {};
    
    criteria.forEach(criterion => {
      const values = weighted
        .map(row => row.weighted[criterion.name] || 0)
        .filter(v => !isNaN(v));
      
      if (values.length === 0) {
        positive[criterion.name] = 0;
        negative[criterion.name] = 0;
        return;
      }
      
      if (criterion.type === 'benefit') {
        positive[criterion.name] = Math.max(...values);
        negative[criterion.name] = Math.min(...values);
      } else {
        positive[criterion.name] = Math.min(...values);
        negative[criterion.name] = Math.max(...values);
      }
    });
    
    return { positive, negative };
  }

  calculateSubRankings(rankings, processedData) {
    const rectValid = rankings.filter(r => r.rectTensile > 0);
    rectValid.sort((a, b) => a.rectTensile - b.rectTensile);
    rectValid.forEach((item, index) => {
      const ranking = rankings.find(r => r.amphora === item.amphora);
      if (ranking) ranking.rectRank = index + 1;
    });
    
    const hexValid = rankings.filter(r => r.hexTensile > 0);
    hexValid.sort((a, b) => a.hexTensile - b.hexTensile);
    hexValid.forEach((item, index) => {
      const ranking = rankings.find(r => r.amphora === item.amphora);
      if (ranking) ranking.hexRank = index + 1;
    });
    
    const holdValid = rankings.filter(r => r.holdTensile > 0);
    holdValid.sort((a, b) => a.holdTensile - b.holdTensile);
    holdValid.forEach((item, index) => {
      const ranking = rankings.find(r => r.amphora === item.amphora);
      if (ranking) ranking.holdRank = index + 1;
    });
    
    const dropValid = rankings.filter(r => r.dropCompressive > 0);
    dropValid.sort((a, b) => a.dropCompressive - b.dropCompressive);
    dropValid.forEach((item, index) => {
      const ranking = rankings.find(r => r.amphora === item.amphora);
      if (ranking) ranking.dropRank = index + 1;
    });
  }

  addQualityMetrics(rankings, processedData) {
    rankings.forEach(ranking => {
      const amphora = ranking.amphora;
      const metrics = {
        rectQuality: this.getTestQuality(processedData.stack.rect[amphora]),
        hexQuality: this.getTestQuality(processedData.stack.hex[amphora]),
        holdQuality: this.getTestQuality(processedData.hold[amphora]),
        dropQuality: this.getTestQuality(processedData.drop[amphora])
      };
      
      const qualityScores = Object.values(metrics).filter(q => q !== null);
      metrics.overall = qualityScores.length > 0 
        ? this.mean(qualityScores) 
        : 0;
      
      ranking.qualityMetrics = metrics;
    });
  }

  getTestQuality(testData) {
    if (!testData || !testData.valid) return null;
    
    const quality = testData.quality;
    const stats = testData.statistics;
    
    const sizeScore = quality.reliability;
    const cvScore = stats.cv < 0.1 ? 1.0 : (stats.cv < 0.2 ? 0.8 : 0.6);
    const outlierScore = 1 - (testData.outlierCount / testData.originalSamples.length);
    
    return (sizeScore * 0.5 + cvScore * 0.3 + outlierScore * 0.2);
  }

  // Statistical helper functions
  mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
  
  stdDev(values, mean) {
    if (values.length <= 1) return 0;
    const variance = values.reduce((sum, val) => 
      sum + Math.pow(val - mean, 2), 0
    ) / (values.length - 1);
    return Math.sqrt(variance);
  }
  
  grubbsCriticalValue(n, alpha) {
    const criticalValues = {
      3: { 0.05: 1.155, 0.01: 1.155 },
      4: { 0.05: 1.481, 0.01: 1.496 },
      5: { 0.05: 1.715, 0.01: 1.764 },
      6: { 0.05: 1.887, 0.01: 1.973 },
      7: { 0.05: 2.020, 0.01: 2.139 },
      8: { 0.05: 2.126, 0.01: 2.274 },
      9: { 0.05: 2.215, 0.01: 2.387 },
      10: { 0.05: 2.290, 0.01: 2.482 },
      15: { 0.05: 2.549, 0.01: 2.806 },
      20: { 0.05: 2.709, 0.01: 3.001 },
      30: { 0.05: 2.908, 0.01: 3.236 }
    };
    
    const ns = Object.keys(criticalValues).map(Number).sort((a, b) => a - b);
    let closest = ns[0];
    for (const nVal of ns) {
      if (nVal <= n) closest = nVal;
    }
    
    return criticalValues[closest][alpha] || 2.0;
  }
  
  tDistributionValue(df, alpha) {
    const tValues = {
      1: { 0.05: 12.706, 0.025: 25.452, 0.01: 63.657 },
      2: { 0.05: 4.303, 0.025: 6.205, 0.01: 9.925 },
      3: { 0.05: 3.182, 0.025: 4.177, 0.01: 5.841 },
      4: { 0.05: 2.776, 0.025: 3.495, 0.01: 4.604 },
      5: { 0.05: 2.571, 0.025: 3.163, 0.01: 4.032 },
      10: { 0.05: 2.228, 0.025: 2.634, 0.01: 3.169 },
      20: { 0.05: 2.086, 0.025: 2.423, 0.01: 2.845 },
      30: { 0.05: 2.042, 0.025: 2.360, 0.01: 2.750 },
      60: { 0.05: 2.000, 0.025: 2.299, 0.01: 2.660 },
      120: { 0.05: 1.980, 0.025: 2.270, 0.01: 2.617 }
    };
    
    const dfs = Object.keys(tValues).map(Number).sort((a, b) => a - b);
    let closest = dfs[0];
    for (const dfVal of dfs) {
      if (dfVal <= df) closest = dfVal;
    }
    
    return tValues[closest][alpha] || 2.0;
  }
  
  bootstrapConfidence(values, iterations = 1000) {
    if (values.length < 3) return null;
    
    const means = [];
    for (let i = 0; i < iterations; i++) {
      const sample = [];
      for (let j = 0; j < values.length; j++) {
        sample.push(values[Math.floor(Math.random() * values.length)]);
      }
      means.push(this.mean(sample));
    }
    
    means.sort((a, b) => a - b);
    return {
      mean: this.mean(means),
      ci95Lower: means[Math.floor(iterations * 0.025)],
      ci95Upper: means[Math.floor(iterations * 0.975)]
    };
  }
  
  assessSampleQuality(n) {
    return {
      sampleSize: n,
      adequate: n >= this.config.safetyFactors.minSampleSize,
      reliability: this.calculateSampleReliability(n),
      method: n < 8 ? 'bootstrap' : 'parametric',
      confidenceLevel: n >= 30 ? 0.95 : (n >= 10 ? 0.90 : 0.80)
    };
  }
  
  calculateSampleReliability(n) {
    if (n >= 30) return 1.0;
    if (n >= 20) return 0.95;
    if (n >= 10) return 0.85;
    if (n >= 5) return 0.70;
    if (n >= 3) return 0.50;
    return 0.30;
  }
  
  calculateConfidence(testData) {
    if (!testData || !testData.valid) return 0;
    
    const reliability = testData.quality.reliability;
    const cv = testData.statistics.cv || 0;
    const outlierRatio = testData.outlierCount / testData.originalSamples.length;
    
    const cvFactor = cv < 0.1 ? 1.0 : (cv < 0.2 ? 0.8 : 0.6);
    const outlierFactor = 1 - outlierRatio;
    
    return reliability * 0.6 + cvFactor * 0.3 + outlierFactor * 0.1;
  }
  
  // Data extraction helpers
  extractStackData(row) {
    return {
      load: row['Load (N)'] || 0,
      tensile: row['Max Tensile (MPa)'] || 0,
      fos: row['Factor of Safety'] || 0,
      layers: row['n (layers)'] || 0,
      width: row['w (# pot)'] || 0,
      length: row['l (# pot)'] || 0,
      volume: row['Internal Volume (mm^3)'] || 0
    };
  }
  
  extractHoldData(row) {
    return {
      tensile: row['Max Tensile (MPa)'] || 0,
      fillType: this.getFillType(row.Test)
    };
  }
  
  extractDropData(row) {
    return {
      compressive: row['Max Compressive (MPa)'] || row['Max Tensile (MPa)'] || 0,
      height: row['Height (m)'] || 0
    };
  }
  
  extractTestValues(samples, testType) {
    if (testType === 'stack' || testType === 'hold') {
      return samples.map(s => s.tensile || 0);
    } else if (testType === 'drop') {
      return samples.map(s => s.compressive || 0);
    }
    return [];
  }
  
  findVolumeData(amphora, processedData) {
    const sources = [
      processedData.stack.rect[amphora],
      processedData.stack.hex[amphora],
      processedData.hold[amphora]
    ];
    
    for (const source of sources) {
      if (source && source.originalSamples && source.originalSamples.length > 0) {
        const sample = source.originalSamples[0];
        if (sample.volume) return sample.volume / 1e6;
      }
    }
    
    return null;
  }
  
  filterCompleteAmphorae(processedData) {
    const amphorae = new Set();
    
    Object.keys(processedData.stack.rect).forEach(a => amphorae.add(a));
    Object.keys(processedData.stack.hex).forEach(a => amphorae.add(a));
    Object.keys(processedData.hold).forEach(a => amphorae.add(a));
    Object.keys(processedData.drop).forEach(a => amphorae.add(a));
    
    return Array.from(amphorae).filter(amphora => {
      const hasRect = processedData.stack.rect[amphora]?.valid;
      const hasHex = processedData.stack.hex[amphora]?.valid;
      const hasHold = processedData.hold[amphora]?.valid;
      const hasDrop = processedData.drop[amphora]?.valid;
      
      return hasRect && hasHex && hasHold && hasDrop;
    });
  }
  
  // Utility functions
  normalizeAmphora(name) {
    if (!name) return '';
    return String(name).replace(/[_\s]+(rect|hex)$/i, '').trim();
  }
  
  baseTest(str) {
    if (!str) return '';
    return String(str).split(/[_(]/)[0].trim();
  }
  
  patternOf(testStr) {
    if (!testStr) return 'unknown';
    testStr = String(testStr);
    return /\bhex\b/i.test(testStr) ? 'Hex' :
           /\brect\b/i.test(testStr) ? 'Rect' : 'unknown';
  }
  
  getFillType(testName) {
    if (!testName) return 'Empty';
    const test = String(testName).toLowerCase();
    if (test.includes('wine')) return 'Wine';
    if (test.includes('oil')) return 'Oil';
    return 'Empty';
  }
  
  AMPH_COL(row) {
    if (!row) return '';
    if (row.hasOwnProperty('Amphora')) return 'Amphora';
    if (row.hasOwnProperty('Amphorae')) return 'Amphorae';
    const keys = Object.keys(row);
    const amphoraKey = keys.find(k => k && k.toLowerCase().startsWith('amphora'));
    return amphoraKey || '';
  }
}

// Integration function
function calculateRankingsASTM() {
  const selected = getSelectedAmphorae();
  if (!selected || !selected.length) return [];
  
  const rankingSystem = new ASTMRankingSystem();
  const rankings = rankingSystem.calculateRankings(rawRows, selected);
  
  const formattedRankings = rankings.map(r => ({
    name: r.name || r.amphora,
    overallRank: r.overallRank,
    overallScore: r.overallScore,
    rectRank: r.rectRank || 0,
    rectTensile: r.rectTensile || 0,
    rectLoad: r.rectLoad || 0,
    rectFoS: r.rectFoS || 0,
    hexRank: r.hexRank || 0,
    hexTensile: r.hexTensile || 0,
    hexLoad: r.hexLoad || 0,
    hexFoS: r.hexFoS || 0,
    holdRank: r.holdRank || 0,
    holdTensile: r.holdTensile || 0,
    dropRank: r.dropRank || 0,
    dropCompressive: r.dropCompressive || 0,
    volume: r.volume || 0,
    qualityScore: r.qualityMetrics ? r.qualityMetrics.overall : 0,
    confidence: {
      rect: r.qualityMetrics ? r.qualityMetrics.rectQuality : 0,
      hex: r.qualityMetrics ? r.qualityMetrics.hexQuality : 0,
      hold: r.qualityMetrics ? r.qualityMetrics.holdQuality : 0,
      drop: r.qualityMetrics ? r.qualityMetrics.dropQuality : 0
    }
  }));
  
  return formattedRankings;
}

// Override displayRankingTable with simplified version
displayRankingTable = function() {
  const useASTM = !window.disableASTM;
  
  if (useASTM) {
    const rankings = calculateRankingsASTM();
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
          <br><small>ASTM E178 outlier detection and statistical analysis applied.</small>
        </div>`;
      return;
    }
    
    // Apply current sort
    const sortedRankings = [...rankings].sort((a, b) => {
      let aVal, bVal;
      
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
    
    const safeFormat = (value, decimals = 2) => {
      if (value === undefined || value === null || isNaN(value) || value === 0) {
        return "–";
      }
      return Number(value).toFixed(decimals);
    };
    
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
    
    // Simplified ASTM notice
    html += `
      <div class="alert alert-success mb-3" style="font-size: 0.9em;">
        <strong>ASTM-Compliant Analysis Applied:</strong>
        Outlier detection (ASTM E178), interpolation to reference loads, and TOPSIS multi-criteria ranking
      </div>
    `;
    
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
    
    // Build table
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
    
    // In your displayRankingTable function, find the section where table rows are built
// (look for "// Table rows" comment and the sortedRankings.forEach loop)
// Replace that entire section with this:

    // Table rows
    sortedRankings.forEach((amp) => {
      html += `<tr>`;
      
      if (selectedColumns.has("overallRank")) {
        html += `<td><strong>${amp.overallRank || '–'}</strong></td>`;
      }
      
      html += `<td>${amp.name || '–'}</td>`;
      
      // Hold columns
      if (selectedColumns.has("holdRank")) {
        html += `<td>${amp.holdRank ? '#' + amp.holdRank : '–'}</td>`;
      }
      if (selectedColumns.has("holdTensile")) {
        html += `<td>${safeFormat(amp.holdTensile)}</td>`; // Removed " MPa"
      }
      
      // Drop columns
      if (selectedColumns.has("dropRank")) {
        html += `<td>${amp.dropRank ? '#' + amp.dropRank : '–'}</td>`;
      }
      if (selectedColumns.has("dropTensile")) {
        html += `<td>${safeFormat(amp.dropCompressive)}</td>`; // Removed " MPa"
      }
      
      // Rect columns
      if (selectedColumns.has("rectRank")) {
        html += `<td>${amp.rectRank ? '#' + amp.rectRank : '–'}</td>`;
      }
      if (selectedColumns.has("rectTensile")) {
        html += `<td>${safeFormat(amp.rectTensile)}</td>`; // Removed " MPa"
      }
      if (selectedColumns.has("rectLoad")) {
        html += `<td>${safeFormat(amp.rectLoad)}</td>`; // Removed " N"
      }
      if (selectedColumns.has("rectFoS")) {
        html += `<td>${safeFormat(amp.rectFoS)}</td>`;
      }
      
      // Hex columns
      if (selectedColumns.has("hexRank")) {
        html += `<td>${amp.hexRank ? '#' + amp.hexRank : '–'}</td>`;
      }
      if (selectedColumns.has("hexTensile")) {
        html += `<td>${safeFormat(amp.hexTensile)}</td>`; // Removed " MPa"
      }
      if (selectedColumns.has("hexLoad")) {
        html += `<td>${safeFormat(amp.hexLoad)}</td>`; // Removed " N"
      }
      if (selectedColumns.has("hexFoS")) {
        html += `<td>${safeFormat(amp.hexFoS)}</td>`;
      }
      
      html += `</tr>`;
    });
    
    html += `</tbody></table>`;
    
    tableEl.innerHTML = html;
    
    // Add hover listeners for 3D models
    if (modelViewer) {
      const tableRows = tableEl.querySelectorAll('tbody tr');
      tableRows.forEach((row, index) => {
        const nameCell = row.querySelector('td:nth-child(' + (selectedColumns.has("overallRank") ? '2' : '1') + ')');
        if (nameCell) {
          nameCell.style.cursor = 'pointer';
          nameCell.addEventListener('mouseenter', (e) => {
            const ampData = sortedRankings[index];
            if (ampData) {
              modelViewer.show(ampData.name, e.clientX - 10, e.clientY, null);
            }
          });
          nameCell.addEventListener('mouseleave', () => {
            modelViewer.hide();
          });
        }
      });
    }
  } else {
    window.displayRankingTableOriginal();
  }
};

window.calculateRankingsASTM = calculateRankingsASTM;
window.ASTMRankingSystem = ASTMRankingSystem;

console.log('ASTM Ranking System loaded (simplified display). To disable: window.disableASTM = true');