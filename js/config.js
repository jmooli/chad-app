/**
 * Where the data lives, and where the token is kept.
 *
 * The repo coordinates are not secret — the repository is private, so anyone
 * without access gets a 404 regardless. They are overridable from Settings so
 * this shell stays useful if the data repo is ever renamed or moved.
 */

export const DEFAULTS = {
  owner: 'jmooli',
  repo: 'chad-data',
  branch: 'main',
};

const LS = {
  token: 'chad.pat',
  owner: 'chad.owner',
  repo: 'chad.repo',
  branch: 'chad.branch',
};

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

export const getToken = () => read(LS.token, '');
export const setToken = (t) => localStorage.setItem(LS.token, t.trim());
export const clearToken = () => localStorage.removeItem(LS.token);
export const hasToken = () => !!getToken();

export const getRepo = () => ({
  owner: read(LS.owner, DEFAULTS.owner),
  repo: read(LS.repo, DEFAULTS.repo),
  branch: read(LS.branch, DEFAULTS.branch),
});

export const setRepo = ({ owner, repo, branch }) => {
  localStorage.setItem(LS.owner, owner.trim());
  localStorage.setItem(LS.repo, repo.trim());
  localStorage.setItem(LS.branch, (branch || 'main').trim());
};

export const TIMEZONE = 'Europe/Helsinki';
