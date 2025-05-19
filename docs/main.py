import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ------------------------------------------------------------------
CSV_URLS = [
    # Stack / summary tab
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-"
    "JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv",
    # ➕ If you publish the second sheet as CSV, drop its URL here too
]
SUFFIX_PATTERN = re.compile(r"_(rect|hex|hold.*|drop.*|oil|wine|empty)$", re.I)
# ------------------------------------------------------------------


async def fetch_csv(url: str) -> pd.DataFrame:
    resp = await pyfetch(url)
    text = await resp.text()
    return pd.read_csv(io.StringIO(text))


def extract_clean_names(df: pd.DataFrame) -> list[str]:
    # find column called 'Amphorae' (case-insensitive)
    name_col = next((c for c in df.columns if c.lower() == "amphorae"), None)
    if not name_col:
        return []

    names = (
        df[name_col]
        .dropna()
        .astype(str)
        .str.strip()
        .str.replace(SUFFIX_PATTERN, "", regex=True)  # strip suffixes
        .unique()
    )
    return sorted(names, key=str.casefold)


async def main():
    ul = document.getElementById("ampList")
    ul.innerHTML = "loading…"

    try:
        dfs   = await asyncio.gather(*(fetch_csv(u) for u in CSV_URLS))
        names = []
        for df in dfs:
            names.extend(extract_clean_names(df))

        names = sorted(set(names), key=str.casefold)

        ul.innerHTML = ""
        if not names:
            ul.innerHTML = "No Amphorae column found in any CSV."
            return

        for n in names:
            li = document.createElement("li")
            li.textContent = n
            ul.appendChild(li)

    except Exception as e:
        ul.innerHTML = f"Error loading CSV: {e}"

asyncio.ensure_future(main())
