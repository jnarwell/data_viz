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
  // Ensure we have a string to work with
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

// Get fill type from test name
const getFillType = (testName) => {
  // Ensure we have a string to work with
  if (testName === null || testName === undefined) return "Empty";
  const test = String(testName).toLowerCase();
  if (test.includes("wine")) return "Wine";
  if (test.includes("oil")) return "Oil";
  return "Empty";
};

// Get effective mass based on fill type - for oil and wine, add empty mass
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
   3.  Axis + Pattern Logic
------------------------------------------------------------- */
function toggleUIControls() {
  const test = getTest();
  const isRanking = test === "Ranking";
  
  // Show/hide stack pattern UI
  const stackPatternWrap = document.getElementById("stackPatternWrap");
  if (stackPatternWrap) {
    stackPatternWrap.classList.toggle("d-none", test !== "Stack");
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
  // Handle consolidated "Mass" option
  if (xKey === "Mass") {
    const test = baseTest(row?.Test || "");
    if (test === "Hold") {
      const fillType = getFillType(row?.Test);
      return getEffectiveMass(row, fillType);
    } else {
      // For other tests, use the selected mass basis
      const fillType = getMass() === "Mass (Wine) (kg)" ? "Wine" : 
                      (getMass() === "Mass (Oil)" || getMass() === "Mass (Oil) (kg)") ? "Oil" : "Empty";
      return getEffectiveMass(row, fillType);
    }
  }

  // For Hold tests with specific mass columns
  if (baseTest(row?.Test || "") === "Hold" && xKey?.includes("Mass")) {
    const fillType = getFillType(row?.Test);
    return getEffectiveMass(row, fillType);
  }

  // For other specific mass columns
  const massBasis = getMass();
  if (xKey?.includes("Mass")) {
    // For non-Hold tests, apply the filled mass logic
    if (massBasis === "Mass (Wine) (kg)") {
      return getEffectiveMass(row, "Wine");
    } else if (massBasis === "Mass (Oil) (kg)" || massBasis === "Mass (Oil)") {
      return getEffectiveMass(row, "Oil");
    }
    return row?.[massBasis] || 0;
  }

  const test = row?.Test?.toLowerCase() || "";
  const n = row["n (layers)"], w = row["w (# pot)"], l = row["l (# pot)"];

  let base = row?.[xKey];
  if (!Number.isFinite(base)) return null;

  if (xKey?.includes("Volume")) base = convertValue(base, xKey);
  const needsScaling = xKey?.includes("Volume");
  return needsScaling && n && w && l ? base * n * w * l : base;
}

function effectiveY(row, yKey) {
  // Handle consolidated "Mass" option
  if (yKey === "Mass") {
    const test = baseTest(row?.Test || "");
    if (test === "Hold") {
      const fillType = getFillType(row?.Test);
      return getEffectiveMass(row, fillType);
    } else {
      // For other tests, use the selected mass basis
      const fillType = getMass() === "Mass (Wine) (kg)" ? "Wine" : 
                      (getMass() === "Mass (Oil)" || getMass() === "Mass (Oil) (kg)") ? "Oil" : "Empty";
      return getEffectiveMass(row, fillType);
    }
  }

  // For Hold tests with specific mass columns
  if (baseTest(row?.Test || "") === "Hold" && yKey?.includes("Mass")) {
    const fillType = getFillType(row?.Test);
    return getEffectiveMass(row, fillType);
  }

  // For other specific mass columns
  const massBasis = getMass();
  if (yKey?.includes("Mass")) {
    // For non-Hold tests, apply the filled mass logic
    if (massBasis === "Mass (Wine) (kg)") {
      return getEffectiveMass(row, "Wine");
    } else if (massBasis === "Mass (Oil) (kg)" || massBasis === "Mass (Oil)") {
      return getEffectiveMass(row, "Oil");
    }
    return row?.[massBasis] || 0;
  }

  const test = row?.Test?.toLowerCase() || "";
  const n = row["n (layers)"], w = row["w (# pot)"], l = row["l (# pot)"];

  let base = row?.[yKey];
  if (!Number.isFinite(base)) return null;

  if (yKey?.includes("Volume")) base = convertValue(base, yKey);
  const needsScaling = yKey?.includes("Volume");
  return needsScaling && n && w && l ? base * n * w * l : base;
}

/* -------------------------------------------------------------
   4.  Build UI
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
  // Get all columns that have numeric values
  const allCols = Object.keys(rawRows[0] || {}).filter((col) =>
    rawRows.some((r) => Number.isFinite(r[col]) && r[col] !== 0)
  );
  
  // Filter out individual mass columns
  const massRegex = /^Mass\s*\((Empty|Wine|Oil)\)(\s*\(kg\))?$/;
  const filteredCols = allCols.filter(col => !massRegex.test(col));
  
  // Create prioritized x-axis columns
  const xAxisPriority = [
    "Load (N)",
    "Mass", // Our consolidated Mass option
    "Height (m)"
  ];
  
  // Create prioritized y-axis columns
  const yAxisPriority = [
    "Max Tensile (MPa)",
    "Max Compressive (MPa)",
    "Factor of Safety"
  ];
  
  // Create final ordered arrays by priority
  let xAxisCols = [...xAxisPriority];
  let yAxisCols = [...yAxisPriority];
  
  // Add the consolidated "Mass" option if not already in priority list
  // and if mass columns exist
  if (!xAxisCols.includes("Mass") && allCols.some(col => massRegex.test(col))) {
    xAxisCols.push("Mass");
  }
  
  // Add remaining columns that aren't already in the prioritized lists
  filteredCols.forEach(col => {
    if (!xAxisCols.includes(col)) {
      xAxisCols.push(col);
    }
    if (!yAxisCols.includes(col)) {
      yAxisCols.push(col);
    }
  });
  
  // Remove any priority columns that don't exist in the actual data
  xAxisCols = xAxisCols.filter(col => col === "Mass" || filteredCols.includes(col));
  yAxisCols = yAxisCols.filter(col => col === "Mass" || filteredCols.includes(col));
  
  // Determine default x-axis based on test type
  const currentTest = getTest();
  let defaultXAxis = "Load (N)";
  
  if (currentTest === "Drop") {
    defaultXAxis = "Height (m)";
  } else if (currentTest === "Hold") {
    // For Hold test, use Mass as default if available
    defaultXAxis = xAxisCols.includes("Mass") ? "Mass" : "Load (N)";
  }
  
  // Set fallbacks if the defaults don't exist in the data
  if (!xAxisCols.includes(defaultXAxis)) {
    defaultXAxis = xAxisCols[0];
  }
  
  let defaultYAxis = "Max Tensile (MPa)";
  if (!yAxisCols.includes(defaultYAxis)) {
    defaultYAxis = yAxisCols[0];
  }
  
  // Build the dropdowns with the ordered arrays
  buildSelect("xAxis", xAxisCols, defaultXAxis);
  buildSelect("yAxis", yAxisCols, defaultYAxis);
}

/* -------------------------------------------------------------
   5.  Rankings Table Functions 
------------------------------------------------------------- */
function calculateRankings() {
  const selected = getSelectedAmphorae();
  if (!selected || !selected.length) return [];
  
  // Ensure each amphora has all required data
  const completeAmphorae = selected.filter(amphora => {
    if (!amphora) return false;
    const normalizedName = normalizeAmphora(amphora);
    
    // Minimum required data: data in both stack arrangements, hold, and drop
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
  
  // Filter stack data by arrangement
  const stackRows = rawRows.filter(r => baseTest(r.Test) === "Stack");
  const rectRows = stackRows.filter(r => patternOf(r.Test) === "Rect");
  const hexRows = stackRows.filter(r => patternOf(r.Test) === "Hex");
  
  // Filter to only include selected amphorae - more safely
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
  
  // Find safe rows (FoS >= 1)
  const safeRectRows = selectedRectRows.filter(r => (r["Factor of Safety"] || 0) >= 1);
  const safeHexRows = selectedHexRows.filter(r => (r["Factor of Safety"] || 0) >= 1);
  
  // Rest of the function remains the same...
  // [rest of the calculateRankings function]
  
  // Helper function to find reference load
  function findReferenceLoad(rows) {
    // Group by amphora and find points with FoS closest to 1
    const amphoraeClosestFoS = {};
    
    rows.forEach(row => {
      const amp = normalizeAmphora(row[AMPH_COL(row)]);
      const fos = row["Factor of Safety"] || 0;
      const load = row["Load (N)"] || 0;
      
      // Skip invalid data
      if (fos <= 0 || load <= 0) return;
      
      const diffFromFoS1 = Math.abs(fos - 1);
      
      if (!amphoraeClosestFoS[amp] || diffFromFoS1 < amphoraeClosestFoS[amp].diffFromFoS1) {
        amphoraeClosestFoS[amp] = { load, fos, diffFromFoS1 };
      }
    });
    
    // Find max load among these points
    let maxLoad = 0;
    Object.values(amphoraeClosestFoS).forEach(point => {
      if (point.load > maxLoad) {
        maxLoad = point.load;
      }
    });
    
    return maxLoad;
  }
  
  // Find reference loads for both arrangements
  refRectLoad = findReferenceLoad(safeRectRows);
  refHexLoad = findReferenceLoad(safeHexRows);
  
  // If no safe rows found, use max load available among selected amphorae
  if (refRectLoad === 0) {
    refRectLoad = Math.max(...selectedRectRows.map(r => r["Load (N)"] || 0).filter(v => v > 0), 0);
  }
  
  if (refHexLoad === 0) {
    refHexLoad = Math.max(...selectedHexRows.map(r => r["Load (N)"] || 0).filter(v => v > 0), 0);
  }
  
  // Initialize data structure for each amphora
  const amphoraeData = {};
  completeAmphorae.forEach(amp => {
    const normalizedName = normalizeAmphora(amp);
    amphoraeData[normalizedName] = {
      name: amp,
      // Rect metrics
      rectLoad: 0,
      rectFoS: 0,
      rectTensile: 0,
      // Hex metrics
      hexLoad: 0,
      hexFoS: 0,
      hexTensile: 0,
      // Hold metrics
      holdTensileValues: [],
      holdTensile: 0,
      // Drop metrics
      dropTensileValues: [],
      dropTensile: 0,
      // Internal volume
      volume: 0,
      // Rankings
      rectRank: 0,
      hexRank: 0,
      holdRank: 0,
      dropRank: 0,
      overallScore: 0,
      overallRank: 0
    };
  });
  
  // Helper function to find closest data point to reference load
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
  
  // Process rectangle arrangement data
  completeAmphorae.forEach(amp => {
    const normalizedName = normalizeAmphora(amp);
    
    // Find closest rect data point to reference load
    const rectRow = findClosestToRef(rectRows, refRectLoad, normalizedName);
    if (rectRow) {
      amphoraeData[normalizedName].rectLoad = rectRow["Load (N)"] || 0;
      amphoraeData[normalizedName].rectFoS = rectRow["Factor of Safety"] || 0;
      amphoraeData[normalizedName].rectTensile = rectRow["Max Tensile (MPa)"] || 0;
      amphoraeData[normalizedName].volume = (rectRow["Internal Volume (mm^3)"] || 0) / 1e6; // Convert to L
    }
    
    // Find closest hex data point to reference load
    const hexRow = findClosestToRef(hexRows, refHexLoad, normalizedName);
    if (hexRow) {
      amphoraeData[normalizedName].hexLoad = hexRow["Load (N)"] || 0;
      amphoraeData[normalizedName].hexFoS = hexRow["Factor of Safety"] || 0;
      amphoraeData[normalizedName].hexTensile = hexRow["Max Tensile (MPa)"] || 0;
    }
  });
  
  // Process hold data - calculate mean tensile stress
  const holdRows = rawRows.filter(r => baseTest(r.Test) === "Hold");
  holdRows.forEach(row => {
    const amp = normalizeAmphora(row[AMPH_COL(row)]);
    if (!amphoraeData[amp]) return;
    
    const tensile = row["Max Tensile (MPa)"] || 0;
    if (tensile <= 0) return;
    
    amphoraeData[amp].holdTensileValues.push(tensile);
  });
  
  // Calculate mean hold tensile for each amphora
  Object.values(amphoraeData).forEach(amp => {
    if (amp.holdTensileValues.length > 0) {
      const sum = amp.holdTensileValues.reduce((a, b) => a + b, 0);
      amp.holdTensile = sum / amp.holdTensileValues.length;
    }
  });
  
  // Process drop data - calculate mean tensile stress
  const dropRows = rawRows.filter(r => baseTest(r.Test) === "Drop");
  dropRows.forEach(row => {
    const amp = normalizeAmphora(row[AMPH_COL(row)]);
    if (!amphoraeData[amp]) return;
    
    const tensile = row["Max Tensile (MPa)"] || 0;
    if (tensile <= 0) return;
    
    amphoraeData[amp].dropTensileValues.push(tensile);
  });
  
  // Calculate mean drop tensile for each amphora
  Object.values(amphoraeData).forEach(amp => {
    if (amp.dropTensileValues.length > 0) {
      const sum = amp.dropTensileValues.reduce((a, b) => a + b, 0);
      amp.dropTensile = sum / amp.dropTensileValues.length;
    }
  });
  
  // Convert to array for ranking
  let results = Object.values(amphoraeData);
  
  // Filter amphorae with missing metrics
  results = results.filter(amp => 
    amp.rectTensile > 0 && 
    amp.hexTensile > 0 && 
    amp.holdTensile > 0 && 
    amp.dropTensile > 0
  );
  
  if (results.length === 0) {
    return [];
  }
  
  // Rank by tensile stress (lower is better) for each category
  results.sort((a, b) => a.rectTensile - b.rectTensile);
  results.forEach((amp, i) => { amp.rectRank = i + 1; });
  
  results.sort((a, b) => a.hexTensile - b.hexTensile);
  results.forEach((amp, i) => { amp.hexRank = i + 1; });
  
  results.sort((a, b) => a.holdTensile - b.holdTensile);
  results.forEach((amp, i) => { amp.holdRank = i + 1; });
  
  results.sort((a, b) => a.dropTensile - b.dropTensile);
  results.forEach((amp, i) => { amp.dropRank = i + 1; });
  
  // Calculate overall score (sum of ranks) and overall rank
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
  
  // Get selected amphorae that didn't make it into rankings
  const selected = getSelectedAmphorae() || [];
  // Safely check for missing amphorae
  const missingAmphorae = selected.filter(amp => {
    if (!amp) return false;
    return !rankings.some(r => r && r.name === amp);
  });
  
  if (!rankings.length) {
    tableEl.innerHTML = `
      <div class="alert alert-info">
        <strong>No complete data available.</strong><br>
        Please select at least one amphora with complete test data.
      </div>`;
    return;
  }
  
  // Helper function to safely format numbers
  const safeFormat = (value) => {
    if (value === undefined || value === null || isNaN(value) || value === 0) {
      return "–"; // Em dash for missing data
    }
    return Number(value).toFixed(2);
  };
  
  // Create table HTML with data availability warning if needed
  let html = '';
  
  // More defensive check for missingAmphorae
  if (missingAmphorae && missingAmphorae.length > 0) {
    const validMissing = missingAmphorae.filter(amp => amp && typeof amp === 'string' && amp.trim() !== '');
    if (validMissing.length > 0) {
      html += `
        <div class="alert alert-warning mb-3">
          <strong>Data Availability Notice:</strong><br>
          The following selected amphorae do not appear in rankings due to incomplete data: 
          <strong>${validMissing.join(", ")}</strong><br>
          Amphorae must have data for all test types (Stack in both Rect and Hex arrangements, Hold, and Drop) to be included.
        </div>
      `;
    }
  }
  
  // Create table HTML - reordered with Hold and Drop first
  html += `
    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th rowspan="2">Overall<br>Rank</th>
          <th rowspan="2">Amphora</th>
          <th colspan="2">Hold</th>
          <th colspan="2">Drop</th>
          <th colspan="4">Rect Stack</th>
          <th colspan="4">Hex Stack</th>
        </tr>
        <tr>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Load (N)</th>
          <th>FoS</th>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Load (N)</th>
          <th>FoS</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  rankings.forEach((amp) => {
    html += `
      <tr>
        <td><strong>${amp.overallRank || '–'}</strong></td>
        <td>${amp.name || '–'}</td>
        <td>${amp.holdRank ? '#' + amp.holdRank : '–'}</td>
        <td>${safeFormat(amp.holdTensile)} MPa</td>
        <td>${amp.dropRank ? '#' + amp.dropRank : '–'}</td>
        <td>${safeFormat(amp.dropTensile)} MPa</td>
        <td>${amp.rectRank ? '#' + amp.rectRank : '–'}</td>
        <td>${safeFormat(amp.rectTensile)} MPa</td>
        <td>${safeFormat(amp.rectLoad)} N</td>
        <td>${safeFormat(amp.rectFoS)}</td>
        <td>${amp.hexRank ? '#' + amp.hexRank : '–'}</td>
        <td>${safeFormat(amp.hexTensile)} MPa</td>
        <td>${safeFormat(amp.hexLoad)} N</td>
        <td>${safeFormat(amp.hexFoS)}</td>
      </tr>
    `;
  });
  
  html += `
      </tbody>
    </table>
  `;
  
  tableEl.innerHTML = html;
}

function displayRankingTable() {
  const rankings = calculateRankings();
  const tableEl = document.getElementById("rankingTable");
  
  if (!tableEl) {
    console.error("Ranking table element not found");
    return;
  }
  
  // Get selected amphorae that didn't make it into rankings
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
  
  // Helper function to safely format numbers
  const safeFormat = (value) => {
    if (value === undefined || value === null || isNaN(value) || value === 0) {
      return "–"; // Em dash for missing data
    }
    return Number(value).toFixed(2);
  };
  
  // Create table HTML with data availability warning if needed
  let html = '';
  
  // Only show warning if there are actual missing amphorae with non-empty names
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
  
  // Create table HTML - reordered with Hold and Drop first
  html += `
    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th rowspan="2">Overall<br>Rank</th>
          <th rowspan="2">Amphora</th>
          <th colspan="2">Hold</th>
          <th colspan="2">Drop</th>
          <th colspan="4">Rect Stack</th>
          <th colspan="4">Hex Stack</th>
        </tr>
        <tr>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Load (N)</th>
          <th>FoS</th>
          <th>Rank</th>
          <th>Tensile (MPa)</th>
          <th>Load (N)</th>
          <th>FoS</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  rankings.forEach((amp) => {
    html += `
      <tr>
        <td><strong>${amp.overallRank || '–'}</strong></td>
        <td>${amp.name || '–'}</td>
        <td>${amp.holdRank ? '#' + amp.holdRank : '–'}</td>
        <td>${safeFormat(amp.holdTensile)} MPa</td>
        <td>${amp.dropRank ? '#' + amp.dropRank : '–'}</td>
        <td>${safeFormat(amp.dropTensile)} MPa</td>
        <td>${amp.rectRank ? '#' + amp.rectRank : '–'}</td>
        <td>${safeFormat(amp.rectTensile)} MPa</td>
        <td>${safeFormat(amp.rectLoad)} N</td>
        <td>${safeFormat(amp.rectFoS)}</td>
        <td>${amp.hexRank ? '#' + amp.hexRank : '–'}</td>
        <td>${safeFormat(amp.hexTensile)} MPa</td>
        <td>${safeFormat(amp.hexLoad)} N</td>
        <td>${safeFormat(amp.hexFoS)}</td>
      </tr>
    `;
  });
  
  html += `
      </tbody>
    </table>
  `;
  
  tableEl.innerHTML = html;
}

function populateAmphoraeList() {
  const test = getTest();
  amphoraeMemory[test] = new Set(getSelectedAmphorae().map(normalizeAmphora));
  const patternFilter = test === "Stack" ? getPattern() : "all";
  const yKey = getYAxis();
  const amphoraeSet = new Set();
  
  // For ranking mode, only show amphorae with data in all test types
  if (test === "Ranking") {
    // Get amphorae with data in each test type
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
    
    // Keep only amphorae that exist in all three test types
    stackAmphorae.forEach(amp => {
      if (holdAmphorae.has(amp) && dropAmphorae.has(amp)) {
        amphoraeSet.add(amp);
      }
    });
  } else {
    // Regular behavior for non-ranking modes
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
    
    // Use a safer approach for the click handler
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
    btn.className = "btn btn-outline-secondary btn-sm amph-btn";
    btn.textContent = label;
    btn.style.fontWeight = "500";
    btn.style.marginTop = "0.25rem";
    
    // Use a safer approach for bulk selection
    btn.addEventListener("click", function() {
      const buttons = container.querySelectorAll(".amph-btn");
      buttons.forEach(b => {
        if (b.textContent !== label) {
          label === "Select All"
            ? b.classList.add("active")
            : b.classList.remove("active");
        }
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
   6.  Data Load + Chart
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
    // Find all test variants (empty, wine, oil) for this amphora
    const baseAmpName = normalizeAmphora(amp);
    
    // Get all rows for this amphora in Hold tests
    const rows = rawRows.filter(r => 
      normalizeAmphora(r[AMPH_COL(r)]) === baseAmpName && 
      baseTest(r.Test) === "Hold"
    );
    
    if (!rows.length) continue;
    
    // Create data points for each mass variant (empty/wine/oil)
    const data = [];
    
    for (const r of rows) {
      // Determine fill type from test name
      const fillType = getFillType(r.Test);
      
      // For x/y axis: handle mass specially
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
      
      // Only add valid data points
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
    
    // Sort by x-value for proper line rendering
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
      // Special processing for Hold tests with mass as an axis
      datasets = processHoldTestData(selected, xKey, yKey);
    } else {
      // Normal processing for other tests
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
                
                // Get formatted x and y values
                const xVal = ctx.raw.x;
                const yVal = ctx.raw.y;
                const x = valStr(xVal, getXAxis());
                const y = valStr(yVal, getYAxis());
                
                // Base label
                let label = `${ctx.dataset.label}`;
                
                // For Hold tests, add fill type
                if (test === "Hold" && fillType) {
                  label += ` (${fillType})`;
                }
                
                label += `: (${x}, ${y})`;
                
                // For Stack and Drop tests, add total mass calculation
                if (test !== "Hold") {
                  const massBasis = getMass();
                  // Get stack/grid dimensions once
                  const n = r["n (layers)"];
                  const w = r["w (# pot)"];
                  const l = r["l (# pot)"];
                  
                  let totalMass;
                  const fillType = massBasis === "Mass (Wine) (kg)" ? "Wine" : 
                                  (massBasis === "Mass (Oil)" || massBasis === "Mass (Oil) (kg)") ? "Oil" : "Empty";
                  
                  // Get base mass per pot based on fill type
                  const massPerPot = getEffectiveMass(r, fillType);
                  
                  // Scale by number of pots if available
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
   7.  Main
------------------------------------------------------------- */
async function onControlChange() {
  try {
    const test = getTest();
    
    // Check if we need to load new data
    if (test !== lastTestLoaded) {
      if (test === "Ranking") {
        // Load all data for ranking
        try {
          // Load data from each test type
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
          
          // Wait for all data to load
          const results = await Promise.all(promises);
          
          // Combine data from all test types and cached data
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
        // Load data for the selected test type
        rawRows = await fetchRows(test);
      }
      
      buildAxisSelectors();
      lastTestLoaded = test;
    }
    
    // Update UI based on selected test
    toggleUIControls();
    populateAmphoraeList();
    
    // Display either ranking table or plot
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
  // Attach listeners to axes selectors
  ["xAxis", "yAxis"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.addEventListener("change", updatePlot);
  });
  
  // Attach listeners to radio button groups
  ["mass", "test", "pattern"].forEach(name => {
    document.querySelectorAll(`input[name=${name}]`)
      .forEach(el => el.addEventListener("change", onControlChange));
  });
}

/* -------------------------------------------------------------
   8.  Initialization
------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // Add ranking table div
  const chartBody = document.querySelector("#chart-wrap .card-body");
  if (chartBody) {
    const rankingTable = document.createElement("div");
    rankingTable.id = "rankingTable";
    rankingTable.className = "d-none";
    chartBody.appendChild(rankingTable);
  }
  
  // Attach event listeners
  attachListeners();
  
  // Initialize with first load
  onControlChange();
});