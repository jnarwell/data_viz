import pandas as pd, json, re, asyncio, math
from pyodide.http import pyfetch
from pyscript import display
import plotly.express as px

# ------------- CONFIG -------------------------------------------------------
SHEET_ID = "1uQLwPGeS3zxpXQAcc5_nQDSoFH79cYlEeMa0Hbz5H_o"

TABS = [
    # gid, target-div-id, friendly title
    ("0",         "chart1", "Sheet 0 — Stack / Summary"),
    ("145083070", "chart2", "Sheet 1 — Hold-Drop"),
]
# ---------------------------------------------------------------------------

async def fetch_tab(gid: str) -> pd.DataFrame:
    """Return a DataFrame for a single worksheet (by gid)."""
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq"
        f"?gid={gid}&tqx=out:json"
    )
    res = await pyfetch(url)
    txt = await res.text()

    # Strip Google JSON-P wrapper
    body = re.sub(r"^.*?\\(", "", txt)[:-2]
    js   = json.loads(body)

    cols = [(c.get("label") or f"col{i}") for i, c in enumerate(js["table"]["cols"])]
    rows = [
        [cell.get("v") if cell else None for cell in r["c"]]
        for r in js["table"]["rows"]
    ]
    df = pd.DataFrame(rows, columns=cols)

    # Attempt numeric coercion on every column
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = pd.to_numeric(df[c].str.replace(",", ""), errors="ignore")
    return df


def find_numeric_axes(df: pd.DataFrame):
    """Pick sensible numeric x & y columns automatically."""
    numeric = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    if len(numeric) >= 2:
        return numeric[0], numeric[1]
    return None, None


async def render_tab(gid: str, target: str, title: str):
    try:
        df = await fetch_tab(gid)
        x_col, y_col = find_numeric_axes(df)

        if x_col and y_col:
            # First non-numeric column becomes trace label, if available
            non_num = next((c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])), None)
            color   = non_num if non_num else None

            fig = px.scatter(
                df, x=x_col, y=y_col, color=color,
                title=f"{title}: {x_col} vs {y_col}",
                height=500
            )
            display(fig, target=target)
        else:
            display("No numeric columns found.", target=target)

    except Exception as e:
        display(f"Error loading tab {gid}: {e}", target=target)


async def main():
    # Kick off fetch/render for each sheet concurrently
    await asyncio.gather(*(render_tab(gid, tgt, ttl) for gid, tgt, ttl in TABS))


asyncio.ensure_future(main())
