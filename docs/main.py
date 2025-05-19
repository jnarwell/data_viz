import pandas as pd, io, asyncio, re
from pyodide.http import pyfetch
from js import document
from pyodide.ffi import create_proxy
import plotly.express as px
from pyscript import display

"""-------------------------------------------------------------
Amphorae Interactive Explorer – single‑page PyScript app
-------------------------------------------------------
• X‑axis choices: Load (N) | Total Mass | Total Internal Volume
• Y‑axis choices: Max Tensile | Max Compressive | Factor of Safety
• Mass type toggle: Empty | Wine | Oil (applies when X == Total Mass)
• Test‑type toggle: Stack | Hold | Drop — filters both data set & list
• Amphorae checklist updates dynamically per selected test type
  and controls what traces are shown.

No matplotlib!  Everything is rendered with Plotly Express, so the
page works out‑of‑the‑box without installing extra wheels in Pyodide.
"""

# ────────────────────────────── CSV feeds ────────────────────────────────────
STACK_CSV = (
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-"
    "JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
)
HOLD_DROP_CSV = (
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-"
    "JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"
)
CSV_FEEDS = [STACK_CSV, HOLD_DROP_CSV]
SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)

# ───────────────────────────── helper fns ────────────────────────────────────
async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

async def wait_for(elem_id: str):
    while document.getElementById(elem_id) is None:
        await asyncio.sleep(0.01)
    return document.getElementById(elem_id)

# numeric coercion & total‑column builder

def compute_totals(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # ensure pot‑count columns exist
    for col in ["w (# pot)", "l (# pot)", "n (layers)"]:
        if col not in df.columns:
            df[col] = 1

    # locate per‑pot mass / volume columns by keyword
    vol_col   = next(c for c in df.columns if "internal volume" in c.lower())
    empty_col = next(c for c in df.columns if "mass" in c.lower() and "empty" in c.lower())
    wine_col  = next(c for c in df.columns if "mass" in c.lower() and "wine"  in c.lower())
    oil_col   = next(c for c in df.columns if "mass" in c.lower() and "oil"   in c.lower())

    num_cols = ["w (# pot)", "l (# pot)", "n (layers)", vol_col, empty_col, wine_col, oil_col]
    df[num_cols] = df[num_cols].apply(lambda s: pd.to_numeric(s, errors="coerce"))

    # counts → 1 if NaN   |   per‑pot metrics → 0 if NaN
    df[["w (# pot)", "l (# pot)", "n (layers)"]] = df[["w (# pot)", "l (# pot)", "n (layers)"]].fillna(1)
    df[[vol_col, empty_col, wine_col, oil_col]] = df[[vol_col, empty_col, wine_col, oil_col]].fillna(0)

    count = df["w (# pot)"] * df["l (# pot)"] * df["n (layers)"]
    df["Total Internal Volume"] = df[vol_col]   * count
    df["Total Mass Empty"]      = df[empty_col] * count
    df["Total Mass Wine"]       = df[wine_col]  * count
    df["Total Mass Oil"]        = df[oil_col]   * count
    return df

# tidy: unify category + amphora name, then compute totals

def tidy(stack_df: pd.DataFrame, hd_df: pd.DataFrame) -> pd.DataFrame:
    stack_df["Category"] = stack_df["Test"].str.contains("hex", case=False).map({True: "Stack Hex", False: "Stack Rect"})
    hd_df["Category"] = hd_df["Test"].str.contains(r"^drop", case=False, regex=True).map({True: "Drop", False: "Hold"})

    df = pd.concat([stack_df, hd_df], ignore_index=True)
    df["Amphora"] = df["Amphorae"].astype(str).str.strip().str.replace(SUFFIX_RE, "", regex=True)
    return compute_totals(df)

# ─────────────────────────── UI helpers ──────────────────────────────────────
async def refresh_amphora_list(df: pd.DataFrame, test_choice: str):
    box = await wait_for("ampList")
    box.innerHTML = ""
    if test_choice == "Stack":
        mask = df["Category"].fillna("").str.contains("Stack")
    else:
        mask = df["Category"].fillna("") == test_choice
    amps = sorted(df[mask]["Amphora"].unique(), key=str.casefold)

    for a in amps:
        box.innerHTML += (
            f'<div class="form-check"><input class="form-check-input" type="checkbox" value="{a}" id="chk_{a}" checked>'
            f'<label class="form-check-label" for="chk_{a}">{a}</label></div>'
        )

# selection helpers

def current_selection():
    amps = [e.value for e in document.querySelectorAll("#ampList input:checked")]
    x_raw = document.getElementById("xSelect").value
    y_field = document.getElementById("ySelect").value
    mass_type = document.querySelector("input[name='massRad']:checked").value
    test_choice = document.querySelector("input[name='testRad']:checked").value
    return amps, x_raw, y_field, mass_type, test_choice

def subset_by_test(df: pd.DataFrame, test_choice: str):
    if test_choice == "Stack":
        return df[df["Category"].fillna("").str.contains("Stack")]
    return df[df["Category"].fillna("") == test_choice]

# resolve x‑axis column name

def x_column(field: str, mass_type: str):
    return f"Total Mass {mass_type}" if field == "Total Mass" else field

# draw plot

def draw(df: pd.DataFrame, *_):
    amps, x_raw, y_field, mass_type, test_choice = current_selection()
    div = document.getElementById("plot")

    if not amps or x_raw == y_field:
        div.innerHTML = "<p class='text-muted'>Select amphorae and distinct axes.</p>"
        return

    df_test = subset_by_test(df, test_choice)
    x_field = x_column(x_raw, mass_type)

    sub = df_test[df_test["Amphora"].isin(amps)]
    if sub.empty or x_field not in sub.columns or y_field not in sub.columns:
        div.innerHTML = "<p>No data for selection.</p>"
        return

    fig = px.scatter(sub, x=x_field, y=y_field, color="Amphora", symbol="Category",
                     title=f"{y_field} vs {x_field} – {test_choice}")
    display(fig, target="plot", append=False)

# ─────────────────────────────── main ────────────────────────────────────────
async def main():
    # load data concurrently
    stack_df, hd_df = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))
    df = tidy(stack_df, hd_df)

    # initial UI population
    await refresh_amphora_list(df, "Stack")
    draw(df)

    cb_draw = create_proxy(lambda evt: draw(df))
    cb_test = create_proxy(lambda evt: asyncio.ensure_future(refresh_amphora_list(df, current_selection()[4])) or draw(df))

    # connect listeners
    for sel_id in ("xSelect", "ySelect"):
        document.getElementById(sel_id).addEventListener("change", cb_draw)
    for radio in document.querySelectorAll("input[name='massRad']"):
        radio.addEventListener("change", cb_draw)
    for radio in document.querySelectorAll("input[name='testRad']"):
        radio.addEventListener("change", cb_test)

# kick off
asyncio.ensure_future(main())
