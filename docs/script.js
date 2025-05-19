(async () => {
  const url = 'https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:json';
  async function fetchData() {
    const res = await fetch(url);
    const text = await res.text();
    const json = JSON.parse(text.substring(47, text.length - 2));
    const cols = json.table.cols.map(c => c.label);
    const rows = json.table.rows.map(r => r.c.map(c => c ? c.v : null));
    const data = rows.map(r => Object.fromEntries(r.map((v, i) => [cols[i], v])));
    console.log(data);
  }
  await fetchData();
})();
