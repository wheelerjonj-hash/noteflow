// Seed roster of Anna Maria Island vacation-rental management companies.
//
// This list is a STARTING POINT, not a census. It was assembled from public
// web search and each company's own site. Two things are deliberately absent:
//
//   * inventory_url — the path to a company's rental index differs per site and
//     changes. `blr discover-inventory` finds and records it rather than
//     hardcoding a guess that silently 404s.
//   * portfolio size — populated from crawling, never estimated here.
//
// `aliases` matter more than they look: the same company appears on OTAs as a
// host name, on DBPR as a licensee, and on its own site as a brand, often with
// three different spellings. Attribution joins on these.

export const SEED_COMPANIES = [
  {
    name: 'Duncan Real Estate',
    aliases: ['Duncan Vacation Rentals', 'Team Duncan', 'Duncan RE'],
    website: 'https://www.teamduncan.com/',
  },
  {
    name: 'Sato Real Estate',
    aliases: ['Sato Vacation Rentals', 'Sato'],
    website: 'https://www.satorealestate.com/',
  },
  {
    name: 'Mike Norman Realty',
    aliases: ['Mike Norman', 'Norman Realty'],
    website: 'https://www.mikenormanrealty.com/',
  },
  {
    name: 'Anna Maria Island Beach Rentals',
    aliases: ['The Island in the Sun', 'AMI Beach Rentals'],
    website: 'https://annamariaislandbeachrentals.com/',
  },
  {
    name: 'Island Vacation Properties',
    aliases: ['IVP', 'Island Vacation Properties LLC'],
    website: 'https://www.islandvacationproperties.com/',
    office_address: '3001 Gulf Drive, Holmes Beach, FL 34217',
  },
  {
    name: 'Anna Maria Vacations',
    aliases: ['AnnaMaria.com', 'Anna Maria Vacation Rentals'],
    website: 'https://www.annamaria.com/',
  },
  {
    name: 'AMI Locals',
    aliases: ['Anna Maria Island Locals'],
    website: 'https://www.amilocals.com/',
  },
  {
    name: 'Salty Mermaid Real Estate',
    aliases: ['Salty Mermaid', 'Salty Mermaid Vacation Rentals'],
    website: 'https://www.saltymermaidrealestate.com/',
  },
  {
    name: 'A Paradise Rentals',
    aliases: ['A Paradise Realty', 'Paradise Rentals'],
    website: 'https://www.aparadiserentals.com/',
  },
  {
    name: 'Anchor Down Vacation Rentals',
    aliases: ['Anchor Down'],
    website: 'https://www.anchordownvacationrentals.com/',
  },
  {
    name: 'Anna Maria Rentals',
    aliases: ['AnnaMariaRentals.com'],
    website: 'https://annamariarentals.com/',
  },
  {
    name: 'Island Real Estate of Anna Maria',
    aliases: ['Island Real Estate', 'IRE'],
    website: 'https://annamariaisland.com/',
  },
  {
    name: 'Anna Maria Island Accommodations',
    aliases: ['AMI Accommodations', 'Anna Maria Island Accommodations, Inc.'],
    website: null, // resolve via chamber directory; see docs/DATA_SOURCES.md
  },
  {
    name: 'Island Anna Maria',
    aliases: ['IslandAnnaMaria.com'],
    website: 'https://islandannamaria.com/',
  },
];

// Sentinel for listings whose host is the owner, not a management company.
// Owner-managed properties are a different sales motion — they are not
// dissatisfied with a manager, they have never had one.
export const SELF_MANAGED = {
  name: '(Owner managed)',
  aliases: [],
  is_self_managed: true,
};

/** Build a lowercase alias → canonical-name index for host-name attribution. */
export function aliasIndex(companies = SEED_COMPANIES) {
  const idx = new Map();
  for (const c of companies) {
    idx.set(c.name.toLowerCase(), c.name);
    for (const a of c.aliases ?? []) idx.set(a.toLowerCase(), c.name);
  }
  return idx;
}

/**
 * Attribute a free-text host / licensee string to a seed company.
 * Exact alias hit first, then a containment check — OTA host names are often
 * "Booked by Duncan Real Estate" or "Sato Vacation Rentals Team".
 */
export function attributeCompany(hostName, companies = SEED_COMPANIES) {
  if (!hostName) return null;
  const needle = hostName.toLowerCase().trim();
  const idx = aliasIndex(companies);
  if (idx.has(needle)) return idx.get(needle);

  let best = null;
  for (const [alias, canonical] of idx) {
    if (alias.length < 5) continue; // "IVP" / "IRE" are too short to match loosely
    if (needle.includes(alias) && (!best || alias.length > best.alias.length)) {
      best = { alias, canonical };
    }
  }
  return best?.canonical ?? null;
}
