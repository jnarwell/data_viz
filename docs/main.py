import pandas as pd
import matplotlib.pyplot as plt
import os

# Load CSVs (assumes files are in the same directory as this script)
STACK_PATH = 'amphorae_comp - stack.csv'
HOLD_DROP_PATH = 'amphorae_comp - hold-drop.csv'

def load_data():
    stack_df = pd.read_csv(STACK_PATH)
    hd_df = pd.read_csv(HOLD_DROP_PATH)
    return stack_df, hd_df

def clean_column(col):
    try:
        return pd.to_numeric(col, errors='coerce')
    except:
        return col

def tidy_data(stack_df, hd_df):
    stack_df['Test'] = stack_df['Test'].str.strip()
    hd_df['Test'] = hd_df['Test'].str.strip()

    stack_df['Mass (Empty) (kg)'] = clean_column(stack_df['Mass (Empty) (kg)'])
    stack_df['Mass (Wine) (kg)'] = clean_column(stack_df['Mass (Wine) (kg)'])
    stack_df['Mass (Oil) (kg)'] = clean_column(stack_df['Mass (Oil) (kg)'])
    stack_df['Internal Volume (mm^3)'] = clean_column(stack_df['Internal Volume (mm^3)'])
    stack_df['w (# pot)'] = clean_column(stack_df['w (# pot)'])
    stack_df['l (# pot)'] = clean_column(stack_df['l (# pot)'])
    stack_df['n (layers)'] = clean_column(stack_df['n (layers)'])

    return stack_df, hd_df

def compute_totals(df):
    df['Total Pots'] = df['w (# pot)'] * df['l (# pot)'] * df['n (layers)']
    df['Total Mass (Empty)'] = df['Mass (Empty) (kg)'] * df['Total Pots']
    df['Total Mass (Wine)'] = df['Mass (Wine) (kg)'] * df['Total Pots']
    df['Total Mass (Oil)'] = df['Mass (Oil) (kg)'] * df['Total Pots']
    df['Total Volume'] = df['Internal Volume (mm^3)'] * df['Total Pots']
    df['Load (N)'] = clean_column(df['Load (N)'])
    return df

def plot_xy(df, amphorae_list, x_axis, y_axis, title):
    df = df[df['Amphorae'].isin(amphorae_list)]
    x = df[x_axis]
    y = df[y_axis]

    plt.figure(figsize=(10, 6))
    plt.scatter(x, y, c='darkred')
    for i, txt in enumerate(df['Amphorae']):
        plt.annotate(txt, (x.iat[i], y.iat[i]), fontsize=9, alpha=0.8)

    plt.xlabel(x_axis)
    plt.ylabel(y_axis)
    plt.title(title)
    plt.grid(True, linestyle='--', alpha=0.7)
    plt.tight_layout()
    plt.show()

if __name__ == '__main__':
    if not os.path.exists(STACK_PATH) or not os.path.exists(HOLD_DROP_PATH):
        raise FileNotFoundError("One or both CSV files not found.")

    stack_df, hd_df = load_data()
    stack_df, hd_df = tidy_data(stack_df, hd_df)
    stack_df = compute_totals(stack_df)

    # Customize below
    selected_amphorae = ['Dressel_20', 'Greco_Italic', 'Bozburun']
    x_axis = 'Total Mass (Wine)'
    y_axis = 'Max Tensile (MPa)'

    plot_xy(stack_df, selected_amphorae, x_axis, y_axis, "Tensile Strength vs Wine Mass")
