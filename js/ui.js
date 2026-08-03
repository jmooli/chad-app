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

/** Event delegation: on(root, 'click', '.btn', handler) */
export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  });
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
