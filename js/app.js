/**
 * Boot, routing and the token gate.
 *
 * With no token the app renders the setup screen and nothing else — no data
 * request is ever made. That is the whole access-control model: the published
 * site is an empty shell, and the token is the key.
 */

import { hasToken, clearToken } from './config.js';
import { GitHubError } from './github.js';
import { loadRegistries, state } from './store.js';
import { toast, setBusy } from './ui.js';

import renderSetup from './views/setup.js';
import renderToday from './views/today.js';
import renderPlan from './views/plan.js';
import renderProgress from './views/progress.js';
import renderLog from './views/log.js';
import renderClinical from './views/clinical.js';
import renderSettings from './views/settings.js';

const ROUTES = {
  today: { label: 'Today', render: renderToday },
  log: { label: 'Log', render: renderLog },
  plan: { label: 'Plan', render: renderPlan },
  progress: { label: 'Progress', render: renderProgress },
  clinical: { label: 'Report', render: renderClinical },
  settings: { label: 'Settings', render: renderSettings, hidden: true },
};

const view = () => document.getElementById('view');

function currentRoute() {
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'today');
  return ROUTES[name] ? name : 'today';
}

export function navigate(route) {
  location.hash = `#/${route}`;
}

function renderNav(active) {
  const nav = document.getElementById('nav');
  nav.innerHTML = Object.entries(ROUTES)
    .filter(([, r]) => !r.hidden)
    .map(([key, r]) => `<a href="#/${key}" class="${key === active ? 'active' : ''}">${r.label}</a>`)
    .join('');
  nav.hidden = false;
}

/** Any 401 anywhere drops back to the setup screen with an explanation. */
export function handleError(e) {
  console.error(e);
  if (e instanceof GitHubError && e.isAuth) {
    clearToken();
    sessionStorage.setItem('chad.authMessage', 'Your token expired or was revoked. Paste a new one to carry on.');
    render();
    return;
  }
  if (e instanceof GitHubError && e.isMissing) {
    toast('Not found in the data repo — check the repository settings.', 'error', 6000);
    return;
  }
  toast(e.message || 'Something went wrong.', 'error', 6000);
}

let booting = false;

export async function render() {
  const root = view();

  if (!hasToken()) {
    document.getElementById('nav').hidden = true;
    document.body.classList.remove('ready');
    renderSetup(root, { onDone: () => { state.loaded = false; render(); } });
    return;
  }

  if (!state.loaded) {
    if (booting) return;
    booting = true;
    root.innerHTML = '<div class="loading">Loading your data…</div>';
    setBusy(true);
    try {
      await loadRegistries();
    } catch (e) {
      booting = false;
      setBusy(false);
      handleError(e);
      return;
    }
    booting = false;
    setBusy(false);
  }

  document.body.classList.add('ready');
  const route = currentRoute();
  renderNav(route);
  document.body.dataset.route = route;
  root.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await ROUTES[route].render(root, { navigate, handleError });
  } catch (e) {
    handleError(e);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
