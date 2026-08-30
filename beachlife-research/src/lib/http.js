// Polite HTTP client for the public-records and PM-site sources.
//
// Three things this does that a bare fetch() does not, and that keep the
// crawler on the right side of both etiquette and the law:
//
//   1. Honours robots.txt per origin, cached for the process lifetime.
//   2. Serialises requests per origin behind a configurable delay, so a crawl
//      never looks like a burst.
//   3. Identifies itself with a real contact address in the User-Agent, so a
//      site operator who objects can reach you instead of just blocking you.

import { log } from './log.js';

const DEFAULT_DELAY_MS = Number(process.env.CRAWL_DELAY_MS ?? 2000);
const USER_AGENT =
  process.env.CRAWL_USER_AGENT ?? 'BeachLifeResearch/0.1 (+contact: set CRAWL_USER_AGENT)';

const robotsCache = new Map(); // origin -> {rules, crawlDelayMs}
const lastRequestAt = new Map(); // origin -> epoch ms
const originQueue = new Map(); // origin -> Promise chain

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Minimal robots.txt parser: Disallow/Allow paths and Crawl-delay for our UA. */
export function parseRobots(text, agent = '*') {
  const lines = text.split('\n').map((l) => l.replace(/#.*$/, '').trim());
  const groups = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], rules: [], crawlDelay: null, hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.hasRules = true;
      if (field === 'disallow') current.rules.push({ allow: false, path: value });
      else if (field === 'allow') current.rules.push({ allow: true, path: value });
      else if (field === 'crawl-delay') current.crawlDelay = Number(value) * 1000;
    }
  }

  const lower = agent.toLowerCase();
  const exact = groups.find((g) => g.agents.some((a) => lower.startsWith(a) && a !== '*'));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const chosen = exact ?? wildcard;
  return {
    rules: chosen?.rules ?? [],
    crawlDelayMs: chosen?.crawlDelay ?? null,
  };
}

/** Longest-match wins, as in the robots.txt spec. Empty Disallow means allow. */
export function isAllowed(pathname, rules) {
  let best = null;
  for (const rule of rules) {
    if (rule.path === '') continue;
    if (!pathname.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  return best ? best.allow : true;
}

async function loadRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let parsed = { rules: [], crawlDelayMs: null };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    // 4xx means no robots.txt, which means no restrictions.
    if (res.ok) parsed = parseRobots(await res.text(), USER_AGENT);
  } catch (err) {
    log.warn('robots.txt fetch failed; assuming permissive', { origin, err: err.message });
  }
  robotsCache.set(origin, parsed);
  return parsed;
}

/**
 * Fetch a URL politely. Returns null when robots.txt disallows the path —
 * a skip, not an error, so callers can carry on with the rest of a crawl.
 */
export async function politeFetch(url, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  const origin = u.origin;
  const robots = await loadRobots(origin);

  if (!isAllowed(u.pathname, robots.rules)) {
    log.warn('robots.txt disallows path; skipping', { url });
    return null;
  }

  const delay = Math.max(robots.crawlDelayMs ?? 0, DEFAULT_DELAY_MS);

  // Serialise per origin so concurrent callers still respect the delay.
  const prior = originQueue.get(origin) ?? Promise.resolve();
  const task = prior.then(async () => {
    const since = Date.now() - (lastRequestAt.get(origin) ?? 0);
    if (since < delay) await sleep(delay - since);
    lastRequestAt.set(origin, Date.now());

    const res = await fetch(url, {
      method,
      body,
      headers: { 'user-agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(30000),
    });
    log.debug('fetched', { url, status: res.status });
    return res;
  });

  originQueue.set(origin, task.then(() => {}, () => {}));
  return task;
}

/** politeFetch + text, with one retry on 5xx/429. */
export async function fetchText(url, opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await politeFetch(url, opts);
    if (res === null) return null;
    if (res.ok) return res.text();
    if (res.status >= 500 || res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
      log.warn('retrying after transient status', { url, status: res.status, wait });
      await sleep(wait);
      continue;
    }
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  throw new Error(`GET ${url} failed after retries`);
}
