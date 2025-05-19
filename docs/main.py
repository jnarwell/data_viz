# main.py

import pandas as pd
import plotly.express as px
from js import document

# --- 1) Load & tidy data once on startup ---
STACK_CSV = 'amphorae_comp - stack.csv'
HD_CSV    = 'amphorae_comp - hold-drop.csv'

def load_and_prepare():
    s = pd.read_csv(STACK_CSV).rename(columns=str.strip)
    h = pd.read_csv(HD_CSV   ).rename(columns=str.strip)

    # coerce numeric columns
    for col in ['Mass (Empty) (kg)','Mass (Wine) (kg)','Mass (Oil) (kg)',
                'Internal Volume (mm^3)','w (# pot)','l (# pot)','n (layers)','Load (N)',
                'Max Tensile (MPa)','Max Compressive (MPa)','Factor of Safety']:
        if col in s.columns:
            s[col] = pd.to_numeric(s[col],errors='coerce')
        if col in h.columns:
            h[col] = pd.to_numeric(h[col],errors='coerce')

    # compute totals for stacking
    s['Total Pots']          = s['w (# pot)'] * s['l (# pot)'] * s['n (layers)']
    s['Total Mass (Empty)']  = s['Mass (Empty) (kg)'] * s['Total Pots']
    s['Total Mass (Wine)']   = s['Mass (Wine) (kg)']  * s['Total Pots']
    s['Total Mass (Oil)']    = s['Mass (Oil) (kg)']   * s['Total Pots']
    s['Total Volume']        = s['Internal Volume (mm^3)'] * s['Total Pots']

    # unify into one DataFrame
    s['Test'] = 'Stack'
    df = pd.concat([s, h], ignore_index=True, sort=False)
    df['Amphorae'] = df['Amphorae'].str.strip()
    return df

_all_data = load_and_prepare()


# --- 2) Populate the amphorae checklist on the page ---
def init_amphorae_list():
    amps = sorted(_all_data['Amphorae'].dropna().unique())
    container = document.getElementById('amphorae-container')
    for a in amps:
        chk = document.createElement('input')
        chk.type = 'checkbox'
        chk.name = 'amphorae'
        chk.value = a
        chk.checked = True
        lbl = document.createElement('label')
        lbl.style.display = 'block'
        lbl_text = document.createTextNode(' ' + a)
        lbl.appendChild(chk)
        lbl.appendChild(lbl_text)
        container.appendChild(lbl)

# run once at startup
init_amphorae_list()


# --- 3) Called from script.js on any control change ---
def update_plot(x_axis, y_axis, mass_type, test_type, amphorae_list):
    df = _all_data.query("Test == @test_type and Amphorae in @amphorae_list")

    # pick the correct mass column if needed
    if x_axis.startswith("Total Mass"):
        x = df[f"Total Mass ({mass_type})"]
    else:
        x = df[x_axis]

    if y_axis.startswith("Total Mass"):
        y = df[f"Total Mass ({mass_type})"]
    else:
        y = df[y_axis]

    fig = px.scatter(
        df, x=x, y=y,
        hover_name='Amphorae',
        title=f"{test_type} — {x_axis} vs {y_axis}"
    )

    out = document.getElementById('pyplot')
    out.innerHTML = ''
    out.appendChild(
        fig.to_html(full_html=False, include_plotlyjs='cdn', default_height=400)
        .to_python()  # convert JS string → DOM node
    )
