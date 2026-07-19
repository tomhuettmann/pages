// =============================================================================
// Shared utilities (loaded before app.js / products-page.js on every page)
// =============================================================================

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
// Confirm dialog (requires a #confirm-dialog element on the page)
// =============================================================================

function showConfirm(message) {
    return new Promise(resolve => {
        const dlg = document.getElementById('confirm-dialog');
        document.getElementById('confirm-message').textContent = message;
        const ok = document.getElementById('confirm-ok');
        const cancel = document.getElementById('confirm-cancel');
        const handle = (result) => {
            dlg.close();
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            dlg.removeEventListener('cancel', onEscape);
            resolve(result);
        };
        const onOk = () => handle(true);
        const onCancel = () => handle(false);
        const onEscape = () => handle(false);
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        dlg.addEventListener('cancel', onEscape);
        dlg.showModal();
    });
}
