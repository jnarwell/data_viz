import pandas as pd
import plotly.express as px
from js import window
from pyodide.ffi import create_proxy

# load & prep
stack_df = pd.read_csv("amphorae_comp - stack.csv")
hd_df    = pd.read_csv("amphorae_comp - hold-drop.csv")

def clean(col): return pd.to_numeric(col, errors="coerce")

# tidy & compute
stack_df["Total Pots"] = stack_df.eval("w (# pot) * l (# pot) * n (layers)")
for m in ["Empty","Wine","Oil"]:
    stack_df[f"Total Mass ({m})"] = stack_df[f"Mass ({m}) (kg)"] * stack_df["Total Pots"]
stack_df["Load (N)"] = clean(stack_df["Load (N)"])
stack_df["Max Tensile (MPa)"] = clean(stack_df["Max Tensile (MPa)"])
stack_df["Max Compressive (MPa)"] = clean(stack_df["Max Compressive (MPa)"])
stack_df["Factor of Safety"] = stack_df["Load (N)"] / (stack_df["Total Mass (Empty)"] + 1e-9)

# expose amphorae list
unique_amps = sorted(stack_df["Amphorae"].unique().tolist())
def populate_amphorae(amps):
    container = window.document.getElementById("amphoraeList")
    for a in amps:
        cb = window.document.createElement("input")
        cb.type = "checkbox"; cb.value = a; cb.checked = (a.startswith("Dressel"))
        cb.onchange = create_proxy(lambda e: window.update_plot_proxy())
        lbl = window.document.createElement("label")
        lbl.textContent = a
        container.append(cb, lbl, window.document.createElement("br"))

# the main draw:
def update_plot(x, y, mass, test, amps):
    df = stack_df[stack_df["Test"] == test].query("Amphorae in @amps")
    fig = px.scatter(df, x=x, y=y, text="Amphorae",
                     title=f"{y} vs {x} [{test} – {mass}]")
    fig.update_traces(textposition="top center")
    fig.update_layout(height=600, margin=dict(l=20,r=20,t=40,b=20))
    window.plot.innerHTML = ""             # clear
    window.plot.append(fig.to_html(include_plotlyjs='cdn'))

# create proxies & attach
window.update_plot_proxy = create_proxy(update_plot)
window.update_plot = window.update_plot_proxy
window.populate_amphorae = create_proxy(lambda : populate_amphorae(unique_amps))

# run once on load
window.populate_amphorae()
# draw default: Load vs Max Tensile for Dressel_20 & Dressel_1A
window.update_plot("Load (N)",
                   "Max Tensile (MPa)",
                   "Total Mass (Empty)",
                   "Stack",
                   ["Dressel_1A","Dressel_20"])
