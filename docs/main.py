import pandas as pd, io, asyncio, re
from pyodide.http import pyfetch
from js import document
import pyodide, plotly.express as px
from pyodide.ffi import create_proxy
from pyscript import display

# ── data sources ─────────────────────────────────────────────────────────────
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
HOLD_DROP = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"
CSV_FEEDS = [STACK_CSV, HOLD_DROP]

SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)

# ── helpers ──────────────────────────────────────────────────────────────────
async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

async def wait_for(elem_id: str):
    while document.getElementById(elem_id) is None:
        await asyncio.sleep(0.01)
    return document.getElementById(elem_id)

def compute_totals(df: pd.DataFrame) -> pd.DataFrame:
    """Add Total Mass/Volume columns based on pot counts."""
    df = df.copy()
    count = df["w (# pot)"] * df["l (# pot)"] * df["n (layers)"]
    df["Total Internal Volume"] = df["Internal Volume (mm^3)"] * count
    df["Total Mass Empty"]      = df["Mass (Empty) (kg)"]      * count
    df["Total Mass Wine"]       = df["Mass (Wine) (kg)"]       * count
    df["Total Mass Oil"]        = df["Mass (Oil) (kg)"]        * count
    return df

def tidy_data(stack_df, hd_df):
    stack_df["Category"] = stack_df["Test"].str.contains("hex", case=False)\
                                   .map({True:"Stack Hex", False:"Stack Rect"})
    hd_df["Category"]    = hd_df["Test"].str.contains("^drop", case=False, regex=True)\
                                   .map({True:"Drop", False:"Hold"})
    df = pd.concat([stack_df, hd_df], ignore_index=True)
    df["Amphora"] = (
        df["Amphorae"].astype(str).str.strip().str.replace(SUFFIX_RE, "", regex=True)
    )
    return compute_totals(df)

# ── UI population ────────────────────────────────────────────────────────────
async def populate_amp_list(df):
    box = await wait_for("ampList")
    box.innerHTML = ""
    for a in sorted(df["Amphora"].unique(), key=str.casefold):
        box.innerHTML += (
            f'<div class="form-check">'
            f'<input class="form-check-input" type="checkbox" value="{a}" id="chk_{a}" checked>'
            f'<label class="form-check-label" for="chk_{a}">{a}</label></div>'
        )

# ── plotting ─────────────────────────────────────────────────────────────────
def selection():
    amps = [e.value for e in document.querySelectorAll("#ampList input:checked")]
    x_field = document.getElementById("xSelect").value
    y_field = document.getElementById("ySelect").value
    mass_type = document.querySelector("input[name='massRad']:checked").value
    return amps, x_field, y_field, mass_type

def resolve_x(df, field, mass_type):
    if field == "Total Mass":
        return f"Total Mass {mass_type}"
    return field

def draw(df, *_):
    amps, x_raw, y_field, mass_type = selection()
    div = document.getElementById("plot")
    if not amps or x_raw == y_field:
        div.innerHTML = "<p class='text-muted'>Select amphorae and distinct axes.</p>"
        return

    x_field = resolve_x(df, x_raw, mass_type)
    sub = df[df["Amphora"].isin(amps)]
    if sub.empty or x_field not in sub.columns or y_field not in sub.columns:
        div.innerHTML = "<p>No data for selection.</p>"
        return

    fig = px.scatter(sub, x=x_field, y=y_field, color="Amphora",
                     symbol="Category", title=f"{y_field} vs {x_field}")
    display(fig, target="plot", append=False)

# ── main ─────────────────────────────────────────────────────────────────────
async def main():
    stack_df, hd_df = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))
    df = tidy_data(stack_df, hd_df)
    await populate_amp_list(df)
    draw(df)

    cb = create_proxy(lambda evt: draw(df))
    for sel_id in ("xSelect", "ySelect"):
        document.getElementById(sel_id).addEventListener("change", cb)
    for radio in document.querySelectorAll("input[name='massRad']"):
        radio.addEventListener("change", cb)
    for chk in document.querySelectorAll("#ampList input"):
        chk.addEventListener("change", cb)

asyncio.ensure_future(main())
