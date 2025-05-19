import pandas as pd, io, re, asyncio
from pyodide.http import pyfetch
from js import document

# ------------------------------------------------------------------
CSV_URLS = [
    # ▶ Hold / Drop tab  (gid = 145083070)
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?"
    "gid=145083070&single=true&output=csv",

    # ▶ Stack tab  (gid = 0)  ← the link you just shared
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ92JwmYi97ikmGypcynINdCa0m4WMSwycoihoOkv-JXiWlHhwiOwfhyhFeGg_B4n3nqwScrMYUQCXp/pub?output=csv",
] # "https://docs.google.com/spreadsheets/d/e/.../pub?gid=0&single=true&output=csv",
# Anything that’s purely a test-type, not a pot name
DROP_WORDS = re.compile(r"^(drop|hold(_.*)?|test|sample)$", re.I)
SUFFIXES   = re.compile(r"_(rect|hex|oil|wine|empty|hold.*|drop.*)$", re.I)
# ------------------------------------------------------------------


async def fetch_csv(url: str) -> pd.DataFrame:
    resp = await pyfetch(url)
    text = await resp.text()
    return pd.read_csv(io.StringIO(text))


def find_amphora_column(df: pd.DataFrame) -> str | None:
    for c in df.columns:
        cl = c.lower()
        if cl.startswith("amphora"):
            return c
    return None


def collect_names(df: pd.DataFrame) -> list[str]:
    col = find_amphora_column(df)
    if not col:
        return []
    return (
        df[col]
        .dropna()
        .astype(str)
        .str.strip()
        .str.replace(SUFFIXES, "", regex=True)
        .tolist()
    )


async def main():
    ul = document.getElementById("ampList")
    ul.innerHTML = "loading…"

    try:
        dfs   = await asyncio.gather(*(fetch_csv(u) for u in CSV_URLS))
        names = []
        for df in dfs:
            names.extend(collect_names(df))

        # tidy up
        names = {
            n for n in names
            if n and not DROP_WORDS.match(n)
        }
        names = sorted(names, key=str.casefold)

        ul.innerHTML = ""
        if not names:
            ul.innerHTML = "No Amphora names found—check that both tabs are published."
            return

        for n in names:
            li = document.createElement("li")
            li.textContent = n
            ul.appendChild(li)

    except Exception as e:
        ul.innerHTML = f"Error: {e}"

asyncio.ensure_future(main())
