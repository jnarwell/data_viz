import pandas as pd, io, asyncio
from pyodide.http import pyfetch
from js import document

# ── CSV feeds ────────────────────────────────────────────────────────────────
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

TENS_COL = "Max Tensile (MPa)"      # ← exact header to look for
CATEGORIES = ["Stack Rect", "Stack Hex", "Hold", "Drop"]
# ─────────────────────────────────────────────────────────────────────────────


async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))


def stack_cat(arrangement: str) -> str | None:
    a = arrangement.lower()
    if a == "rect": return "Stack Rect"
    if a == "hex":  return "Stack Hex"
    return None


def hd_cat(test_val: str) -> str | None:
    if test_val == "Hold": return "Hold"
    if test_val == "Drop": return "Drop"
    return None


def build_matrix(stack_df: pd.DataFrame, hd_df: pd.DataFrame) -> dict[str, set[str]]:
    table: dict[str, set[str]] = {}

    # Stack sheet
    for _, row in stack_df.iterrows():
        name = str(row["Amphorae"]).strip()
        cat  = stack_cat(str(row.get("Arrangement", "")).strip())
        val  = pd.to_numeric(row.get(TENS_COL, ""), errors="coerce")
        if name and cat and pd.notna(val):
            table.setdefault(name, set()).add(cat)

    # Hold / Drop sheet
    for _, row in hd_df.iterrows():
        name = str(row["Amphorae"]).strip()
        cat  = hd_cat(str(row.get("Test", "")).strip())
        val  = pd.to_numeric(row.get(TENS_COL, ""), errors="coerce")
        if name and cat and pd.notna(val):
            table.setdefault(name, set()).add(cat)

    return table


def render(matrix: dict[str, set[str]]):
    tbl   = document.getElementById("ampTable")
    tbl.innerHTML = ""             # clear placeholder

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
