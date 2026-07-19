// =============================================================================
// Statistics page — reads foodLog-* days from localStorage and renders charts.
// Log entries are self-contained ({n,k,f,c,p} + optional amount), so no product
// lookup is needed here.
// =============================================================================

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

// Macro categories. Colours are a colourblind-safe categorical trio, validated
// against the dark chart surface (CVD ΔE ≥ 8, contrast ≥ 3:1).
const MACROS = [
    { key: 'f', label: 'Fett', kcalPerG: 9, color: '#c8811a' },
    { key: 'c', label: 'Kohlenhydrate', kcalPerG: 4, color: '#3f93d8' },
    { key: 'p', label: 'Eiweiß', kcalPerG: 4, color: '#c25c86' }
];

let range = 30; // 7 | 30 | Infinity

// =============================================================================
// Data
// =============================================================================

function dayTotals(data) {
    const t = { k: 0, f: 0, c: 0, p: 0 };
    for (const m of MEALS) {
        if (!Array.isArray(data[m])) continue;
        for (const e of data[m]) {
            if (!e) continue;
            if (e.amount) {
                const factor = e.amount / 100;
                for (const k of NUTRIENTS) t[k] += (e[k] || 0) * factor;
            } else {
                for (const k of NUTRIENTS) t[k] += e[k] || 0;
            }
        }
    }
    return t;
}

// True if a day holds at least one real tracked item (an entry with a name).
// This excludes empty days (e.g. today before anything is logged) as well as
// days that only contain stray/invalid entries, so they don't skew the averages.
function hasTrackedEntry(data) {
    for (const m of MEALS) {
        if (!Array.isArray(data[m])) continue;
        for (const e of data[m]) {
            if (e && typeof e.n === 'string') return true;
        }
    }
    return false;
}

// All tracked days that actually contain entries, oldest first.
function getTrackedDays() {
    const days = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('foodLog-')) continue;
        const date = key.slice(8);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const data = safeParse(key, null);
        if (!data || !hasTrackedEntry(data)) continue;
        days.push({ date, totals: dayTotals(data) });
    }
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return days;
}

function inRange(days) {
    return range === Infinity ? days : days.slice(-range);
}

function formatDMShort(dateStr) {
    const [, m, d] = dateStr.split('-');
    return `${d}.${m}.`;
}

// =============================================================================
// SVG helpers
// =============================================================================

function svgEl(markup) {
    const wrap = el('div', { className: 'chart' });
    wrap.innerHTML = markup;
    return wrap;
}

function niceMax(value, target = 0.9, ticks = 5) {
    return niceAxisMax(value / target, ticks);
}

function niceAxisMax(value, ticks) {
    const roughStep = value / ticks;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const residual = roughStep / magnitude;

    const nice =
        residual <= 1 ? 1 :
        residual <= 2 ? 2 :
        residual <= 2.5 ? 2.5 :
        residual <= 5 ? 5 : 10;

    const step = nice * magnitude;
    return Math.ceil(value / step) * step;
}

// =============================================================================
// Generic single-series bar chart with average line
// =============================================================================

function renderBarChart({ containerId, days, key, color, label, unit }) {
    const container = document.getElementById(containerId);
    container.textContent = '';
    if (days.length === 0) return;

    const W = 340, H = 200, padL = 34, padR = 10, padT = 12, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const baseY = padT + plotH;

    const values = days.map(d => Math.round(d.totals[key]));
    const max = Math.max(...values);
    const yMax = niceMax(max);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const y = v => padT + plotH * (1 - v / yMax);

    const slot = plotW / days.length;
    const barW = Math.min(slot * 0.62, 46);

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">`;

    // gridlines + y labels (0, mid, max)
    for (const gv of [0, yMax / 2, yMax]) {
        const gy = y(gv);
        s += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" style="stroke:var(--border)" stroke-width="1"/>`;
        s += `<text x="${padL - 5}" y="${gy + 3}" text-anchor="end" style="fill:var(--text-muted)" font-size="9">${Math.round(gv)}</text>`;
    }

    // bars
    days.forEach((d, i) => {
        const v = values[i];
        const bx = padL + slot * i + (slot - barW) / 2;
        const by = y(v);
        const bh = Math.max(0, baseY - by);
        s += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(3, barW / 2).toFixed(1)}" style="fill:${color}"><title>${d.date}: ${v} ${unit}</title></rect>`;
    });

    // x labels — all if few, otherwise a sparse subset (always first & last)
    const stepEvery = days.length <= 12 ? 1 : Math.ceil(days.length / 6);
    days.forEach((d, i) => {
        if (i % stepEvery !== 0 && i !== days.length - 1) return;
        const cx = padL + slot * i + slot / 2;
        s += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" style="fill:var(--text-muted)" font-size="8">${formatDMShort(d.date)}</text>`;
    });

    // average line
    const ay = y(avg);
    s += `<line x1="${padL}" y1="${ay.toFixed(1)}" x2="${W - padR}" y2="${ay.toFixed(1)}" style="stroke:var(--text-sub)" stroke-width="1" stroke-dasharray="4 3"/>`;
    s += `<text x="${W - padR}" y="${(ay - 4).toFixed(1)}" text-anchor="end" style="fill:var(--text-sub)" font-size="9">Ø ${Math.round(avg)} ${unit}</text>`;

    s += `</svg>`;
    container.appendChild(svgEl(s));
}

// =============================================================================
// Average macro split (100% stacked bar + legend)
// =============================================================================

function renderMacroChart(days) {
    const container = document.getElementById('macro-chart');
    container.textContent = '';
    if (days.length === 0) return;

    // average grams per day per macro
    const avgG = {};
    for (const macro of MACROS) {
        avgG[macro.key] = days.reduce((sum, d) => sum + d.totals[macro.key], 0) / days.length;
    }
    const kcalOf = m => avgG[m.key] * m.kcalPerG;
    const totalKcal = MACROS.reduce((sum, m) => sum + kcalOf(m), 0);

    const bar = el('div', { className: 'macro-bar' });
    for (const m of MACROS) {
        const pct = totalKcal > 0 ? (kcalOf(m) / totalKcal) * 100 : 0;
        const seg = el('div', { className: 'macro-seg' });
        seg.style.width = pct + '%';
        seg.style.background = m.color;
        seg.title = `${m.label}: ${Math.round(pct)}%`;
        bar.appendChild(seg);
    }

    const legend = el('div', { className: 'macro-legend' });
    for (const m of MACROS) {
        const pct = totalKcal > 0 ? Math.round((kcalOf(m) / totalKcal) * 100) : 0;
        const row = el('div', { className: 'macro-legend-item' });
        const dot = el('span', { className: 'macro-dot' });
        dot.style.background = m.color;
        row.appendChild(dot);
        row.appendChild(el('span', { className: 'macro-name' }, m.label));
        row.appendChild(el('span', { className: 'macro-val' }, `${pct}% · ${Math.round(avgG[m.key])} g`));
        legend.appendChild(row);
    }

    container.appendChild(bar);
    container.appendChild(legend);
}

// =============================================================================
// Summary tiles
// =============================================================================

function renderSummary(days) {
    const grid = document.getElementById('summary-grid');
    grid.textContent = '';
    const n = days.length;
    const avg = key => n ? Math.round(days.reduce((s, d) => s + d.totals[key], 0) / n) : 0;

    const dayWord = n === 1 ? '1 Tag' : `${n} Tage`;
    document.getElementById('summary-heading').textContent =
        range === Infinity ? `Überblick · alle ${dayWord}` : `Überblick der letzten ${dayWord}`;

    const tiles = [
        { label: 'Ø kcal', value: String(avg('k')) },
        { label: 'Ø Fett', value: avg('f') + ' g' },
        { label: 'Ø KH', value: avg('c') + ' g' },
        { label: 'Ø Eiweiß', value: avg('p') + ' g' }
    ];
    for (const t of tiles) {
        const tile = el('div', { className: 'stat' });
        tile.appendChild(el('span', { className: 'stat-value' }, t.value));
        tile.appendChild(el('span', { className: 'stat-label' }, t.label));
        grid.appendChild(tile);
    }
}

// =============================================================================
// Render orchestration
// =============================================================================

function render() {
    const all = getTrackedDays();
    const empty = document.getElementById('empty');
    const content = document.getElementById('content');
    const resetBtn = document.getElementById('reset-btn');

    if (all.length === 0) {
        empty.classList.remove('hidden');
        content.classList.add('hidden');
        resetBtn.classList.add('hidden');
        return;
    }

    empty.classList.add('hidden');
    content.classList.remove('hidden');
    resetBtn.classList.remove('hidden');

    const days = inRange(all);
    renderSummary(days);
    renderBarChart({ containerId: 'kcal-chart', days, key: 'k', color: 'var(--accent)', label: 'Kalorien pro Tag', unit: 'kcal' });
    for (const m of MACROS) {
        renderBarChart({ containerId: m.key === 'f' ? 'fat-chart' : m.key === 'c' ? 'carb-chart' : 'protein-chart', days, key: m.key, color: m.color, label: m.label + ' pro Tag', unit: 'g' });
    }
    renderMacroChart(days);
}

// =============================================================================
// Range toggle
// =============================================================================

document.querySelectorAll('#range-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
        const r = btn.dataset.range;
        range = r === 'all' ? Infinity : Number(r);
        document.querySelectorAll('#range-toggle button').forEach(b => b.classList.toggle('active', b === btn));
        render();
    });
});

// =============================================================================
// Reset all tracked days
// =============================================================================

document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!(await showConfirm('Alle erfassten Tage unwiderruflich löschen?'))) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('foodLog-')) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    render();
});

// =============================================================================
// Initial render
// =============================================================================

render();
