(() => {
  const rows = document.getElementById('ingredientRows');
  if (!rows) return;

  const packaging = document.getElementById('packaging');
  const labor = document.getElementById('labor');
  const overhead = document.getElementById('overhead');
  const targetMargin = document.getElementById('targetMargin');
  const sellingPrice = document.getElementById('sellingPrice');
  const addIngredient = document.getElementById('addIngredient');

  const outIngredients = document.getElementById('resultIngredients');
  const outCost = document.getElementById('resultCost');
  const outSuggested = document.getElementById('resultSuggested');
  const outProfit = document.getElementById('resultProfit');
  const outMargin = document.getElementById('resultMargin');

  const money = value => `$${Number.isFinite(value) ? value.toFixed(2) : '0.00'}`;
  const numberValue = input => Math.max(0, Number.parseFloat(input?.value) || 0);

  function calculate() {
    const ingredientTotal = [...document.querySelectorAll('.ingredient-cost')]
      .reduce((sum, input) => sum + numberValue(input), 0);
    const totalCost = ingredientTotal + numberValue(packaging) + numberValue(labor) + numberValue(overhead);
    const marginTarget = Math.min(99, numberValue(targetMargin));
    const suggested = totalCost === 0 ? 0 : totalCost / (1 - marginTarget / 100);
    const sale = numberValue(sellingPrice);
    const profit = sale - totalCost;
    const margin = sale > 0 ? (profit / sale) * 100 : 0;

    outIngredients.textContent = money(ingredientTotal);
    outCost.textContent = money(totalCost);
    outSuggested.textContent = money(suggested);
    outProfit.textContent = money(profit);
    outMargin.textContent = `${margin.toFixed(1)}%`;
    outProfit.className = profit >= 0 ? 'result-positive' : 'result-negative';
    outMargin.className = margin >= 0 ? 'result-positive' : 'result-negative';
  }

  function bindRow(row) {
    row.querySelectorAll('input').forEach(input => input.addEventListener('input', calculate));
    const remove = row.querySelector('.remove-row');
    if (remove) {
      remove.addEventListener('click', () => {
        if (rows.children.length === 1) {
          row.querySelectorAll('input').forEach(input => { input.value = input.classList.contains('ingredient-cost') ? '0' : ''; });
        } else {
          row.remove();
        }
        calculate();
      });
    }
  }

  [...rows.children].forEach(bindRow);
  [packaging, labor, overhead, targetMargin, sellingPrice].forEach(input => input?.addEventListener('input', calculate));

  addIngredient?.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'ingredient-row';
    row.innerHTML = '<div class="field"><label>Ingredient</label><input type="text" placeholder="e.g. Cream" aria-label="Ingredient name"></div><div class="field"><label>Cost</label><input class="ingredient-cost" type="number" min="0" step="0.01" value="0" aria-label="Ingredient cost"></div><button class="remove-row" type="button" aria-label="Remove ingredient">×</button>';
    rows.appendChild(row);
    bindRow(row);
    row.querySelector('input')?.focus();
    calculate();
  });

  calculate();
})();
