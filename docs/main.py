import pandas as pd, io, asyncio, re
from pyodide.http import pyfetch
from js import document
from pyodide.ffi import create_proxy
import plotly.express as px
from pyscript import display          # ← here


pyodide.create_proxy = create_proxy           # any old call now resolves
# ── CSV feeds ────────────────────────────────────────────────────────────────
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
HOLD_DROP = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"
CSV_FEEDS = [STACK_CSV, HOLD_DROP]

SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENS_RE   = re.compile(r"max.*tensile", re.I)

# ── DOM wait helper ──────────────────────────────────────────────────────────
async def wait_for(elem_id: str):
    while document.getElementById(elem_id) is None:
        await asyncio.sleep(0.01)
    return document.getElementById(elem_id)

# ── data loading ─────────────────────────────────────────────────────────────
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

# ── control population ───────────────────────────────────────────────────────
async def populate_controls(df):
    amp_box = await wait_for("ampList")
    amp_box.innerHTML = ""
    for amp in sorted(df["Amphora"].unique(), key=str.casefold):
        amp_box.innerHTML += (
            f'<div class="form-check">'
            f'<input class="form-check-input" type="checkbox" id="chk_{amp}" value="{amp}" checked>'
            f'<label class="form-check-label" for="chk_{amp}">{amp}</label>'
            f'</div>'
        )

    num_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    xSel = await wait_for("xSelect")
    ySel = await wait_for("ySelect")
    opts = "".join(f'<option value="{c}">{c}</option>' for c in num_cols)
    xSel.innerHTML = ySel.innerHTML = opts

    if "Load (N)" in num_cols:
        xSel.value = "Load (N)"
    tens = next((c for c in num_cols if TENS_RE.search(c)), num_cols[0])
    ySel.value = tens

# ── plotting ─────────────────────────────────────────────────────────────────
def selection():
    amps = [e.value for e in document.querySelectorAll("#ampList input:checked")]
    x = document.getElementById("xSelect").value
    y = document.getElementById("ySelect").value
    return amps, x, y

def draw(df, *_):
    amps, x, y = selection()
    div = document.getElementById("plot")
    if not amps or x == y:
        div.innerHTML = "<p class='text-muted'>Select amphorae and distinct axes.</p>"
        return
    sub = df[df["Amphora"].isin(amps)]
    if sub.empty:
        div.innerHTML = "<p>No data for selection.</p>"
        return
    fig = px.scatter(sub, x=x, y=y, color="Amphora", symbol="Category",
                     title=f"{y} vs {x}")
    display(fig, target="plot", append=False)

# ── main coroutine ───────────────────────────────────────────────────────────
async def main():
    df = await load_data()
    await populate_controls(df)
    draw(df)

    cb = create_proxy(lambda evt: draw(df))            # modern call
    document.getElementById("xSelect").addEventListener("change", cb)
    document.getElementById("ySelect").addEventListener("change", cb)
    for chk in document.querySelectorAll("#ampList input"):
        chk.addEventListener("change", cb)

asyncio.ensure_future(main())
