import pandas as pd, io, asyncio, re
from pyodide.http import pyfetch
from js import document, console
import pyodide
import plotly.express as px
from pyscript import display

# ── published CSV feeds ───────────────────────────────────────────────────────
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
HOLD_DROP = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"
CSV_FEEDS = [STACK_CSV, HOLD_DROP]

SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENS_RE   = re.compile(r"max.*tensile", re.I)   # to find tensile column automatically

# ── fetch helpers ─────────────────────────────────────────────────────────────
async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

async def load_data():
    stack_df, hd_df = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))

    # unify sheets
    stack_df["Category"] = stack_df["Test"].str.contains("hex", case=False).map({True:"Stack Hex", False:"Stack Rect"})
    hd_df["Category"]    = hd_df["Test"].str.contains("^drop", case=False, regex=True).map({True:"Drop", False:"Hold"})
    df = pd.concat([stack_df, hd_df], ignore_index=True)

    df["Amphora"] = (
        df["Amphorae"]
        .astype(str).str.strip()
        .str.replace(SUFFIX_RE, "", regex=True)
    )
    return df

# ── UI population ────────────────────────────────────────────────────────────
def populate_controls(df):
    amp_container = document.getElementById("ampList")
    amp_container.innerHTML = ""
    amps = sorted(df["Amphora"].unique(), key=str.casefold)
    for a in amps:
        el = document.createElement("div")
        el.className = "form-check"
        el.innerHTML = (
            f'<input class="form-check-input" type="checkbox" value="{a}" id="chk_{a}" checked>'
            f'<label class="form-check-label" for="chk_{a}">{a}</label>'
        )
        amp_container.appendChild(el)

    # numeric columns for drop-downs
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    xSel = document.getElementById("xSelect")
    ySel = document.getElementById("ySelect")
    for sel in (xSel, ySel):
        sel.innerHTML = "".join(f'<option value="{c}">{c}</option>' for c in numeric_cols)
    # default axes
    if "Load (N)" in numeric_cols and TENS_RE.search("Max Tensile"):
        xSel.value = "Load (N)"
        ySel.value = next(c for c in numeric_cols if TENS_RE.search(c))

# ── plotting ─────────────────────────────────────────────────────────────────
def current_selection():
    amps = [
        elt.value for elt in document.querySelectorAll("#ampList input:checked")
    ]
    x = document.getElementById("xSelect").value
    y = document.getElementById("ySelect").value
    return amps, x, y

def update_plot(df, *_):
    amps, x, y = current_selection()
    if not amps or x == y:
        document.getElementById("plot").innerHTML = "<p class='text-muted'>Select amphorae and distinct X / Y axes.</p>"
        return
    sub = df[df["Amphora"].isin(amps)]
    if sub.empty:
        document.getElementById("plot").innerHTML = "<p>No data for selection.</p>"
        return
    fig = px.scatter(
        sub, x=x, y=y, color="Amphora", symbol="Category",
        title=f"{y} vs {x}"
    )
    display(fig, target="plot", append=False)

# ── main async entry ─────────────────────────────────────────────────────────
async def main():
    df = await load_data()
    populate_controls(df)
    update_plot(df)

    # attach JS event listeners via proxied Python callbacks
    proxy = pyodide.create_proxy(lambda evt: update_plot(df))
    document.getElementById("xSelect").addEventListener("change", proxy)
    document.getElementById("ySelect").addEventListener("change", proxy)
    for chk in document.querySelectorAll("#ampList input"):
        chk.addEventListener("change", proxy)

asyncio.ensure_future(main())
