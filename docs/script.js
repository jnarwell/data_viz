async function main() {
  let pyodide = await loadPyodide();
  await micropip.install("micropip")
  await pyodide.loadPackage("micropip");
  await pyodide.runPythonAsync(`
import micropip
await micropip.install("matplotlib")
import matplotlib.pyplot as plt
# now safe to use matplotlib in your embedded Python
`);
}
main();
