// Property-management company website crawler.
//
// The most direct answer to "which properties does each company manage" is the
// company's own marketing site: they publish their full inventory, with unit
// names, photos, bedroom counts, and often the address or at least a
// street-level neighbourhood. No terms-of-service problem, no anti-bot arms
// race, and the PM attribution is definitionally correct — it is their site.
//
// Two things this yields that OTA data alone cannot:
//   * A unit-name → address mapping, which becomes the strongest matching
//     signal for the same property listed anonymously on Airbnb.
//   * Photos of known provenance to hash against OTA listing photos.

import * as cheerio from 'cheerio';
import { fetchText, politeFetch } from '../lib/http.js';
import { log } from '../lib/log.js';

export const SOURCE = 'pm_site';

// Paths that commonly hold a rental index, tried in order when a company has
// no recorded inventory_url.
const INVENTORY_HINTS = [
  '/vacation-rentals', '/vacation-rentals/', '/rentals', '/rentals/',
  '/properties', '/search', '/all-rentals', '/our-rentals',
  '/anna-maria-island-vacation-rentals',
];

/** Find a company's rental index page. Returns a URL or null. */
export async function discoverInventoryUrl(website) {
  if (!website) return null;
  const base = new URL(website);

  // Prefer a link the homepage itself offers — sites rename these paths often.
  try {
    const html = await fetchText(base.toString());
    if (html) {
      const $ = cheerio.load(html);
      const candidates = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim().toLowerCase();
        if (!href) return;
        if (/rental|properties|search|browse|stays/.test(text) ||
            /rental|properties/.test(href)) {
          candidates.push(new URL(href, base).toString());
        }
      });
      const best = candidates.find((u) => /rental/i.test(u)) ?? candidates[0];
      if (best) {
        log.info('discovered inventory url from homepage', { website, url: best });
        return best;
      }
    }
  } catch (err) {
    log.warn('homepage discovery failed', { website, err: err.message });
  }

  for (const hint of INVENTORY_HINTS) {
    const url = new URL(hint, base).toString();
    try {
      const res = await politeFetch(url, { method: 'HEAD' });
      if (res && res.ok) {
        log.info('discovered inventory url by probe', { website, url });
        return url;
      }
    } catch { /* try the next hint */ }
  }

  log.warn('no inventory url discovered', { website });
  return null;
}

const num = (s) => { const m = String(s ?? '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };

/**
 * Extract listing cards from an inventory page.
 *
 * Deliberately heuristic and structure-agnostic: these are a dozen different
 * CMS templates, and a per-site selector table would rot within a season.
 * Anything ambiguous is left null for the matcher to reason about rather than
 * guessed at.
 */
export function extractListings(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const out = [];
  const seen = new Set();

  const CARD_SELECTORS = [
    '[class*="property-card"]', '[class*="listing-card"]', '[class*="rental-card"]',
    '[class*="unit-card"]', 'article[class*="property"]', '[class*="property-item"]',
    '[itemtype*="LodgingBusiness"]', '[itemtype*="Accommodation"]',
  ];

  const cards = $(CARD_SELECTORS.join(', '));
  cards.each((_, el) => {
    const $c = $(el);
    const href = $c.find('a[href]').first().attr('href');
    if (!href) return;

    let url;
    try { url = new URL(href, base).toString(); } catch { return; }
    if (seen.has(url)) return;
    seen.add(url);

    const title =
      $c.find('h1,h2,h3,h4,[class*="title"],[class*="name"]').first().text().trim() ||
      $c.find('a[href]').first().attr('title') ||
      null;

    const text = $c.text().replace(/\s+/g, ' ');
    const bedMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bed|br\b|bedroom)/i);
    const bathMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bath|ba\b|bathroom)/i);
    const sleepMatch = text.match(/sleeps?\s*(\d+)/i);

    const photos = [];
    $c.find('img').each((__, img) => {
      const src = $(img).attr('src') ?? $(img).attr('data-src') ?? $(img).attr('data-lazy-src');
      if (src && !/placeholder|spacer|logo/i.test(src)) {
        try { photos.push(new URL(src, base).toString()); } catch { /* skip */ }
      }
    });

    out.push({
      platform: 'pm_site',
      platform_listing_id: url,
      url,
      title,
      bedrooms: bedMatch ? Number(bedMatch[1]) : null,
      bathrooms: bathMatch ? Number(bathMatch[1]) : null,
      sleeps: sleepMatch ? Number(sleepMatch[1]) : null,
      has_pool: /\bprivate pool|heated pool|\bpool\b/i.test(text) ? true : null,
      photo_urls: photos,
    });
  });

  log.debug('extracted listings from page', { pageUrl, found: out.length });
  return out;
}

/** Find the next page of an index, if the site paginates. */
export function nextPageUrl(html, pageUrl) {
  const $ = cheerio.load(html);
  const rel = $('a[rel="next"]').attr('href');
  if (rel) return new URL(rel, pageUrl).toString();

  let found = null;
  $('a[href]').each((_, el) => {
    if (found) return;
    const text = $(el).text().trim().toLowerCase();
    if (/^(next|next page|›|»)$/.test(text)) {
      found = new URL($(el).attr('href'), pageUrl).toString();
    }
  });
  return found;
}

/** Crawl a company's whole inventory, following pagination. */
export async function crawlCompany(company, { maxPages = 25 } = {}) {
  const start = company.inventory_url ?? (await discoverInventoryUrl(company.website));
  if (!start) return { company: company.name, inventory_url: null, listings: [] };

  const listings = [];
  const visited = new Set();
  let url = start;

  for (let page = 0; page < maxPages && url && !visited.has(url); page++) {
    visited.add(url);
    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      log.warn('inventory page fetch failed', { company: company.name, url, err: err.message });
      break;
    }
    if (!html) break; // robots.txt disallowed

    const found = extractListings(html, url);
    listings.push(...found);
    if (!found.length) break; // template not recognised; stop rather than spin

    url = nextPageUrl(html, url);
  }

  log.info('crawled company inventory', {
    company: company.name, inventory_url: start, listings: listings.length,
  });
  return { company: company.name, inventory_url: start, listings };
}
