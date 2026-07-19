// =============================================================================
// Page-specific helper
// =============================================================================

function isBarcode(id) {
    return /^\d+$/.test(id);
}

// =============================================================================
// State
// =============================================================================

let serverProducts = typeof PRODUCTS_DB !== 'undefined' ? validateProducts(PRODUCTS_DB) : {};
let customProducts = validateProducts(safeParse('customProducts', {}));

const PAGE_SIZE = 25;
let customListPage = 1;
let globalListPage = 1;

function saveCustomProducts() {
    safeSet('customProducts', JSON.stringify(customProducts));
}

// =============================================================================
// Product table builder
// =============================================================================

function buildProductTable(entries, { deletable = false } = {}) {
    const wrapper = el('div', { className: 'table-scroll' });
    const table = el('table', { className: 'product-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    for (const label of ['Name', 'kcal', 'F', 'K', 'E', 'Portion', 'Barcode']) {
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
            btn.addEventListener('click', async () => {
                if (await showConfirm('„' + p.n + '" löschen?')) {
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

// =============================================================================
// Renderers
// =============================================================================

function renderCustomList() {
    const container = document.getElementById('custom-list');
    const heading = document.getElementById('custom-heading');
    const deleteBtn = document.getElementById('delete-custom-btn');
    const exportBtn = document.getElementById('export-custom-btn');
    container.textContent = '';
    const entries = Object.entries(customProducts);

    heading.textContent = `Meine ${entries.length} Produkte`;

    if (entries.length === 0) {
        container.appendChild(el('p', { className: 'muted' }, 'Keine eigenen Produkte.'));
        deleteBtn.classList.add('hidden');
        exportBtn.classList.add('hidden');
        document.getElementById('export-area').classList.add('hidden');
        return;
    }

    const totalPages = Math.ceil(entries.length / PAGE_SIZE);
    customListPage = Math.min(customListPage, totalPages);
    const start = (customListPage - 1) * PAGE_SIZE;
    container.appendChild(buildProductTable(entries.slice(start, start + PAGE_SIZE), { deletable: true }));

    if (totalPages > 1) {
        const nav = el('div', { className: 'pagination-nav' });
        const prevBtn = el('button', { className: 'subtle' }, '← Zurück');
        prevBtn.disabled = customListPage <= 1;
        prevBtn.addEventListener('click', () => { customListPage--; renderCustomList(); });
        const pageLabel = el('span', { className: 'page-label' }, `Seite ${customListPage} / ${totalPages}`);
        const nextBtn = el('button', { className: 'subtle' }, 'Weiter →');
        nextBtn.disabled = customListPage >= totalPages;
        nextBtn.addEventListener('click', () => { customListPage++; renderCustomList(); });
        nav.appendChild(prevBtn);
        nav.appendChild(pageLabel);
        nav.appendChild(nextBtn);
        container.appendChild(nav);
    }

    deleteBtn.classList.remove('hidden');
    exportBtn.classList.remove('hidden');
}

function renderGlobalList() {
    const entries = Object.entries(serverProducts).sort((a, b) => a[1].n.localeCompare(b[1].n));
    const heading = document.getElementById('global-heading');
    const container = document.getElementById('global-list');
    container.textContent = '';

    heading.textContent = `Globale ${entries.length} Produkte`;

    if (entries.length === 0) {
        container.appendChild(el('p', { className: 'muted' }, 'Keine Produkte.'));
        return;
    }

    const totalPages = Math.ceil(entries.length / PAGE_SIZE);
    globalListPage = Math.min(globalListPage, totalPages);
    const start = (globalListPage - 1) * PAGE_SIZE;
    container.appendChild(buildProductTable(entries.slice(start, start + PAGE_SIZE)));

    if (totalPages > 1) {
        const nav = el('div', { className: 'pagination-nav' });
        const prevBtn = el('button', { className: 'subtle' }, '← Zurück');
        prevBtn.disabled = globalListPage <= 1;
        prevBtn.addEventListener('click', () => { globalListPage--; renderGlobalList(); });
        const pageLabel = el('span', { className: 'page-label' }, `Seite ${globalListPage} / ${totalPages}`);
        const nextBtn = el('button', { className: 'subtle' }, 'Weiter →');
        nextBtn.disabled = globalListPage >= totalPages;
        nextBtn.addEventListener('click', () => { globalListPage++; renderGlobalList(); });
        nav.appendChild(prevBtn);
        nav.appendChild(pageLabel);
        nav.appendChild(nextBtn);
        container.appendChild(nav);
    }
}

// =============================================================================
// Export custom products (show JSON in a field, copy to clipboard)
// =============================================================================

// Pretty-print the products the same way products.js is laid out:
// one product per line, keys in a fixed order, valid JSON.
function formatProducts(products) {
    const entries = Object.entries(products);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([id, p]) => {
        const parts = ['n', ...NUTRIENTS, 'u']
            .filter(k => k in p)
            .map(k => JSON.stringify(k) + ': ' + JSON.stringify(p[k]));
        return '  ' + JSON.stringify(id) + ': { ' + parts.join(', ') + ' }';
    });
    return '{\n' + lines.join(',\n') + '\n}';
}

document.getElementById('export-custom-btn').addEventListener('click', () => {
    const area = document.getElementById('export-area');
    const text = document.getElementById('export-text');
    // Output the local products, formatted for readability.
    text.value = formatProducts(safeParse('customProducts', {}));
    area.classList.remove('hidden');
});

document.getElementById('copy-export-btn').addEventListener('click', async () => {
    const text = document.getElementById('export-text');
    const btn = document.getElementById('copy-export-btn');
    let ok = false;
    try {
        await navigator.clipboard.writeText(text.value);
        ok = true;
    } catch {
        // Fallback for browsers without the async clipboard API
        text.focus();
        text.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    const original = 'In Zwischenablage kopieren';
    btn.textContent = ok ? 'Kopiert ✓' : 'Kopieren fehlgeschlagen';
    setTimeout(() => { btn.textContent = original; }, 2000);
});

// =============================================================================
// Delete all custom products
// =============================================================================

document.getElementById('delete-custom-btn').addEventListener('click', async () => {
    if (await showConfirm('Alle eigenen Produkte löschen?')) {
        customProducts = {};
        saveCustomProducts();
        renderCustomList();
    }
});

// =============================================================================
// Initial render
// =============================================================================

renderCustomList();
renderGlobalList();
