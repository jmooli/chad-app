/**
 * The token gate. This is the only screen a visitor without a token ever sees,
 * and it makes no data requests of its own.
 */

import { setToken, clearToken, setRepo, getRepo, DEFAULTS } from '../config.js';
import { repoInfo, GitHubError } from '../github.js';
import { esc, toast, setBusy } from '../ui.js';

export default function renderSetup(root, { onDone }) {
  const { owner, repo, branch } = getRepo();
  const notice = sessionStorage.getItem('chad.authMessage');
  sessionStorage.removeItem('chad.authMessage');

  root.innerHTML = `
    <section class="setup">
      <h1>Chad</h1>
      <p class="lede">Personal training and health log. Everything lives in a private GitHub repository; this page holds nothing until you unlock it.</p>

      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}

      <form id="setup-form" autocomplete="off">
        <label for="pat">GitHub access token</label>
        <input type="password" id="pat" name="pat" placeholder="github_pat_…" required autocomplete="off" spellcheck="false">

        <details class="how">
          <summary>How to create one</summary>
          <ol>
            <li>GitHub → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b>.</li>
            <li><b>Generate new token</b>. Give it a name like “chad app”.</li>
            <li><b>Repository access</b> → <i>Only select repositories</i> → pick <b>${esc(repo)}</b> and nothing else.</li>
            <li><b>Repository permissions</b> → <b>Contents: Read and write</b>. Leave every other permission alone.</li>
            <li>Set an expiry (maximum one year) and note the date — the app will ask for a fresh token when it lapses.</li>
          </ol>
          <p>The token stays in this browser only. It is never sent anywhere except api.github.com.</p>
        </details>

        <details class="how">
          <summary>Data repository</summary>
          <div class="grid-2">
            <div><label for="owner">Owner</label><input id="owner" value="${esc(owner)}" spellcheck="false"></div>
            <div><label for="repo">Repository</label><input id="repo" value="${esc(repo)}" spellcheck="false"></div>
          </div>
          <label for="branch">Branch</label>
          <input id="branch" value="${esc(branch || DEFAULTS.branch)}" spellcheck="false">
        </details>

        <button class="btn btn-primary btn-block" type="submit">Unlock</button>
        <p class="err" id="setup-err" hidden></p>
      </form>
    </section>`;

  const form = root.querySelector('#setup-form');
  const errEl = root.querySelector('#setup-err');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;

    const token = form.pat.value.trim();
    if (!token) return;

    setRepo({
      owner: root.querySelector('#owner').value || DEFAULTS.owner,
      repo: root.querySelector('#repo').value || DEFAULTS.repo,
      branch: root.querySelector('#branch').value || DEFAULTS.branch,
    });
    setToken(token);

    setBusy(true);
    try {
      const info = await repoInfo();
      if (!info.private) {
        clearToken();
        throw new Error('That repository is public. Personal health data must live in a private repository — check the owner and name.');
      }
      toast('Unlocked.');
      onDone();
    } catch (err) {
      clearToken();
      errEl.hidden = false;
      if (err instanceof GitHubError && err.isAuth) {
        errEl.textContent = 'GitHub rejected that token. Check that it has not expired.';
      } else if (err instanceof GitHubError && err.isMissing) {
        errEl.textContent = 'Repository not found, or the token does not grant access to it.';
      } else {
        errEl.textContent = err.message;
      }
    } finally {
      setBusy(false);
    }
  });
}
