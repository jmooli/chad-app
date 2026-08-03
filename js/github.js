/**
 * GitHub Contents API client.
 *
 * Every read and write in this app goes through here. There is no backend:
 * the private data repo IS the database, and each write is a git commit.
 */

import { getToken, getRepo } from './config.js';
import { formatDataFile } from './format.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
  get isAuth() {
    return this.status === 401;
  }
  get isMissing() {
    return this.status === 404;
  }
}

/* --- UTF-8 safe base64 -------------------------------------------------- *
 * btoa() throws on any character above U+00FF, so a note containing "ääkköset"
 * would either throw or silently corrupt. Everything goes through TextEncoder.
 */

export function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* --- requests ----------------------------------------------------------- */

async function request(path, options = {}) {
  const token = getToken();
  if (!token) throw new GitHubError('No token', 401);

  const res = await fetch(API + path, {
    ...options,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const detail = body?.message || res.statusText;
    if (res.status === 403 && /rate limit/i.test(detail)) {
      throw new GitHubError('GitHub rate limit reached — wait a few minutes.', 403, body);
    }
    throw new GitHubError(detail, res.status, body);
  }
  return body;
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

/** Returns {json, raw, sha} — or null if the file does not exist yet. */
export async function getFile(path) {
  const { owner, repo, branch } = getRepo();
  let body;
  try {
    body = await request(`/repos/${owner}/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
  } catch (e) {
    if (e.isMissing) return null;
    throw e;
  }
  if (Array.isArray(body)) throw new GitHubError(`${path} is a directory, not a file`, 400);
  const raw = decodeBase64(body.content || '');
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new GitHubError(`${path} is not valid JSON — fix it in GitHub before continuing.`, 422);
  }
  return { json, raw, sha: body.sha, path };
}

/** Directory listing. Returns [] if the directory does not exist. */
export async function listDir(path) {
  const { owner, repo, branch } = getRepo();
  try {
    const body = await request(`/repos/${owner}/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
    return Array.isArray(body) ? body : [];
  } catch (e) {
    if (e.isMissing) return [];
    throw e;
  }
}

export async function putFile(path, text, message, sha) {
  const { owner, repo, branch } = getRepo();
  return request(`/repos/${owner}/${repo}/contents/${enc(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encodeBase64(text),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

/**
 * Read-modify-write with SHA checking.
 *
 * Claude commits to this repo too, so a stale SHA is a normal event, not an
 * error. On conflict we re-read and re-apply the mutation against the fresh
 * content — which is why `mutate` must be a pure function of the current file
 * rather than a precomputed result. Append-only record semantics make that
 * merge safe.
 */
export async function updateJson(path, mutate, message, { attempts = 4, fallback = null } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    const current = await getFile(path);
    if (!current && !fallback) throw new GitHubError(`${path} does not exist`, 404);

    const base = current ? current.json : structuredClone(fallback);
    const next = mutate(structuredClone(base));
    if (next === null || next === undefined) return { skipped: true };

    const text = formatDataFile(next);
    if (current && current.raw === text) return { unchanged: true };

    const msg = typeof message === 'function' ? message(next) : message;
    try {
      const res = await putFile(path, text, msg, current?.sha);
      return { commit: res.commit, content: next };
    } catch (e) {
      // 409/422 here means someone else committed between our read and write.
      const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.message || ''));
      if (!conflict || i === attempts - 1) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastError;
}

export async function repoInfo() {
  const { owner, repo } = getRepo();
  return request(`/repos/${owner}/${repo}`);
}
