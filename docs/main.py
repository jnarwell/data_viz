import pandas as pd, io, asyncio
from pyodide.http import pyfetch
from js import document   # manipulate DOM

# ------------------------------------------------------------------
CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-"
    "JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv"
)
# ------------------------------------------------------------------

async def fetch_csv(url: str) -> pd.DataFrame:
    """Download CSV text and return DataFrame."""
    resp = await pyfetch(url)
    text = await resp.text()
    return pd.read_csv(io.StringIO(text))

def detect_name_column(df: pd.DataFrame) -> str | None:
    """Return first non-numeric column name."""
    for c in df.columns:
        if not pd.api.types.is_numeric_dtype(df[c]):
            return c
    return None

async def main():
    ul = document.getElementById("ampList")
    ul.innerHTML = "loading…"

    try:
        df = await fetch_csv(CSV_URL)
        name_col = detect_name_column(df)

        if not name_col:
            ul.innerHTML = "Unable to find a text column in CSV."
            return

        names = (
            df[name_col]
            .dropna()
            .astype(str)
            .str.strip()
            .unique()
        )
        names.sort()

        ul.innerHTML = ""  # clear loading text
        for n in names:
            li = document.createElement("li")
            li.textContent = n
            ul.appendChild(li)

    except Exception as e:
        ul.innerHTML = f"Error loading CSV: {e}"

asyncio.ensure_future(main())
