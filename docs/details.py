import pandas as pd, io, asyncio, math, json, re
from pyodide.http import pyfetch
from js import document
import plotly.express as px

# CSV feeds (same as matrix)
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
HOLD_DROP_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"

SUFFIX_RE  = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENS_RE    = re.compile(r"max.*tensile", re.I)

async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

async def load_data():
    stack_df, hd_df = await asyncio.gather(fetch_csv(STACK_CSV), fetch_csv(HOLD_DROP_CSV))
    stack_df["Test Category"] = stack_df["Test"].str.contains("hex", case=False).map({True:"Stack Hex",False:"Stack Rect"})
    hd_df["Test Category"]    = hd_df["Test"].str.contains("^drop", case=False, regex=True).map({True:"Drop",False:"Hold"})
    data = pd.concat([stack_df, hd_df], ignore_index=True)
    data["Amphora"] = data["Amphorae"].astype(str).str.strip().str.replace(SUFFIX_RE,"",regex=True)
    return data

def tensile_col(df):            # find the tensile column name dynamically
    return next((c for c in df.columns if TENS_RE.search(c)), None)

def populate_select(df):
    amps = sorted(df["Amphora"].unique(), key=str.casefold)
    sel  = document.getElementById("ampSelect")
    sel.innerHTML = "".join(f'<option value="{a}">{a}</option>' for a in amps)

def plot_data(df, amphora, category, tens_col):
    sub = df[(df["Amphora"]==amphora) & (df["Test Category"]==category)]
    if sub.empty:
        document.getElementById("plot").innerHTML = "<p class='text-muted'>No data for this combo.</p>"
        document.getElementById("rankBox").innerHTML = ""
        return
    if category.startswith("Stack"):
        x = "Load (N)" if "Load (N)" in sub.columns else sub.index
    else:
        x = sub.index
    fig = px.scatter(sub, x=x, y=tens_col, title=f"{amphora} — {category}: {tens_col}")
    from pyscript import display
    display(fig, target="plot", append=False)

    # simple ranking of this amphora vs others (mean tensile, lower=better)
    mean_tens = df[df["Test Category"]==category].groupby("Amphora")[tens_col].mean()
    rank = int(mean_tens.sort_values().rank().loc[amphora])
    of   = len(mean_tens)
    document.getElementById("rankBox").innerHTML = (
        f"<h5>Ranking</h5><p>{amphora} is <strong>#{rank}</strong> out of {of} for {category} (lower tensile = better).</p>"
    )

async def main():
    data = await load_data()
    tcol = tensile_col(data)
    populate_select(data)

    def refresh(_=None):
        amphora  = document.getElementById("ampSelect").value
        category = document.getElementById("testSelect").value
        plot_data(data, amphora, category, tcol)

    # attach listeners
    document.getElementById("ampSelect").addEventListener("change", refresh)
    document.getElementById("testSelect").addEventListener("change", refresh)

    refresh()

asyncio.ensure_future(main())
