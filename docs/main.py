import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ------------------------------------------------------------------
CSV_URLS = [
    # Hold / Drop tab (gid 145083070)
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv",

    # Stack tab (gid 0)
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


def render_table(matrix: dict[str, set[str]]):
    thead = document.querySelector("#ampTable thead")
    tbody = document.querySelector("#ampTable tbody")
    thead.innerHTML = tbody.innerHTML = ""  # clear any previous content

    # header
    hdr = document.createElement("tr")
    hdr_inner = ["<th>Amphora</th>"] + [f"<th>{c}</th>" for c in CATEGORIES]
    hdr.innerHTML = "".join(hdr_inner)
    thead.appendChild(hdr)

    # rows
    for name in sorted(matrix, key=str.casefold):
        cells = [f"<td>{name}</td>"]
        for cat in CATEGORIES:
            cells.append("<td>✓</td>" if cat in matrix[name] else "<td></td>")
        row = document.createElement("tr")
        row.innerHTML = "".join(cells)
        tbody.appendChild(row)


async def main():
    table_div = document.getElementById("ampTable")
    table_div.setAttribute("data-loading", "true")  # minimal spinner cue

    try:
        dfs     = await asyncio.gather(*(fetch_csv(u) for u in CSV_URLS))
        matrix  = collect_matrix(dfs)
        render_table(matrix)
    except Exception as e:
        table_div.outerHTML = f"<p class='text-danger'>Error: {e}</p>"

asyncio.ensure_future(main())
