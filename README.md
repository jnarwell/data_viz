# Amphorae Dashboard

Static site served via GitHub Pages.

## Overview

The Amphorae Mechanical Test Explorer is a web-based visualization tool for analyzing mechanical test data of amphorae (ancient storage vessels). The application displays interactive charts and rankings based on various test types and parameters.

## Features

- **Multiple Test Types**: Stack, Hold, Drop, and Ranking views
- **Interactive Charts**: Dynamic visualization of test results using Chart.js
- **Customizable Axes**: Select X and Y axes from available data columns
- **Mass Basis Options**: View data for empty, wine-filled, or oil-filled amphorae
- **Pattern Filtering**: Filter stack tests by hexagonal or rectangular arrangements
- **Ranking System**: Comprehensive ranking table combining results from all test types
- **Sortable Columns**: Click on any column header in the ranking table to sort by that column
- **3D Model Previews**: 
  - Hover over data points in charts or amphora names in the ranking table
  - 3D models appear in fixed positions to avoid tooltip overlap:
    - Default: TOP-RIGHT corner of screen
    - When cursor is in top-right area: BOTTOM-LEFT corner
  - Spinning models include weight specifications and internal volume
  - 200ms delay prevents flickering when moving between points
- **Responsive Design**: Works on desktop and mobile devices

## File Structure

```
DATA_VIZ/
├── docs/               # GitHub Pages root directory
│   ├── index.html      # Main HTML file
│   ├── script.js       # Core application logic
│   ├── style.css       # Custom styles
│   └── models/         # STL 3D model files
│       ├── africana_2a.stl
│       ├── dressel_1a.stl
│       ├── dressel_20.stl
│       ├── seaegean.stl
│       └── [other amphora models].stl
├── amphorae_comp/
│   ├── holddrop.csv    # Hold and Drop test data
│   └── stack.csv       # Stack test data
└── README.md
```

## Data Sources

The application fetches data from Google Sheets published as CSV files:
- Stack test data
- Hold test data  
- Drop test data

## Technologies Used

- **Bootstrap 5.3.3**: UI framework
- **Chart.js**: Data visualization
- **Three.js r128**: 3D model rendering
- **PapaParse**: CSV parsing
- **Vanilla JavaScript**: Application logic

## Usage

1. Select a test type (Stack, Hold, Drop, or Ranking)
2. Choose X and Y axes for chart visualization
3. Select mass basis (Empty, Wine, or Oil)
4. For Stack tests, optionally filter by pattern (All, Hex, or Rect)
5. Click on amphora names to include/exclude them from the visualization
6. **3D Model Preview**:
   - Hover over data points in charts to see the amphora model
   - In Ranking mode, hover over amphora names in the table
   - Models include weight specifications and internal volume
7. In Ranking mode:
   - Customize which columns to display using the column controls
   - Click any column header to sort by that column
   - Click the same header again to reverse the sort order

## Development

To run locally:
1. Clone the repository
2. Serve the `docs/` directory with any web server
3. Update CSV URLs in `script.js` if using different data sources

### Preparing 3D Models

1. Export STL files from Fusion 360
2. Name files using lowercase with underscores (e.g., `africana_2a.stl`)
3. Place files in the `docs/models/` directory
4. The system automatically matches amphora names to model files

**File Naming Convention:**
- Use lowercase letters
- Replace spaces with underscores
- Remove pattern suffixes (_rect, _hex) from filenames
- Examples:
  - "Africana 2A" → `africana_2a.stl`
  - "Dressel 1A" → `dressel_1a.stl`
  - "Dressel 20" → `dressel_20.stl`
  - "Seaegean" → `seaegean.stl`
  - "Canaanite KW214" → `canaanite_kw214.stl`

**Current Issues from Console:**
Based on your error messages, the system is looking for these files:
- `dressel_1a.stl` ✓ (you have this)
- `africana_2a.stl` ✓ (you have this)  
- `seaegean.stl` ✓ (you have this)
- `canaanite_kw214.stl` ❌ (missing - needs to be added)

The amphora names in your data include pattern suffixes (_rect, _hex) which are automatically removed when looking for STL files.

**Debugging Model Issues:**
1. Open browser console (F12)
2. Wait for data to load
3. Run: `checkModelRequirements()`
4. This shows all amphora types and their expected filenames
5. Compare with your `docs/models/` folder contents
6. Add any missing STL files with the exact filenames shown

**Troubleshooting:**
- Check browser console for exact filenames being requested
- Ensure STL files are in binary format (not ASCII)
- File names are case-sensitive on most web servers
- Common issues:
  - Pattern suffixes in data but not in filenames
  - Spelling differences (e.g., "seagean" vs "seaegean")
  - Missing underscores in multi-part names
  - Special characters in amphora names

**Note**: When running locally, you may encounter CORS errors when loading STL files. Use a local web server (e.g., `python -m http.server` or Live Server in VS Code) instead of opening the HTML file directly.