// script.js

// grab checked amphorae
function getCheckedAmphorae() {
  return Array.from(
    document.querySelectorAll('input[name="amphorae"]:checked')
  ).map(cb => cb.value);
}

// when anything changes, re-run the Python plotting fn
async function onControlChange() {
  const x = document.getElementById('x-axis').value;
  const y = document.getElementById('y-axis').value;
  const massType = document.querySelector('input[name="mass-type"]:checked').value;
  const testType = document.querySelector('input[name="test-type"]:checked').value;
  const amps = getCheckedAmphorae();

  // pass JS values into Python
  await window.pyodide.runPythonAsync(`
from main import update_plot
update_plot(
    x_axis="${x}",
    y_axis="${y}",
    mass_type="${massType}",
    test_type="${testType}",
    amphorae_list=${JSON.stringify(amps)}
)
`);
}

// wire up all the inputs
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('x-axis').addEventListener('change', onControlChange);
  document.getElementById('y-axis').addEventListener('change', onControlChange);
  document.querySelectorAll('input[name="mass-type"]')
          .forEach(el => el.addEventListener('change', onControlChange));
  document.querySelectorAll('input[name="test-type"]')
          .forEach(el => el.addEventListener('change', onControlChange));
  document.getElementById('amphorae-container')
          .addEventListener('change', e => {
            if (e.target.name === 'amphorae') onControlChange();
          });

  // first draw
  onControlChange();
});
