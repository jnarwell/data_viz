import pandas as pd, io, asyncio, re
from pyodide.http import pyfetch
from js import document
import pyodide, plotly.express as px
from pyodide.ffi import create_proxy
from pyscript import display

# ── CSV feeds ────────────────────────────────────────────────────────────────
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
    df = df.copy()

    # guarantee pot-count columns
    for col in ["w (# pot)", "l (# pot)", "n (layers)"]:
        if col not in df.columns:
            df[col] = 1

    # locate mass / volume columns
    vol_col   = next(c for c in df.columns if "internal volume" in c.lower())
    empty_col = next(c for c in df.columns if "mass" in c.lower() and "empty" in c.lower())
    wine_col  = next(c for c in df.columns if "mass" in c.lower() and "wine"  in c.lower())
    oil_col   = next(c for c in df.columns if "mass" in c.lower() and "oil"   in c.lower())

    numeric_cols = ["w (# pot)", "l (# pot)", "n (layers)",
                    vol_col, empty_col, wine_col, oil_col]
    df[numeric_cols] = df[numeric_cols].apply(lambda s: pd.to_numeric(s, errors="coerce"))

    df[["w (# pot)", "l (# pot)", "n (layers)"]] = \
        df[["w (# pot)", "l (# pot)", "n (layers)"]].fillna(1)

    df[[vol_col, empty_col, wine_col, oil_col]] = \
        df[[vol_col, empty_col, wine_col, oil_col]].fillna(0)

    count = df["w (# pot)"] * df["l (# pot)"] * df["n (layers)"]
    df["Total Internal Volume"] = df[vol_col]   * count
    df["Total Mass Empty"]      = df[empty_col] * count
    df["Total Mass Wine"]       = df[wine_col]  * count
    df["Total Mass Oil"]        = df[oil_col]   * count
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
async def populate_amp_list(df, test_choice):
    box = await wait_for("ampList")
    box.innerHTML = ""
    if test_choice == "Stack":
        mask = df["Category"].fillna("").str.contains("Stack")
    else:
        mask = df["Category"].fillna("") == test_choice
    amps = sorted(df[mask]["Amphora"].unique(), key=str.casefold)
    for a in amps:
        box.innerHTML += (
            f'<div class="form-check">'
            f'<input class="form-check-input" type="checkbox" value="{a}" id="chk_{a}" checked>'
            f'<label class="form-check-label" for="chk_{a}">{a}</label></div>'
        )

# ── plotting ─────────────────────────────────────────────────────────────────
def selection():
    amps = [e.value for e in document.querySelectorAll("#ampList input:checked")]
    x_raw = document.getElementById("xSelect").value
    y_field = document.getElementById("ySelect").value
    mass_type = document.querySelector("input[name='massRad']:checked").value
    test_choice = document.querySelector("input[name='testRad']:checked").value
    return amps, x_raw, y_field, mass_type, test_choice

def resolve_x(df, field, mass_type):
    return f"Total Mass {mass_type}" if field == "Total Mass" else field

def subset_by_test(df, test_choice):
    if test_choice == "Stack":
        return df[df["Category"].str.contains("Stack")]
    return df[df["Category"] == test_choice]

def draw(df, *_):
    amps, x_raw, y_field, mass_type, test_choice = selection()
    div = document.getElementById("plot")
    if not amps or x_raw == y_field:
        div.innerHTML = "<p class='text-muted'>Select amphorae and distinct axes.</p>"
        return

    filtered = subset_by_test(df, test_choice)
    x_field = resolve_x(filtered, x_raw, mass_type)
    sub = filtered[filtered["Amphora"].isin(amps)]
    if sub.empty or x_field not in sub.columns or y_field not in sub.columns:
        div.innerHTML = "<p>No data for selection.</p>"
        return

    fig = px.scatter(sub, x=x_field, y=y_field, color="Amphora",
                     symbol="Category", title=f"{y_field} vs {x_field} – {test_choice}")
    display(fig, target="plot", append=False)

# ── main ─────────────────────────────────────────────────────────────────────
async def main():
    stack_df, hd_df = await asyncio.gather(*(fetch_csv(u) for u in CSV_FEEDS))
    df = tidy_data(stack_df, hd_df)
    await populate_amp_list(df, "Stack")
    draw(df)

    cb_draw  = create_proxy(lambda evt: draw(df))
    cb_test  = create_proxy(lambda evt: asyncio.ensure_future(populate_amp_list(df, selection()[4])) or draw(df))

    for sel_id in ("xSelect", "ySelect"):
        document.getElementById(sel_id).addEventListener("change", cb_draw)
    for radio in document.querySelectorAll("input[name='massRad']"):
        radio.addEventListener("change", cb_draw)
    for radio in document.querySelectorAll("input[name='testRad']"):
        radio.addEventListener("change", cb_test)

asyncio.ensure_future(main())
