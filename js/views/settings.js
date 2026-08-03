/** Settings — token, repository and cache. Reachable from the header. */

import { getRepo, clearToken } from '../config.js';
import { repoInfo } from '../github.js';
import { invalidate, state } from '../store.js';
import { esc, toast, confirmAction, setBusy } from '../ui.js';

export default async function renderSettings(root, ctx) {
  const { owner, repo, branch } = getRepo();
  let info = null;
  try {
    info = await repoInfo();
  } catch {
    /* shown as unknown below */
  }

  root.innerHTML = `
    <section class="settings">
      <h1>Settings</h1>

      <h2 class="section-head">Data repository</h2>
      <dl class="kv">
        <dt>Repository</dt><dd><a href="https://github.com/${esc(owner)}/${esc(repo)}" target="_blank" rel="noopener">${esc(owner)}/${esc(repo)}</a></dd>
        <dt>Branch</dt><dd>${esc(branch)}</dd>
        <dt>Visibility</dt><dd>${info ? (info.private ? '<span class="badge">private</span>' : '<span class="badge badge-danger">PUBLIC — move this data to a private repo</span>') : 'unknown'}</dd>
        <dt>Exercises</dt><dd>${state.exercises.size}</dd>
        <dt>Metric types</dt><dd>${state.types.size}</dd>
      </dl>

      <h2 class="section-head">This device</h2>
      <p class="muted">The access token is stored in this browser only. Fine-grained tokens expire after at most a year; when yours does, the app will ask for a new one.</p>
      <div class="actions">
        <button class="btn" id="s-refresh">Reload data</button>
        <button class="btn btn-danger" id="s-signout">Remove token from this device</button>
      </div>

      <h2 class="section-head">About</h2>
      <p class="muted">
        Data lives as plain JSON in a private GitHub repository — one commit per change, readable with nothing but a text editor.
        The schema is documented in <a href="https://github.com/${esc(owner)}/${esc(repo)}/blob/${esc(branch)}/README.md" target="_blank" rel="noopener">the data repo README</a>.
      </p>
    </section>`;

  root.querySelector('#s-refresh').addEventListener('click', async () => {
    setBusy(true);
    invalidate();
    state.loaded = false;
    toast('Reloading…');
    setBusy(false);
    ctx.navigate('today');
  });

  root.querySelector('#s-signout').addEventListener('click', async () => {
    if (!(await confirmAction('Remove the token from this browser? Your data is untouched.', { danger: true, okLabel: 'Remove' }))) return;
    clearToken();
    location.hash = '#/today';
    location.reload();
  });
}
