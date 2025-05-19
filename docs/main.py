import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ------------------------------------------------------------------
CSV_URLS = [
    # Hold / Drop
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv",
    # Stack (gid = 0)
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv",
]

CATEGORIES = ["Stack Rect", "Stack Hex", "Hold", "Drop"]

SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TEST_MAP  = [
    (re.compile(r"drop", re.I), "Drop"),
    (re.compile(r"hold", re.I), "Hold"),
    (re.compile(r"rect", re.I), "Stack Rect"),
    (re.compile(r"hex",  re.I), "Stack Hex"),
]
# ------------------------------------------------------------------


async def fetch_csv(url: str) -> pd.DataFrame:
    text = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(text))


def clean_name(raw: str) -> str:
    return SUFFIX_RE.sub("", raw.strip())


def detect_test(row) -> str | None:
    for col in ("Test", "Arrangement"):
        if col in row and pd.notna(row[col]):
            for regex, cat in TEST_MAP:
                if regex.search(str(row[col])):
                    return cat
    return None


def collect_matrix(dfs: list[pd.DataFrame]) -> dict[str, set[str]]:
    table: dict[str, set[str]] = {}
    for df in dfs:
        amph_col = next((c for c in df.columns if c.lower().startswith("amphora")), None)
        if not amph_col:
            continue

        for _, row in df.iterrows():
            raw_name = str(row[amph_col]) if pd.notna(row[amph_col]) else ""
            name     = clean_name(raw_name)
            if not name:
                continue

            cat = detect_test(row)
            if not cat:
                continue

            table.setdefault(name, set()).add(cat)
    return table


def ensure_section(table_el, tag):
    sec = table_el.querySelector(tag)
    if sec is None:
        sec = document.createElement(tag)
        table_el.appendChild(sec)
    return sec


def render_table(matrix: dict[str, set[str]]):
    table_el = document.getElementById("ampTable")
    if table_el is None:
        raise RuntimeError("table with id='ampTable' not found")

    thead = ensure_section(table_el, "thead")
    tbody = ensure_section(table_el, "tbody")
    thead.innerHTML = tbody.innerHTML = ""

    # header row
    hdr_cells = ["<th>Amphora</th>"] + [f"<th>{c}</th>" for c in CATEGORIES]
    hdr = document.createElement("tr")
    hdr.innerHTML = "".join(hdr_cells)
    thead.appendChild(hdr)

    # data rows
    for name in sorted(matrix, key=str.casefold):
        cells = [f"<td>{name}</td>"]
        for cat in CATEGORIES:
            cells.append("<td>✓</td>" if cat in matrix[name] else "<td></td>")
        row = document.createElement("tr")
        row.innerHTML = "".join(cells)
        tbody.appendChild(row)


async def main():
    try:
        dfs    = await asyncio.gather(*(fetch_csv(u) for u in CSV_URLS))
        matrix = collect_matrix(dfs)
        render_table(matrix)
    except Exception as e:
        table_el = document.getElementById("ampTable")
        if table_el:
            table_el.outerHTML = f"<p class='text-danger'>Error: {e}</p>"

asyncio.ensure_future(main())
