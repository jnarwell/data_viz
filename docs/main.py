import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ─── CSV feeds ────────────────────────────────────────────────────────────────
CSV_URLS = [
    # Hold / Drop tab
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv",
    # Stack tab (gid=0)
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv",
]

CATEGORIES  = ["Stack Rect", "Stack Hex", "Hold", "Drop"]
SUFFIX_RE   = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENS_RE     = re.compile(r"tensile", re.I)        # columns containing tensile
TEST_MAP    = [
    (re.compile(r"drop", re.I), "Drop"),
    (re.compile(r"hold", re.I), "Hold"),
    (re.compile(r"rect", re.I), "Stack Rect"),
    (re.compile(r"hex",  re.I), "Stack Hex"),
]
# ──────────────────────────────────────────────────────────────────────────────


async def fetch_csv(url: str) -> pd.DataFrame:
    csv_text = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(csv_text))


def clean_name(raw: str) -> str:
    return SUFFIX_RE.sub("", raw.strip())


def detect_test(row) -> str | None:
    for col in ("Test", "Arrangement"):
        if col in row and pd.notna(row[col]):
            for regex, cat in TEST_MAP:
                if regex.search(str(row[col])):
                    return cat
    return None


def has_tensile(row, tensile_cols) -> bool:
    for col in tensile_cols:
        val = pd.to_numeric(row[col], errors="coerce")
        if pd.notna(val):
            return True
    return False


def build_matrix(dfs: list[pd.DataFrame]) -> dict[str, set[str]]:
    table: dict[str, set[str]] = {}

    for df in dfs:
        amph_col = next((c for c in df.columns if c.lower().startswith("amphora")), None)
        if not amph_col:
            continue

        tens_cols = [c for c in df.columns if TENS_RE.search(c)]
        if not tens_cols:
            continue   # sheet has no tensile data at all

        for _, row in df.iterrows():
            raw_name = str(row[amph_col]) if pd.notna(row[amph_col]) else ""
            name = clean_name(raw_name)
            if not name:
                continue

            cat = detect_test(row)
            if not cat:
                continue

            if has_tensile(row, tens_cols):
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

    # header
    hdr = document.createElement("tr")
    hdr.innerHTML = "<th>Amphora</th>" + "".join(f"<th>{c}</th>" for c in CATEGORIES)
    thead.appendChild(hdr)

    # rows
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
        dfs     = await asyncio.gather(*(fetch_csv(u) for u in CSV_URLS))
        matrix  = build_matrix(dfs)
        render(matrix)
    except Exception as e:
        tbl.outerHTML = f"<p class='text-danger'>Error: {e}</p>"

asyncio.ensure_future(main())
