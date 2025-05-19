import asyncio
import pandas as pd
import plotly.express as px
from js import document
from pyodide.ffi import create_proxy

# --- publish‐to‐web CSV URLs ---
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv&gid=145083070"
HD_CSV    = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv&gid=0"

# load & preprocess
def load_data():
    stack = pd.read_csv(STACK_CSV)
    hd    = pd.read_csv(HD_CSV)
    # ensure the Test column is trimmed
    for df in (stack, hd):
        df["Test"] = df["Test"].astype(str).str.strip()
    return stack, hd

# compute totals on the "stack" sheet
def compute_totals(df):
    # coerce numeric columns
    for c in ["Mass (Empty) (kg)", "Mass (Wine) (kg)", "Mass (Oil) (kg)",
              "Internal Volume (mm^3)", "w (# pot)", "l (# pot)", "n (layers)", "Load (N)"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    # totals
    df["Total Pots"]       = df["w (# pot)"] * df["l (# pot)"] * df["n (layers)"]
    df["Total Mass Empty"] = df["Mass (Empty) (kg)"] * df["Total Pots"]
    df["Total Mass Wine"]  = df["Mass (Wine) (kg)"]  * df["Total Pots"]
    df["Total Mass Oil"]   = df["Mass (Oil) (kg)"]   * df["Total Pots"]
    df["Total Volume"]     = df["Internal Volume (mm^3)"] * df["Total Pots"]
    return df

# read both sheets once
STACK_DF, HD_DF = load_data()
STACK_DF = compute_totals(STACK_DF)

# DOM refs
plot_div   = document.getElementById("plot")
amp_list   = document.getElementById("ampList")
x_select   = document.getElementById("xSelect")
y_select   = document.getElementById("ySelect")

# helper to read current selections
def current_selection():
    mass_type = document.querySelector("input[name='massRad']:checked").value
    test_type = document.querySelector("input[name='testRad']:checked").value
    x_axis    = x_select.value
    y_axis    = y_select.value
    # gather checked amphorae
    amps = []
    for cb in amp_list.querySelectorAll("input[type=checkbox]"):
        if cb.checked:
            amps.append(cb.value)
    return mass_type, test_type, x_axis, y_axis, amps

# repopulate the amphorae checkbox list
async def refresh_amphora_list(*_):
    mass_type, test_type, *_ = current_selection()
    # pick the correct df & column
    df = STACK_DF if test_type == "Stack" else HD_DF
    # filter on Test == test_type AND at least some Max Tensile/Compress column non‐null
    colname = "Max Tensile (MPa)" if test_type != "Drop" else "Max Tensile (MPa)"
    # allow whichever max column is present
    valid = df[df["Test"] == test_type]
    valid = valid[~valid[colname].isna()]
    unique = sorted(valid["Amphorae"].unique())
    # rebuild
    amp_list.innerHTML = ""
    for amp in unique:
        box = document.createElement("label")
        box.innerHTML = f"<input type='checkbox' value='{amp}' checked> {amp}<br/>"
        amp_list.appendChild(box)

# draw the Plotly scatter
def draw(*_):
    mass_type, test_type, x_axis, y_axis, amps = current_selection()
    # pick df & column‐mapping
    if test_type == "Stack":
        df = STACK_DF.copy()
        colmap = {
            "Load (N)":     "Load (N)",
            "Total Mass":   f"Total Mass {mass_type}",
            "Total Internal Volume": "Total Volume"
        }
    else:
        df = HD_DF.copy()
        colmap = {
            "Load (N)":     "Max Load (N)",              # assuming HD sheet has this
            "Total Mass":   f"Mass ({mass_type}) (kg)",   # per‐pot
            "Total Internal Volume": "Internal Volume (mm^3)"
        }

    # filter
    df = df[df["Test"] == test_type]
    df = df[df["Amphorae"].isin(amps)]
    # map axes
    xcol = colmap[x_axis]
    ycol = colmap[y_axis]
    # Plotly
    fig = px.scatter(
        df, x=xcol, y=ycol, text="Amphorae",
        title=f"{test_type}: {y_axis} vs {x_axis}",
        height=600
    )
    fig.update_traces(textposition="top center")
    plot_div.innerHTML = ""
    plot_div.appendChild(fig.to_html(full_html=False))

# bridge handlers into JS events
cb_draw = create_proxy(lambda e: draw())
cb_list = create_proxy(lambda e: asyncio.ensure_future(refresh_amphora_list()) or draw())

# wire them up
x_select.addEventListener("change", cb_draw)
y_select.addEventListener("change", cb_draw)
for r in document.querySelectorAll("input[name='massRad'], input[name='testRad']"):
    r.addEventListener("change", cb_list)

# initial
asyncio.ensure_future(refresh_amphora_list())
asyncio.ensure_future(draw())
