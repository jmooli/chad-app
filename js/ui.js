/** Small shared UI helpers. No framework — these are all the app needs. */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(message, kind = 'ok', ms = 3200) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

let busyDepth = 0;
export function setBusy(on) {
  busyDepth = Math.max(0, busyDepth + (on ? 1 : -1));
  document.body.classList.toggle('busy', busyDepth > 0);
}

/** Promise-based confirm. Deliberately not window.confirm — it blocks the page. */
export function confirmAction(message, { danger = false, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(okLabel)}</button>
        </div>
      </div>`;
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') done(true);
      else if (act === 'cancel' || e.target === back) done(false);
    });
    document.body.appendChild(back);
    back.querySelector('[data-act="ok"]').focus();
  });
}

/**
 * Searchable exercise picker. Opens a sheet with a search box; resolves with
 * the chosen exercise id, or null if dismissed. Matches on name, equipment
 * and muscle groups, so "cable" or "hamstrings" work as queries too.
 */
export function pickExercise(exercises, { title = 'Add exercise' } = {}) {
  return new Promise((resolve) => {
    const all = [...exercises].sort((a, b) => a.name.localeCompare(b.name));
    const back = document.createElement('div');
    back.className = 'modal-back picker-back';
    back.innerHTML = `
      <div class="modal picker" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <input class="picker-search" type="search" placeholder="Search — name, equipment, muscle…" aria-label="Search exercises" autocomplete="off">
        <ul class="picker-list"></ul>
      </div>`;
    const input = back.querySelector('.picker-search');
    const ul = back.querySelector('.picker-list');

    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const hits = all.filter((e) =>
        !q
        || e.name.toLowerCase().includes(q)
        || (e.equipment ?? '').includes(q)
        || (e.muscles ?? []).some((m) => m.includes(q)));
      ul.innerHTML = hits.length
        ? hits.map((e) => `
          <li><button type="button" class="picker-item" data-id="${esc(e.id)}">
            <span class="picker-name">${esc(e.name)}</span>
            <span class="picker-tag">${esc(e.equipment ?? '')}</span>
          </button></li>`).join('')
        : '<li class="picker-empty">Nothing matches</li>';
    };
    paint();

    const done = (v) => { back.remove(); resolve(v); };
    input.addEventListener('input', paint);
    back.addEventListener('click', (e) => {
      const item = e.target.closest('.picker-item');
      if (item) done(item.dataset.id);
      else if (e.target === back) done(null);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
      // Enter picks the top hit — type "lat", hit enter, done.
      if (e.key === 'Enter' && e.target === input) {
        const first = ul.querySelector('.picker-item');
        if (first) done(first.dataset.id);
      }
    });
    document.body.appendChild(back);
    input.focus();
  });
}

/**
 * Event delegation: on(root, 'click', '.btn', handler)
 *
 * Idempotent per (root, event, selector): re-wiring after a repaint replaces
 * the previous listener instead of stacking a duplicate. Views repaint onto
 * long-lived containers, and stacked listeners made a tag-chip tap toggle
 * twice (visibly un-selectable) and delete actions fire against stale data.
 */
const delegated = new WeakMap();
export function on(root, event, selector, handler) {
  let byKey = delegated.get(root);
  if (!byKey) delegated.set(root, (byKey = new Map()));
  const key = `${event} ${selector}`;
  const prev = byKey.get(key);
  if (prev) root.removeEventListener(event, prev);
  const listener = (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  };
  byKey.set(key, listener);
  root.addEventListener(event, listener);
}

export const numOrUndef = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const intOrUndef = (v) => {
  const n = numOrUndef(v);
  return n === undefined ? undefined : Math.round(n);
};

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
