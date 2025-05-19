import pandas as pd, json, re, asyncio
from pyodide.http import pyfetch
from pyscript import display, js

SHEET_ID = "1uQLwPGeS3zxpXQAcc5_nQDSoFH79cYlEeMa0Hbz5H_o"
TABS = [
    ("0",         "chart1", "Stack / Summary"),
    ("145083070", "chart2", "Hold-Drop"),
]

async def fetch_tab(gid: str) -> pd.DataFrame:
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?gid={gid}&tqx=out:json"
    r = await pyfetch(url)
    txt = await r.text()
    body = re.sub(r"^.*?\\(", "", txt)[:-2]
    data = json.loads(body)

    cols = [(c.get("label") or f"c{i}") for i, c in enumerate(data["table"]["cols"])]
    rows = [[cell.get("v") if cell else None for cell in r["c"]] for r in data["table"]["rows"]]
    df = pd.DataFrame(rows, columns=cols)

    for c in df.columns:                       # numeric coercion
        if df[c].dtype == object:
            df[c] = pd.to_numeric(df[c].str.replace(",", ""), errors="ignore")
    return df

def plot_js(df: pd.DataFrame, x: str, y: str, target: str, title: str):
    """Use global Plotly JS to keep PyScript light."""
    x_vals, y_vals = df[x].tolist(), df[y].tolist()
    trace = js.Object.fromEntries([
        ("x", x_vals), ("y", y_vals),
        ("mode", "markers"), ("type", "scatter"),
        ("marker", js.Object.fromEntries([("size", 8)])),
    ])
    layout = js.Object.fromEntries([("title", title)])
    js.Plotly.newPlot(target, js.Array(trace), layout)

async def render(gid: str, target: str, label: str):
    try:
        df = await fetch_tab(gid)
        numeric = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if len(numeric) < 2:
            display("No numeric columns.", target=target)
            return
        plot_js(df, numeric[0], numeric[1], target, f"{label}: {numeric[0]} vs {numeric[1]}")
    except Exception as e:
        display(f"❌ {e}", target=target)

asyncio.ensure_future(asyncio.gather(*(render(*t) for t in TABS)))
