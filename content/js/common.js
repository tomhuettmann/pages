const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
const NUTRIENTS = ['k', 'c', 'p', 'f'];

// --- Storage helpers ---

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

// --- Validation helpers ---

function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function validateProducts(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const clean = {};
    for (const [id, p] of Object.entries(raw)) {
        if (!p || typeof p.n !== 'string') continue;
        const cleaned = { n: p.n, u: safeNum(p.u, 100) };
        for (const k of NUTRIENTS) cleaned[k] = safeNum(p[k]);
        clean[id] = cleaned;
    }
    return clean;
}

// --- DOM helper ---

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

// --- Shared state ---

let serverProducts = typeof PRODUCTS_DB !== 'undefined' ? validateProducts(PRODUCTS_DB) : {};
let customProducts = validateProducts(safeParse('customProducts', {}));

function saveCustomProducts() {
    safeSet('customProducts', JSON.stringify(customProducts));
}

// --- Product table renderers ---

function buildProductTable(entries, { deletable = false } = {}) {
    const wrapper = el('div', { className: 'table-scroll' });
    const table = el('table', { className: 'product-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    for (const label of ['Name', 'kcal', 'Carbs', 'Protein', 'Fat', 'Portion']) {
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
        row.appendChild(el('td', null, String(p.u)));
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
    container.textContent = '';
    const entries = Object.entries(customProducts);
    if (entries.length === 0) {
        container.appendChild(el('p', { className: 'muted' }, 'No custom products yet.'));
        return;
    }
    container.appendChild(buildProductTable(entries, { deletable: true }));
}

function renderAllProducts() {
    const container = document.getElementById('all-products-list');
    container.textContent = '';
    const entries = Object.entries(serverProducts).sort((a, b) => a[1].n.localeCompare(b[1].n));
    if (entries.length === 0) {
        container.appendChild(el('p', { className: 'muted' }, 'No products.'));
        return;
    }
    container.appendChild(buildProductTable(entries));
}
