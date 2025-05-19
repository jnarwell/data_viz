# install_and_plot.py

# Make sure matplotlib is installed first:
# Run in terminal: pip install matplotlib

import matplotlib.pyplot as plt

# Example amphorae tensile data
amphorae = ["Dressel_20", "Greco_Italic", "Bozburun", "RA_4"]
tensile_strength = [2.03, 21.03, 32.11, 56.22]  # MPa

def plot_amphorae_tensile():
    plt.figure(figsize=(10, 6))
    plt.bar(amphorae, tensile_strength, color="teal")
    plt.xlabel("Amphora Type")
    plt.ylabel("Max Tensile Strength (MPa)")
    plt.title("Tensile Strength of Amphorae")
    plt.grid(axis="y", linestyle="--", alpha=0.7)
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    plot_amphorae_tensile()
