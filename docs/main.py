import asyncio
import micropip

async def main():
    await micropip.install("matplotlib")
    import matplotlib.pyplot as plt
    print("Matplotlib successfully installed and imported!")

# Kick off the async code
asyncio.run(main())


# Load CSVs
stack_df = pd.read_csv("amphorae_comp - stack.csv")
hold_df = pd.read_csv("amphorae_comp - hold-drop.csv")
drop_df = hold_df.copy()

# Label each DataFrame with its test type
stack_df["Category"] = "Stack"
hold_df["Category"] = "Hold"
drop_df["Category"] = "Drop"

# Combine all
df = pd.concat([stack_df, hold_df, drop_df], ignore_index=True)

# Drop duplicates and unify Amphora names (remove suffixes)
df["Amphorae"] = df["Amphorae"].astype(str).str.replace(r"(_rect|_hex|_empty|_wine|_oil)", "", regex=True)

# Ensure numeric values are valid
numeric_cols = [
    "Internal Volume (mm^3)",
    "Mass (Empty) (kg)",
    "Mass (Wine) (kg)",
    "Mass (Oil) (kg)",
    "Max Tensile (MPa)",
    "Max Compressive (MPa)",
    "Factor of Safety",
    "Load (N)",
    "w (# pot)", "l (# pot)", "n (layers)"
]
for col in numeric_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce")

# Axis computation
def compute_totals(df):
    df["Stack Count"] = df["w (# pot)"] * df["l (# pot)"] * df["n (layers)"]
    df["Total Mass (Empty)"] = df["Mass (Empty) (kg)"] * df["Stack Count"]
    df["Total Mass (Wine)"] = df["Mass (Wine) (kg)"] * df["Stack Count"]
    df["Total Mass (Oil)"] = df["Mass (Oil) (kg)"] * df["Stack Count"]
    df["Total Internal Volume"] = df["Internal Volume (mm^3)"] * df["Stack Count"]
    return df

df = compute_totals(df)

# Filter by selected test type
def get_filtered_df(selected_test):
    return df[df["Category"].fillna("") == selected_test]

# UI Elements
from pyweb import ui, run, html

with ui.row().classes("items-center"):
    ui.label("Select amphorae and distinct axes.")

with ui.row():
    with ui.column().classes("w-2/3"):
        plot = ui.pyplot(figsize=(6, 5))

    with ui.column().classes("w-1/3"):
        x_axis = ui.select(["Load (N)", "Total Mass", "Total Internal Volume"], label="X axis:")
        y_axis = ui.select(["Max Tensile (MPa)", "Max Compressive (MPa)", "Factor of Safety"], label="Y axis:")

        mass_type = ui.radio(["Empty", "Wine", "Oil"], value="Empty", label="Mass type:")
        test_type = ui.radio(["Stack", "Hold", "Drop"], value="Stack", label="Test type:")

        amp_checks = ui.checkbox_group([], label="Amphorae")

# Reactive update
@ui.effect
def populate_amp_list():
    selected_test = test_type.value
    dfx = get_filtered_df(selected_test)
    valid = dfx[dfx["Max Tensile (MPa)"].notna()]
    amp_options = sorted(valid["Amphorae"].dropna().unique())
    amp_checks.set_options(amp_options)

@ui.effect
def draw():
    selected_test = test_type.value
    x_field = x_axis.value
    y_field = y_axis.value
    mass_mode = mass_type.value
    amphorae = amp_checks.value

    if not x_field or not y_field or not amphorae:
        return

    dfx = get_filtered_df(selected_test)
    dfx = dfx[dfx["Amphorae"].isin(amphorae)]

    # Apply x-axis selection logic
    if x_field == "Total Mass":
        x_map = {
            "Empty": "Total Mass (Empty)",
            "Wine": "Total Mass (Wine)",
            "Oil": "Total Mass (Oil)"
        }
        x_data = dfx[x_map[mass_mode]]
        x_label = f"{mass_mode} Total Mass (kg)"
    elif x_field == "Total Internal Volume":
        x_data = dfx["Total Internal Volume"]
        x_label = "Internal Volume (mm³)"
    else:
        x_data = dfx["Load (N)"]
        x_label = "Load (N)"

    # Y-axis mapping
    y_map = {
        "Max Tensile (MPa)": "Max Tensile (MPa)",
        "Max Compressive (MPa)": "Max Compressive (MPa)",
        "Factor of Safety": "Factor of Safety"
    }
    y_data = dfx[y_map[y_field]]
    y_label = y_field

    # Plotting
    plt.clf()
    for amph in amphorae:
        sub = dfx[dfx["Amphorae"] == amph]
        plt.scatter(sub[x_data.name], sub[y_data.name], label=amph)

    plt.xlabel(x_label)
    plt.ylabel(y_label)
    plt.legend()
    plot.update()

run(title="Amphorae Interactive Explorer")
