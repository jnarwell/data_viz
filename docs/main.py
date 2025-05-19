import pandas as pd, io, asyncio, re
from pyodide.http import pyfetch
from js import document
import pyodide
import plotly.express as px
from pyscript import display

# ── CSV feeds ────────────────────────────────────────────────────────────────
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
HOLD_DROP = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"
CSV_FEEDS = [STACK_CSV, HOLD_DROP]

SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENS_RE   = re.compile(r"max.*tensile", re.I)   # find tensile column header

# ── DOM wait helper ──────────────────────────────────────────────────────────
async def wait_for_elem(elem_id: str):
    while document.getElementById(elem_id) is None:
        await asyncio.sleep(0.01)
    return document.getElementById(elem_id)

# ── fetch & tidy data ────────────────────────────────────────────────────────
async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

async def load_data():
    stack_df, hd_df = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))
    stack_df["Category"] = stack_df["Test"].str.contains("hex", case=False).map({True:"Stack Hex", False:"Stack Rect"})
    hd_df["Category"]    = hd_df["Test"].str.contains("^drop", case=False, regex=True).map({True:"Drop", False:"Hold"})
    df = pd.concat([stack_df, hd_df], ignore_index=True)
    df["Amphora"] = (
        df["Amphorae"].astype(str).str.strip().str.replace(SUFFIX_RE, "", regex=True)
    )
    return df

# ── UI population ────────────────────────────────────────────────────────────
async def populate_controls(df):
    amp_container = await wait_for_elem("ampList")
    amp_container.innerHTML = ""
    amps = sorted(df["Amphora"].unique(), key=str.casefold)
    for a in amps:
        amp_container.innerHTML += (
            f'<div class="form-check">'
            f'<input class="form-check-input" type="checkbox" value="{a}" id="chk_{a}" checked>'
            f'<label class="form-check-label" for="chk_{a}">{a}</label>'
            f'</div>'
        )

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    xSel = await wait_for_elem("xSelect")
    ySel = await wait_for_elem("ySelect")
    xSel.innerHTML = ySel.innerHTML = "".join(f'<option value="{c}">{c}</option>' for c in numeric_cols)

    # sensible defaults
    if "Load (N)" in numeric_cols: xSel.value = "Load (N)"
    tens_col = next((c for c in numeric_cols if TENS_RE.search(c)), numeric_cols[0])
    ySel.value = tens_col

# ── plot update ──────────────────────────────────────────────────────────────
def current_selection():
    amps = [e.value for e in document.querySelectorAll("#ampList input:checked")]
    x = document.getElementById("xSelect").value
    y = document.getElementById("ySelect").value
    return amps, x, y

def update_plot(df, *_):
    amps, x, y = current_selection()
    plot_div = document.getElementById("plot")
    if not amps or x == y:
        plot_div.innerHTML = "<p class='text-muted'>Select amphorae and distinct X/Y axes.</p>"
        return
    sub = df[df["Amphora"].isin(amps)]
    if sub.empty:
        plot_div.innerHTML = "<p>No data for selection.</p>"
        return
    fig = px.scatter(sub, x=x, y=y, color="Amphora", symbol="Category", title=f"{y} vs {x}")
    display(fig, target="plot", append=False)

# ── main coroutine ───────────────────────────────────────────────────────────
async def main():
    df = await load_data()
    await populate_controls(df)
    update_plot(df)

    proxy = pyodide.create_proxy(lambda evt: update_plot(df))
    document.getElementById("xSelect").addEventListener("change", proxy)
    document.getElementById("ySelect").addEventListener("change", proxy)
    for chk in document.querySelectorAll("#ampList input"):
        chk.addEventListener("change", proxy)

asyncio.ensure_future(main())
