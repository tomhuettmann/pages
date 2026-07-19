// =============================================================================
// Meal labels (UI only — internal keys stay English)
// =============================================================================

const MEAL_LABELS = {
    breakfast: 'Frühstück',
    lunch:     'Mittagessen',
    dinner:    'Abendessen',
    snacks:    'Snacks'
};

// User-Agent for API requests — assembled at runtime to avoid plain email in source
const _ua = 'FoodTracker/1.0 (' +
    ['t','o','m','.','h','u','e','t','t','m','a','n','n'].join('') +
    '\u0040' +
    ['i','c','l','o','u','d','.','c','o','m'].join('') +
    ')';

// =============================================================================
// Constants
// =============================================================================

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

// =============================================================================
// Date helpers
// =============================================================================

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function formatDateDE(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    return weekdays[dt.getDay()] + ', ' + dt.getDate() + '. ' + months[dt.getMonth()] + ' ' + dt.getFullYear();
}

function changeDate(delta) {
    if (delta < 0) {
        const prev = findPrevDay(currentDate);
        if (!prev) return;
        currentDate = prev;
    } else {
        const next = findNextDay(currentDate);
        if (!next) return;
        currentDate = next;
    }
    log = loadLog();
    updateNav();
    renderTotals();
    renderLog();
}

function getTrackedDays() {
    const days = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('foodLog-')) {
            const date = key.slice(8);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            const data = safeParse(key, null);
            if (data && MEALS.some(m => Array.isArray(data[m]) && data[m].length > 0)) {
                days.push(date);
            }
        }
    }
    days.sort();
    return days;
}

function findPrevDay(date) {
    const days = getTrackedDays();
    for (let i = days.length - 1; i >= 0; i--) {
        if (days[i] < date) return days[i];
    }
    return null;
}

function findNextDay(date) {
    const today = todayStr();
    if (date >= today) return null;
    const days = getTrackedDays();
    for (const day of days) {
        if (day > date && day < today) return day;
    }
    return today;
}

function updateNav() {
    document.getElementById('date-label').textContent = formatDateDE(currentDate);
    document.getElementById('prev-day-btn').classList.toggle('hidden', !findPrevDay(currentDate));
    document.getElementById('next-day-btn').classList.toggle('hidden', !findNextDay(currentDate));
}

// =============================================================================
// Shared state
// =============================================================================

let serverProducts = typeof PRODUCTS_DB !== 'undefined' ? validateProducts(PRODUCTS_DB) : {};
let customProducts = validateProducts(safeParse('customProducts', {}));

let currentDate = todayStr();
let log = loadLog();
let selectedProduct = null;

const storedMeal = safeGet('lastMeal');
const hasEntries = MEALS.some(m => log[m] && log[m].length > 0);
const lastMeal = hasEntries && MEALS.includes(storedMeal) ? storedMeal : 'breakfast';

function saveCustomProducts() {
    safeSet('customProducts', JSON.stringify(customProducts));
}

// =============================================================================
// Open Food Facts API
// =============================================================================

async function fetchOffProduct(barcode) {
    const fields = 'product_name,product_name_de,serving_quantity,product_quantity,quantity,brands,nutriments';
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': _ua }
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (json.status !== 1 || !json.product) return null;
        const p = json.product;
        const nm = p.nutriments || {};

        // Product name with manufacturer
        let n = (p.product_name_de || p.product_name || '').trim() || null;
        if (n && p.brands) {
            const brand = String(p.brands).split(',')[0].trim();
            if (brand) n = n + ' - ' + brand;
        }

        const k = Math.round(nm['energy-kcal_100g'] ?? 0);
        const f = nm['fat_100g'] ?? 0;
        const c = nm['carbohydrates_100g'] ?? 0;
        const pr = nm['proteins_100g'] ?? 0;

        // Portion size: serving_quantity → product_quantity → quantity (parsed string)
        const u = parseOffQuantity(p.serving_quantity) ??
                  parseOffQuantity(p.product_quantity) ??
                  parseOffQuantity(p.quantity);

        return { n, k, f, c, p: pr, u };
    } catch {
        return null;
    }
}

function parseOffQuantity(value) {
    if (value == null) return null;
    const s = String(value).toLowerCase().trim();
    let num = parseFloat(s);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (s.includes('kg')) return num * 1000;
    if (s.includes('l') && !s.includes('ml')) return num * 1000;
    return num;
}

// =============================================================================
// Barcode scanner
// =============================================================================

let _controls = null;
const ZXING_SRC = 'js/zxing.min.js?v=57821d51';

function loadZXing() {
    return new Promise((resolve, reject) => {
        if (typeof ZXing !== 'undefined') { resolve(); return; }
        const script = document.createElement('script');
        script.src = ZXING_SRC;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Scanner konnte nicht geladen werden.'));
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
    status.textContent = 'Scanner wird geladen…';

    try {
        await loadZXing();
    } catch (e) {
        status.textContent = e.message;
        return;
    }

    status.textContent = 'Kamera wird gestartet…';

     try {
         const hints = new Map();
         hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
         hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
             ZXing.BarcodeFormat.EAN_13,
             ZXing.BarcodeFormat.EAN_8,
         ]);
         const reader = new ZXing.BrowserMultiFormatReader(hints);
        _controls = reader;
        const constraints = {
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
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
        status.textContent = 'Kamera auf Barcode richten…';
        video.style.opacity = '1';
    } catch (e) {
        status.textContent = 'Kein Kamerazugriff.';
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
            cleaned.k = safeNum(entry.k);
            for (const k of NUTRIENTS.slice(1)) cleaned[k] = safeNum(entry[k]);
            const amount = safeNum(entry.amount);
            if (amount > 0) cleaned.amount = amount;
            clean[m].push(cleaned);
        }
    }
    return clean;
}

function loadLog() {
    return validateLog(safeParse('foodLog-' + currentDate, null));
}

function save(meal) {
    safeSet('foodLog-' + currentDate, JSON.stringify(log));
    if (meal) {
        safeSet('lastMeal', meal);
        document.getElementById('meal-select').value = meal;
        document.getElementById('q-meal-select').value = meal;
    }
}

if (typeof PRODUCTS_DB === 'undefined') {
    const si = document.getElementById('search-input');
    si.parentNode.insertBefore(
        el('p', { className: 'muted' }, '⚠ Produktdatenbank konnte nicht geladen werden. Nur eigene Produkte verfügbar.'), si
    );
}

function getAllProducts() {
    return { ...serverProducts, ...customProducts };
}

// =============================================================================
// Renderers
// =============================================================================

function renderTotals() {
    const totals = {};
    for (const k of NUTRIENTS) totals[k] = 0;
    for (const meal of MEALS) {
        for (const entry of log[meal]) {
            if (entry.amount) {
                const factor = entry.amount / 100;
                for (const k of NUTRIENTS) {
                    totals[k] += (entry[k] || 0) * factor;
                }
            } else {
                for (const k of NUTRIENTS) {
                    totals[k] += entry[k] || 0;
                }
            }
        }
    }
    document.getElementById('total-k').textContent = Math.round(totals.k);
    for (const k of NUTRIENTS.slice(1)) {
        document.getElementById('total-' + k).textContent = Math.round(totals[k]);
    }
}

function renderLog() {
    const container = document.getElementById('log-list');
    container.textContent = '';
    const allEmpty = MEALS.every(m => log[m].length === 0);
    if (allEmpty) {
        container.appendChild(el('p', { className: 'muted' }, 'Noch keine Einträge.'));
        return;
    }
    for (const meal of MEALS) {
        if (log[meal].length === 0) continue;
        const mealTotals = { k: 0, f: 0, c: 0, p: 0 };
        log[meal].forEach(e => {
            if (e.amount) {
                const factor = e.amount / 100;
                for (const k of NUTRIENTS) mealTotals[k] += (e[k] || 0) * factor;
            } else {
                for (const k of NUTRIENTS) mealTotals[k] += (e[k] || 0);
            }
        });
        const headerText = `${MEAL_LABELS[meal]} (${Math.round(mealTotals.k)} – F: ${Math.round(mealTotals.f)}, K: ${Math.round(mealTotals.c)}, E: ${Math.round(mealTotals.p)})`;
        container.appendChild(el('h3', null, headerText));
        log[meal].forEach((entry, i) => {
            let label;
            if (entry.amount) {
                const productName = entry.n || 'Unbekannt';
                label = productName + ' – ' + entry.amount + 'g' + ` (${Math.round((entry.k || 0) * (entry.amount / 100))} kcal)`;
            } else {
                const productName = entry.n || 'Unbekannt';
                label = productName + ` (${Math.round(entry.k || 0)} kcal)`;
            }
            const item = el('div', { className: 'log-item' });
            const deleteBtn = el('button', null, '✕');
            deleteBtn.addEventListener('click', () => removeEntry(meal, i));
            item.appendChild(el('span', null, label));
            if (entry.amount) {
                const editBtn = el('button', null, '✎');
                editBtn.addEventListener('click', () => editEntry(meal, i, item));
                item.appendChild(el('div', { className: 'log-item-actions' }, [editBtn, deleteBtn]));
            } else {
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
            entry.amount = newAmount;
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

    const productName = entry.n || 'Unbekannt';
    item.appendChild(el('span', null, productName));
    item.appendChild(el('div', { className: 'log-item-actions' }, [input, confirmBtn, cancelBtn]));
    input.focus();
    input.select();
}

function removeEntry(meal, index) {
    log[meal].splice(index, 1);
    save();
    renderTotals();
    renderLog();
    updateNav();
}

// =============================================================================
// Search
// =============================================================================

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const amountSection = document.getElementById('amount-section');
const amountInput = document.getElementById('amount-input');
const selectedLabel = document.getElementById('selected-label');

function selectProduct(id, product) {
    selectedProduct = { id, product };
    selectedLabel.textContent = product.n;
    amountInput.value = product.u || '';
    amountSection.classList.remove('hidden');
    searchResults.classList.add('hidden');
    searchInput.value = '';
    amountInput.focus();
    amountInput.select();
}

document.getElementById('scan-search-btn').addEventListener('click', () => {
    openScanner(async barcode => {
        const all = getAllProducts();
        if (all[barcode]) {
            selectProduct(barcode, all[barcode]);
            return;
        }

        // Show loading feedback
        searchResults.textContent = '';
        searchResults.appendChild(el('p', { className: 'muted' }, 'Suche in Open Food Facts…'));
        searchResults.classList.remove('hidden');

        const off = await fetchOffProduct(barcode);

        // Clear all custom product form fields before pre-filling
        for (const id of ['c-n', 'c-k', 'c-f', 'c-c', 'c-p', 'c-u', 'c-b']) {
            document.getElementById(id).value = '';
        }

        // Ensure form is open before filling and scrolling
        openCustomForm();

        // Pre-fill barcode always
        document.getElementById('c-b').value = barcode;

        if (off) {
            searchResults.textContent = '';
            searchResults.appendChild(el('p', { className: 'muted' }, `Produkt gefunden – bitte prüfen und speichern.`));
            if (off.n)  document.getElementById('c-n').value = off.n;
            document.getElementById('c-k').value = off.k;
            document.getElementById('c-f').value = off.f;
            document.getElementById('c-c').value = off.c;
            document.getElementById('c-p').value = off.p;
            if (off.u != null) document.getElementById('c-u').value = off.u;
        } else {
            searchResults.textContent = '';
            searchResults.appendChild(el('p', { className: 'muted' }, `Kein Produkt gefunden für Barcode: ${barcode}`));
        }

        document.getElementById('c-n').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    selectProduct(div.dataset.id, product);
});

document.getElementById('add-btn').addEventListener('click', () => {
    if (!selectedProduct) return;
    const amount = safeNum(parseFloat(amountInput.value));
    if (amount <= 0) return;
    const meal = document.getElementById('meal-select').value;

    const product = selectedProduct.product;
    log[meal].push({ n: product.n, k: product.k, f: product.f, c: product.c, p: product.p, amount });

    save(meal);
    renderTotals();
    renderLog();
    updateNav();
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
    updateNav();
    e.target.reset();
    document.getElementById('q-meal-select').value = meal;
});

// =============================================================================
// Manage products
// =============================================================================

function openCustomForm() {
    document.getElementById('custom-form-wrap').setAttribute('open', '');
}

function closeCustomForm() {
    document.getElementById('custom-form-wrap').removeAttribute('open');
}

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
    closeCustomForm();
    selectProduct(id, product);
    document.getElementById('amount-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// =============================================================================
// Day navigation
// =============================================================================

document.getElementById('prev-day-btn').addEventListener('click', () => changeDate(-1));
document.getElementById('next-day-btn').addEventListener('click', () => changeDate(1));

// =============================================================================
// Initial render
// =============================================================================

document.getElementById('meal-select').value = lastMeal;
document.getElementById('q-meal-select').value = lastMeal;
updateNav();
renderTotals();
renderLog();

// Eagerly warm up ZXing after page is idle so the first scan has no parse delay
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loadZXing());
} else {
    setTimeout(() => loadZXing(), 2000);
}
