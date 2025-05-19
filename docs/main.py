import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ─── Published CSV feeds ──────────────────────────────────────────────────────
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
TENS_RE    = re.compile(r"tensile", re.I)
# ──────────────────────────────────────────────────────────────────────────────


async def fetch_csv(url: str) -> pd.DataFrame:
    text = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(text))


def clean_name(raw: str) -> str:
    return SUFFIX_RE.sub("", raw.strip())


def has_tensile(row, tens_cols) -> bool:
    for col in tens_cols:
        val = pd.to_numeric(row[col], errors="coerce")
        if pd.notna(val):
            return True
    return False


def detect_stack_cat(arrangement: str | float) -> str | None:
    if isinstance(arrangement, str):
        a = arrangement.lower()
        if "rect" in a:
            return "Stack Rect"
        if "hex" in a:
            return "Stack Hex"
    return None


def detect_hd_cat(test_val: str | float) -> str | None:
    if isinstance(test_val, str):
        t = test_val.lower()
        if t.startswith("hold"):
            return "Hold"
        if t.startswith("drop"):
            return "Drop"
    return None


def build_matrix(stack_df: pd.DataFrame, hd_df: pd.DataFrame) -> dict[str, set[str]]:
    table: dict[str, set[str]] = {}

    # --- Stack sheet ---------------------------------------------------------
    amph_col = next((c for c in stack_df.columns if c.lower().startswith("amphora")), None)
    tens_cols = [c for c in stack_df.columns if TENS_RE.search(c)]
    if amph_col and tens_cols:
        for _, row in stack_df.iterrows():
            name = clean_name(str(row[amph_col]))
            cat  = detect_stack_cat(row.get("Arrangement", ""))
            if name and cat and has_tensile(row, tens_cols):
                table.setdefault(name, set()).add(cat)

    # --- Hold / Drop sheet ---------------------------------------------------
    amph_col = next((c for c in hd_df.columns if c.lower().startswith("amphora")), None)
    tens_cols = [c for c in hd_df.columns if TENS_RE.search(c)]
    if amph_col and tens_cols:
        for _, row in hd_df.iterrows():
            name = clean_name(str(row[amph_col]))
            cat  = detect_hd_cat(row.get("Test", ""))
            if name and cat and has_tensile(row, tens_cols):
                table.setdefault(name, set()).add(cat)

    return table


# ─── DOM helpers ──────────────────────────────────────────────────────────────
def ensure(tag, parent):
    el = parent.querySelector(tag)
    if el is None:
        el = document.createElement(tag)
        parent.appendChild(el)
    return el


def render(matrix: dict[str, set[str]]):
    table = document.getElementById("ampTable")
    thead = ensure("thead", table)
    tbody = ensure("tbody", table)
    thead.innerHTML = tbody.innerHTML = ""

    hdr = document.createElement("tr")
    hdr.innerHTML = "<th>Amphora</th>" + "".join(f"<th>{c}</th>" for c in CATEGORIES)
    thead.appendChild(hdr)

    for name in sorted(matrix, key=str.casefold):
        row = document.createElement("tr")
        cells = [f"<td>{name}</td>"] + [
            "<td>✓</td>" if cat in matrix[name] else "<td></td>" for cat in CATEGORIES
        ]
        row.innerHTML = "".join(cells)
        tbody.appendChild(row)


# ─── main coroutine ───────────────────────────────────────────────────────────
async def main():
    tbl = document.getElementById("ampTable")
    tbl.innerHTML = "<caption>Loading…</caption>"

    try:
        stack_df, hd_df = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))
        matrix = build_matrix(stack_df, hd_df)
        render(matrix)
    except Exception as e:
        tbl.outerHTML = f"<p class='text-danger'>Error: {e}</p>"

asyncio.ensure_future(main())
