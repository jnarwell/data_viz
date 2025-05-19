import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ── Published CSV feeds ──────────────────────────────────────────────────────
STACK_CSV = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-"
    "JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
)
HOLD_DROP_CSV = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-"
    "JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?"
    "gid=145083070&single=true&output=csv"
)
CSV_FEEDS = [STACK_CSV, HOLD_DROP_CSV]

CATEGORIES = ["Stack Rect", "Stack Hex", "Hold", "Drop"]
SUFFIX_RE  = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENSILE_RE = re.compile(r"max.*tensile", re.I)   # any header with both words

# ── Helpers ──────────────────────────────────────────────────────────────────
async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

def find_tensile_col(df: pd.DataFrame) -> str | None:
    for c in df.columns:
        if TENSILE_RE.search(c):
            return c
    return None

def category_from_test(test: str) -> str | None:
    t = test.lower()
    if "stack" in t and "rect" in t:
        return "Stack Rect"
    if "stack" in t and "hex" in t:
        return "Stack Hex"
    if t.startswith("hold"):
        return "Hold"
    if t.startswith("drop"):
        return "Drop"
    return None

def has_numeric(val) -> bool:
    return pd.notna(pd.to_numeric(val, errors="coerce"))

def build_matrix(dfs: list[pd.DataFrame]) -> dict[str, set[str]]:
    table: dict[str, set[str]] = {}

    for df in dfs:
        # locate required columns
        if "Test" not in df.columns:
            continue
        a_col = next((c for c in df.columns if c.lower().startswith("amphora")), None)
        t_col = find_tensile_col(df)
        if not a_col or not t_col:
            continue

        for _, row in df.iterrows():
            test_val = str(row["Test"]).strip()
            cat      = category_from_test(test_val)
            name     = SUFFIX_RE.sub("", str(row[a_col]).strip())
            if not (name and cat):
                continue
            if has_numeric(row[t_col]):
                table.setdefault(name, set()).add(cat)

    return table

# ── DOM rendering ────────────────────────────────────────────────────────────
def render(matrix: dict[str, set[str]]):
    tbl = document.getElementById("ampTable")
    tbl.innerHTML = ""  # clear placeholder

    thead = document.createElement("thead")
    hdr   = "<th>Amphora</th>" + "".join(f"<th>{c}</th>" for c in CATEGORIES)
    thead.innerHTML = f"<tr>{hdr}</tr>"
    tbl.appendChild(thead)

    tbody = document.createElement("tbody")
    for name in sorted(matrix, key=str.casefold):
        cells = [f"<td>{name}</td>"] + [
            "<td>✓</td>" if cat in matrix[name] else "<td></td>" for cat in CATEGORIES
        ]
        row = document.createElement("tr")
        row.innerHTML = "".join(cells)
        tbody.appendChild(row)
    tbl.appendChild(tbody)

# ── main coroutine ───────────────────────────────────────────────────────────
async def main():
    tbl = document.getElementById("ampTable")
    tbl.innerHTML = "<caption>Loading…</caption>"

    try:
        dfs     = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))
        matrix  = build_matrix(dfs)
        render(matrix)
    except Exception as e:
        tbl.outerHTML = f"<p class='text-danger'>Error: {e}</p>"

asyncio.ensure_future(main())
