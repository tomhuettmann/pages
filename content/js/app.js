// =============================================================================
// Constants
// =============================================================================

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
const NUTRIENTS = ['k', 'f', 'c', 'p'];

// =============================================================================
// Storage helpers
// =============================================================================

function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
}

function safeSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch { /* storage full or unavailable — degrade silently */ }
}

function safeParse(key, fallback) {
    try {
        const raw = safeGet(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

// =============================================================================
// Validation helpers
// =============================================================================

function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isBarcode(id) {
    return /^\d+$/.test(id);
}

function validateProducts(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const clean = {};
    for (const [id, p] of Object.entries(raw)) {
        if (!p || typeof p.n !== 'string') continue;
        const cleaned = { n: p.n };
        const u = safeNum(p.u, 0);
        if (u > 0) cleaned.u = u;
        for (const k of NUTRIENTS) cleaned[k] = safeNum(p[k]);
        clean[id] = cleaned;
    }
    return clean;
}

// =============================================================================
// DOM helper
// =============================================================================

function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else node.setAttribute(k, v);
    }
    if (children) for (const child of [].concat(children)) {
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

// =============================================================================
// Shared state
// =============================================================================

let serverProducts = typeof PRODUCTS_DB !== 'undefined' ? validateProducts(PRODUCTS_DB) : {};
let customProducts = validateProducts(safeParse('customProducts', {}));

function saveCustomProducts() {
    safeSet('customProducts', JSON.stringify(customProducts));
}

// =============================================================================
// Product table renderers
// =============================================================================

function buildProductTable(entries, { deletable = false } = {}) {
    const wrapper = el('div', { className: 'table-scroll' });
    const table = el('table', { className: 'product-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    for (const label of ['Name', 'kcal', 'Fat', 'Carbs', 'Protein', 'Portion', 'Barcode']) {
        headerRow.appendChild(el('th', null, label));
    }
    if (deletable) headerRow.appendChild(el('th'));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const [id, p] of entries) {
        const row = el('tr');
        row.appendChild(el('td', null, p.n));
        for (const k of NUTRIENTS) row.appendChild(el('td', null, String(p[k])));
        row.appendChild(el('td', null, p.u ? String(p.u) : '—'));
        row.appendChild(el('td', null, isBarcode(id) ? '✓' : '—'));
        if (deletable) {
            const btn = el('button', null, '✕');
            btn.addEventListener('click', () => {
                if (confirm('Delete "' + p.n + '"?')) {
                    delete customProducts[id];
                    saveCustomProducts();
                    renderCustomList();
                }
            });
            row.appendChild(el('td', null, btn));
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
}

function renderCustomList() {
    const container = document.getElementById('custom-list');
    const deleteBtn = document.getElementById('delete-custom-btn');
    const exportSection = document.getElementById('export-section');
    container.textContent = '';
    const entries = Object.entries(customProducts);
    if (entries.length === 0) {
        container.appendChild(el('p', { className: 'muted' }, 'No custom products yet.'));
        deleteBtn.classList.add('hidden');
        exportSection.classList.add('hidden');
        return;
    }
    container.appendChild(buildProductTable(entries, { deletable: true }));
    deleteBtn.classList.remove('hidden');
    exportSection.classList.remove('hidden');
}

function renderAllProducts() {
    const entries = Object.entries(serverProducts).sort((a, b) => a[1].n.localeCompare(b[1].n));
    const btn = document.getElementById('show-global-btn');
    btn.textContent = `Show all ${entries.length} global products`;
    btn.addEventListener('click', () => {
        const container = document.getElementById('global-products-list');
        container.textContent = '';
        if (entries.length === 0) {
            container.appendChild(el('p', { className: 'muted' }, 'No products.'));
        } else {
            container.appendChild(buildProductTable(entries));
        }
        btn.classList.add('hidden');
    }, { once: true });
}

// =============================================================================
// Barcode scanner
// =============================================================================

let _controls = null;
const ZXING_SRC = 'js/zxing.min.js';

function loadZXing() {
    return new Promise((resolve, reject) => {
        if (typeof ZXing !== 'undefined') { resolve(); return; }
        const script = document.createElement('script');
        script.src = ZXING_SRC;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load scanner.'));
        document.head.appendChild(script);
    });
}

function ensureScannerOverlay() {
    if (document.getElementById('scanner-overlay')) return;
    const overlay = el('div', { id: 'scanner-overlay', className: 'hidden' });
    const wrap = el('div', { className: 'scanner-wrap' });
    const video = document.createElement('video');
    video.id = 'scanner-video';
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    const status = el('p', { id: 'scanner-status' }, '');
    const btn = el('button', { id: 'scanner-cancel', type: 'button' }, 'Cancel');
    btn.addEventListener('click', closeScanner);
    wrap.appendChild(video);
    overlay.appendChild(wrap);
    overlay.appendChild(status);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
}

async function openScanner(onResult) {
    ensureScannerOverlay();
    const overlay = document.getElementById('scanner-overlay');
    const status = document.getElementById('scanner-status');
    const video = document.getElementById('scanner-video');

    video.style.opacity = '0';
    overlay.classList.remove('hidden');
    status.textContent = 'Loading scanner…';

    try {
        await loadZXing();
    } catch (e) {
        status.textContent = e.message;
        return;
    }

    status.textContent = 'Starting camera…';

    try {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        const reader = new ZXing.BrowserMultiFormatReader(hints);
        _controls = reader;
        const constraints = {
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
            }
        };
        await reader.decodeFromConstraints(constraints, document.getElementById('scanner-video'), (result) => {
            if (!result) return;
            const code = typeof result.getText === 'function' ? result.getText() : result.text;
            if (code) {
                closeScanner();
                onResult(code);
            }
        });
        status.textContent = 'Point camera at barcode…';
        video.style.opacity = '1';
    } catch (e) {
        status.textContent = 'No camera access.';
    }
}

function closeScanner() {
    if (_controls) {
        try { _controls.reset(); } catch { /* ignore */ }
        _controls = null;
    }
    const overlay = document.getElementById('scanner-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// =============================================================================
// App state
// =============================================================================

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
    if (meal) {
        safeSet('lastMeal', meal);
        document.getElementById('meal-select').value = meal;
        document.getElementById('q-meal-select').value = meal;
    }
}

function round(n) {
    return Math.round(n * 10) / 10;
}

// =============================================================================
// Renderers
// =============================================================================

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
    const resetBtn = document.getElementById('reset-btn');
    container.textContent = '';
    const allEmpty = MEALS.every(m => log[m].length === 0);
    resetBtn.classList.toggle('hidden', allEmpty);
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
            const item = el('div', { className: 'log-item' });
            const deleteBtn = el('button', null, '✕');
            deleteBtn.addEventListener('click', () => removeEntry(meal, i));
            if (entry.amount) {
                const editBtn = el('button', null, '✎');
                editBtn.addEventListener('click', () => editEntry(meal, i, item));
                item.appendChild(el('span', null, label));
                item.appendChild(el('div', { className: 'log-item-actions' }, [editBtn, deleteBtn]));
            } else {
                item.appendChild(el('span', null, label));
                item.appendChild(deleteBtn);
            }
            container.appendChild(item);
        });
    }
}

function editEntry(meal, index, item) {
    const entry = log[meal][index];
    item.textContent = '';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.inputMode = 'numeric';
    input.value = entry.amount;
    input.className = 'log-edit-input';

    const confirmBtn = el('button', null, '✓');
    const cancelBtn = el('button', null, '✕');

    const confirm = () => {
        const newAmount = safeNum(parseFloat(input.value));
        if (newAmount > 0) {
            const factor = newAmount / entry.amount;
            entry.amount = newAmount;
            for (const k of NUTRIENTS) entry[k] = round(entry[k] * factor);
            save();
        }
        renderTotals();
        renderLog();
    };

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', () => renderLog());
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); confirm(); }
        if (e.key === 'Escape') renderLog();
    });

    item.appendChild(el('span', null, entry.n));
    item.appendChild(el('div', { className: 'log-item-actions' }, [input, confirmBtn, cancelBtn]));
    input.focus();
    input.select();
}

function removeEntry(meal, index) {
    log[meal].splice(index, 1);
    save();
    renderTotals();
    renderLog();
}

// =============================================================================
// Search
// =============================================================================

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const amountSection = document.getElementById('amount-section');
const amountInput = document.getElementById('amount-input');
const selectedLabel = document.getElementById('selected-label');

function selectProduct(product) {
    selectedProduct = product;
    selectedLabel.textContent = product.n;
    amountInput.value = product.u || '';
    amountSection.classList.remove('hidden');
    searchResults.classList.add('hidden');
    searchInput.value = '';
    amountInput.focus();
    amountInput.select();
}

document.getElementById('scan-search-btn').addEventListener('click', () => {
    openScanner(barcode => {
        const all = getAllProducts();
        if (all[barcode]) {
            selectProduct(all[barcode]);
        } else {
            searchResults.textContent = '';
            searchResults.appendChild(el('p', { className: 'muted' }, `No product found for barcode: ${barcode}`));
            searchResults.classList.remove('hidden');
            document.getElementById('c-b').value = barcode;
            document.getElementById('c-b').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
});

searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (query.length < 2) {
        searchResults.classList.add('hidden');
        return;
    }
    const all = getAllProducts();
    const matches = Object.entries(all)
        .filter(([_, p]) => p.n.toLowerCase().includes(query))
        .sort((a, b) => {
            const an = a[1].n.toLowerCase();
            const bn = b[1].n.toLowerCase();
            const aStarts = an.startsWith(query);
            const bStarts = bn.startsWith(query);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return an.localeCompare(bn);
        })
        .slice(0, 20);

    if (matches.length === 0) {
        searchResults.classList.add('hidden');
        return;
    }

    searchResults.textContent = '';
    for (const [id, p] of matches) {
        const div = el('div', null, p.u ? `${p.n} (${p.u}g)` : p.n);
        div.dataset.id = id;
        searchResults.appendChild(div);
    }
    searchResults.classList.remove('hidden');
});

searchResults.addEventListener('click', (e) => {
    const div = e.target.closest('[data-id]');
    if (!div) return;
    const all = getAllProducts();
    const product = all[div.dataset.id];
    if (!product) return;
    selectProduct(product);
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

// =============================================================================
// Reset
// =============================================================================

document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Reset all tracked food?')) {
        log = { breakfast: [], lunch: [], dinner: [], snacks: [] };
        save('breakfast');
        renderTotals();
        renderLog();
    }
});

// =============================================================================
// Quick entry
// =============================================================================

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

// =============================================================================
// Manage products
// =============================================================================

document.getElementById('custom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = document.getElementById('c-n').value.trim();
    if (!n) return;
    const product = { n: n };
    const u = safeNum(parseInt(document.getElementById('c-u').value), 0);
    if (u > 0) product.u = u;
    for (const k of NUTRIENTS) product[k] = safeNum(parseFloat(document.getElementById('c-' + k).value));
    const b = document.getElementById('c-b').value.trim();
    const id = b || crypto.randomUUID();
    customProducts[id] = product;
    saveCustomProducts();
    e.target.reset();
    renderCustomList();
});

document.getElementById('delete-custom-btn').addEventListener('click', () => {
    if (confirm('Delete all custom products?')) {
        customProducts = {};
        saveCustomProducts();
        renderCustomList();
    }
});


document.getElementById('export-btn').addEventListener('click', () => {
    const lines = Object.entries(customProducts)
        .map(([id, p]) => {
            const ordered = {};
            for (const k of ['n', 'k', 'f', 'c', 'p', 'u']) if (k in p) ordered[k] = p[k];
            const json = JSON.stringify(ordered).replace(/:/g, ': ').replace(/,/g, ', ').replace(/^\{/, '{ ').replace(/\}$/, ' }');
            return '  ' + JSON.stringify(id) + ': ' + json + ',';
        });
    document.getElementById('export-output').classList.remove('hidden');
        document.getElementById('export-output').textContent = lines.join('\n');
    document.getElementById('copy-export-btn').classList.remove('hidden');
});

document.getElementById('copy-export-btn').addEventListener('click', async () => {
    const text = document.getElementById('export-output').textContent;
    const btn = document.getElementById('copy-export-btn');
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied!';
    } catch {
        btn.textContent = 'Failed';
    }
    setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 2000);
});

// =============================================================================
// Initial render
// =============================================================================

document.getElementById('meal-select').value = lastMeal;
document.getElementById('q-meal-select').value = lastMeal;
renderTotals();
renderLog();
renderCustomList();
renderAllProducts();
