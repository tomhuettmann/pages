function validateLog(raw) {
    const clean = {};
    for (const m of MEALS) {
        clean[m] = [];
        if (!raw || !Array.isArray(raw[m])) continue;
        for (const entry of raw[m]) {
            if (!entry || typeof entry.n !== 'string') continue;
            const cleaned = { n: entry.n };
            if (entry.amount != null) cleaned.amount = safeNum(entry.amount);
            for (const k of NUTRIENTS) cleaned[k] = safeNum(entry[k]);
            clean[m].push(cleaned);
        }
    }
    return clean;
}

// --- State ---

let log = validateLog(safeParse('foodLog', null));
let selectedProduct = null;
const storedMeal = safeGet('lastMeal');
const lastMeal = MEALS.includes(storedMeal) ? storedMeal : 'breakfast';

if (typeof PRODUCTS_DB === 'undefined') {
    const si = document.getElementById('search-input');
    si.parentNode.insertBefore(
        el('p', { className: 'muted' }, '⚠ Product database failed to load. Only custom products are available.'), si
    );
}

function getAllProducts() {
    return { ...serverProducts, ...customProducts };
}

function allEntries() {
    return MEALS.flatMap(m => log[m]);
}

function save(meal) {
    safeSet('foodLog', JSON.stringify(log));
    saveCustomProducts();
    if (meal) {
        safeSet('lastMeal', meal);
        document.getElementById('meal-select').value = meal;
        document.getElementById('q-meal-select').value = meal;
    }
}

function round(n) {
    return Math.round(n * 10) / 10;
}

// --- Renderers ---

function renderTotals() {
    const totals = {};
    for (const k of NUTRIENTS) totals[k] = 0;
    for (const entry of allEntries()) {
        for (const k of NUTRIENTS) totals[k] += entry[k];
    }
    document.getElementById('total-k').textContent = Math.round(totals.k);
    for (const k of NUTRIENTS.slice(1)) {
        document.getElementById('total-' + k).textContent = round(totals[k]) + 'g';
    }
}

function renderLog() {
    const container = document.getElementById('log-list');
    container.textContent = '';
    const allEmpty = MEALS.every(m => log[m].length === 0);
    if (allEmpty) {
        container.appendChild(el('p', { className: 'muted' }, 'No entries yet.'));
        return;
    }
    for (const meal of MEALS) {
        if (log[meal].length === 0) continue;
        const mealKcal = Math.round(log[meal].reduce((sum, e) => sum + e.k, 0));
        container.appendChild(el('h3', null, `${meal[0].toUpperCase() + meal.slice(1)} (${mealKcal} kcal)`));
        log[meal].forEach((entry, i) => {
            const label = entry.n + (entry.amount ? ' — ' + entry.amount + 'g' : '') + ` (${Math.round(entry.k)} kcal)`;
            const btn = el('button', null, '✕');
            btn.addEventListener('click', () => removeEntry(meal, i));
            container.appendChild(el('div', { className: 'log-item' }, [el('span', null, label), btn]));
        });
    }
}

function removeEntry(meal, index) {
    log[meal].splice(index, 1);
    save();
    renderTotals();
    renderLog();
}

// --- Search ---

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const amountSection = document.getElementById('amount-section');
const amountInput = document.getElementById('amount-input');
const selectedLabel = document.getElementById('selected-label');

searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (query.length < 2) {
        searchResults.classList.add('hidden');
        return;
    }
    const all = getAllProducts();
    const matches = Object.entries(all)
        .filter(([_, p]) => p.n.toLowerCase().includes(query))
        .slice(0, 20);

    if (matches.length === 0) {
        searchResults.classList.add('hidden');
        return;
    }

    searchResults.textContent = '';
    for (const [id, p] of matches) {
        const div = el('div', null, `${p.n} (${p.u}g)`);
        div.dataset.id = id;
        searchResults.appendChild(div);
    }
    searchResults.classList.remove('hidden');
});

searchResults.addEventListener('click', (e) => {
    const div = e.target.closest('[data-id]');
    if (!div) return;
    const all = getAllProducts();
    selectedProduct = all[div.dataset.id];
    if (!selectedProduct) return;
    selectedLabel.textContent = selectedProduct.n;
    amountInput.value = selectedProduct.u || '';
    amountSection.classList.remove('hidden');
    searchResults.classList.add('hidden');
    searchInput.value = '';
    amountInput.focus();
});

document.getElementById('add-btn').addEventListener('click', () => {
    if (!selectedProduct) return;
    const amount = safeNum(parseFloat(amountInput.value));
    if (amount <= 0) return;
    const meal = document.getElementById('meal-select').value;
    const factor = amount / 100;

    const entry = { n: selectedProduct.n, amount: amount };
    for (const k of NUTRIENTS) entry[k] = round(selectedProduct[k] * factor);
    log[meal].push(entry);

    save(meal);
    renderTotals();
    renderLog();
    selectedProduct = null;
    amountSection.classList.add('hidden');
    amountInput.value = '';
});

amountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('add-btn').click();
    }
});

// --- Reset ---

document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Reset all tracked food?')) {
        log = { breakfast: [], lunch: [], dinner: [], snacks: [] };
        save('breakfast');
        renderTotals();
        renderLog();
    }
});

// --- Quick entry ---

document.getElementById('quick-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = document.getElementById('q-n').value.trim();
    const k = safeNum(parseFloat(document.getElementById('q-k').value));
    if (!n || k <= 0) return;
    const meal = document.getElementById('q-meal-select').value;
    const entry = { n: n, k: k };
    for (const k of NUTRIENTS.slice(1)) entry[k] = safeNum(parseFloat(document.getElementById('q-' + k).value));
    log[meal].push(entry);
    save(meal);
    renderTotals();
    renderLog();
    e.target.reset();
});

// --- Initial render ---

document.getElementById('meal-select').value = lastMeal;
document.getElementById('q-meal-select').value = lastMeal;
renderTotals();
renderLog();
