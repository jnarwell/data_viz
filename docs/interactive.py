import pandas as pd, io, asyncio, re, json
from pyodide.http import pyfetch
from js import document
import plotly.express as px
from pyscript import display

# -------- data feeds ---------------------------------------------------------
STACK_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
HOLD_DROP_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?gid=145083070&single=true&output=csv"

SUFFIX_RE = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
TENS_RE   = re.compile(r"max.*tensile", re.I)

async def fetch_csv(url: str) -> pd.DataFrame:
    txt = await (await pyfetch(url)).text()
    return pd.read_csv(io.StringIO(txt))

async def load_data() -> pd.DataFrame:
    stack, hd = await asyncio.gather(fetch_csv(STACK_CSV), fetch_csv(HOLD_DROP_CSV))

    # normalise category and tensile column
    stack["Test Category"] = stack["Test"].str.contains("hex", case=False).map({True:"Stack Hex",False:"Stack Rect"})
    hd["Test Category"]    = hd["Test"].str.contains("^drop", case=False, regex=True).map({True:"Drop",False:"Hold"})

    data = pd.concat([stack, hd], ignore_index=True)

    # clean amphora names
    data["Amphora"] = data["Amphorae"].astype(str).str.strip().str.replace(SUFFIX_RE,"",regex=True)

    # locate numeric columns automatically
    numeric_cols = data.select_dtypes(include="number").columns.tolist()

    # keep a tidy subset for plotting
    keep_cols = ["Amphora","Test Category"] + numeric_cols
    return data[keep_cols]

# -------- UI helpers ---------------------------------------------------------
def populate_axes(df: pd.DataFrame):
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    x_sel = document.getElementById("xSelect")
    y_sel = document.getElementById("ySelect")
    opts  = "".join(f'<option value="{c}">{c}</option>' for c in numeric_cols)
    x_sel.innerHTML = opts
    y_sel.innerHTML = opts
    # default plot: Load (N) vs Max Tensile
    for sel, default_term in ((x_sel,"load"),(y_sel,"tensile")):
        for opt in sel.options:
            if default_term.lower() in opt.value.lower():
                opt.selected = True
                break

def populate_amphora(df: pd.DataFrame):
    amps = sorted(df["Amphora"].unique(), key=str.casefold)
    out  = []
    for a in amps:
        out.append(f'''
         <div class="form-check amp-item">
           <input class="form-check-input" type="checkbox" value="{a}" id="chk_{a}" checked>
           <label class="form-check-label" for="chk_{a}">{a}</label>
         </div>''')
    document.getElementById("ampList").innerHTML = "".join(out)

def get_selected_amphora() -> list[str]:
    checks = document.querySelectorAll("#ampList input[type=checkbox]")
    return [c.value for c in checks if c.checked]

def update_plot(df: pd.DataFrame, *_):
    amps = get_selected_amphora()
    xcol = document.getElementById("xSelect").value
    ycol = document.getElementById("ySelect").value

    sub  = df[df["Amphora"].isin(amps)]
    if sub.empty:
        document.getElementById("plot").innerHTML = "<p class='text-muted'>No amphora selected.</p>"
        return

    fig = px.scatter(
        sub, x=xcol, y=ycol,
        color="Amphora", symbol="Test Category",
        title=f"{ycol} vs {xcol}",
        height=600
    )
    display(fig, target="plot", append=False)

# -------- main ---------------------------------------------------------------
async def main():
    df = await load_data()
    populate_axes(df)
    populate_amphora(df)
    update_plot(df)

    # event listeners
    document.getElementById("xSelect").addEventListener("change", lambda e: update_plot(df))
    document.getElementById("ySelect").addEventListener("change", lambda e: update_plot(df))
    document.getElementById("ampList").addEventListener("change", lambda e: update_plot(df))

asyncio.ensure_future(main())
