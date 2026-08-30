import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/sources/ota/csv.js';
import { toParcel } from '../src/sources/manatee-pao.js';
import { toLicense, portfolioByCompany } from '../src/sources/dbpr.js';
import { extractListings, nextPageUrl } from '../src/sources/pm-sites.js';
import { attributeCompany } from '../src/config/companies.js';
import { jurisdictionFor, isAbsentee } from '../src/config/ami.js';
import { parseRobots, isAllowed } from '../src/lib/http.js';

test('CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = parseCsv(
    'a,b,c\n1,"hello, world",3\n4,"say ""hi""",6\n7,"multi\nline",9\n',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].b, 'hello, world');
  assert.equal(rows[1].b, 'say "hi"');
  assert.equal(rows[2].b, 'multi\nline');
});

test('jurisdiction is derived from latitude across the island', () => {
  assert.equal(jurisdictionFor(27.5300, -82.7350), 'anna_maria');
  assert.equal(jurisdictionFor(27.5085, -82.7115), 'holmes_beach');
  assert.equal(jurisdictionFor(27.4700, -82.6950), 'bradenton_beach');
  assert.equal(jurisdictionFor(28.0000, -82.7000), null); // off island
});

test('absentee detection treats Bradenton owners as local', () => {
  assert.equal(isAbsentee({ city: 'Bradenton', state: 'FL', zip: '34209' }), false);
  assert.equal(isAbsentee({ city: 'Columbus', state: 'OH', zip: '43215' }), true);
  assert.equal(isAbsentee({ city: 'Miami', state: 'FL', zip: '33101' }), true);
});

test('CAMA row becomes a parcel, and homesteads are still recorded', () => {
  const p = toParcel({
    PARID: '7300100059', DOR_UC: '0100', SITUS_ADDR: '123 Gulf Dr',
    SITUS_CITY: 'Holmes Beach', SITUS_ZIP: '34217',
    LATITUDE: '27.5085', LONGITUDE: '-82.7115',
    BEDROOMS: '3', BATHROOMS: '2', TOT_LVG_AR: '1600', POOL: 'Y',
    OWNER_NAME: 'SMITH JOHN', OWN_STATE: 'OH', OWN_CITY: 'Columbus', OWN_ZIPCD: '43215',
    HOMESTEAD: 'N',
  });
  assert.equal(p.parcel_id, '7300100059');
  assert.equal(p.jurisdiction, 'holmes_beach');
  assert.equal(p.property_type, 'single_family');
  assert.equal(p.has_pool, true);
  assert.equal(p.owner_is_absentee, true);
});

test('non-rentable use codes and off-island parcels are dropped', () => {
  assert.equal(toParcel({ PARID: '1', DOR_UC: '1000', SITUS_ZIP: '34217' }), null); // commercial
  assert.equal(toParcel({ PARID: '2', DOR_UC: '0100', SITUS_ZIP: '33101' }), null); // off island
});

test('DBPR rows filter to island vacation rentals and attribute the licensee', () => {
  const l = toLicense({
    'License Number': 'VR12345',
    'Licensee Name': 'DUNCAN REAL ESTATE INC',
    'License Type': 'Vacation Rental - Dwelling',
    'Location Address': '200 Gulf Dr N', 'Location City': 'Bradenton Beach',
    'Location Zip': '34217', 'Number of Units': '1', Status: 'Active',
  });
  assert.equal(l.pm_company, 'Duncan Real Estate');
  assert.equal(l.license_type, 'dwelling');

  // A restaurant licence on the island is not a vacation rental.
  assert.equal(toLicense({
    'License Number': 'R1', 'License Type': 'Permanent Food Service',
    'Location Zip': '34217',
  }), null);
});

test('portfolios roll up by company and sort by unit count', () => {
  const portfolios = portfolioByCompany([
    { license_number: 'A', pm_company: 'Sato Real Estate', units: 1, address_line1: '1 A St', city: 'Anna Maria', zip: '34216' },
    { license_number: 'B', pm_company: 'Sato Real Estate', units: 1, address_line1: '2 A St', city: 'Anna Maria', zip: '34216' },
    { license_number: 'C', pm_company: null, licensee_name: 'MYSTERY LLC', units: 5, address_line1: '3 A St', city: 'Anna Maria', zip: '34216' },
  ]);
  assert.equal(portfolios[0].units, 5);
  assert.equal(portfolios[0].attributed, false);
  assert.equal(portfolios[1].company, 'Sato Real Estate');
  assert.equal(portfolios[1].licenses, 2);
});

test('company attribution matches aliases inside longer host names', () => {
  assert.equal(attributeCompany('Booked by Duncan Vacation Rentals'), 'Duncan Real Estate');
  assert.equal(attributeCompany('Sato Real Estate'), 'Sato Real Estate');
  assert.equal(attributeCompany('Jane (Superhost)'), null);
  assert.equal(attributeCompany(null), null);
});

test('PM site extraction pulls cards, beds and photos', () => {
  const html = `
    <div class="property-card">
      <a href="/rentals/dock-of-the-bay" title="Dock of the Bay"><img src="/img/dotb-1.jpg"></a>
      <h3>Dock of the Bay</h3>
      <p>3 Bedrooms | 2 Baths | Sleeps 6 | Private Pool</p>
    </div>
    <div class="property-card">
      <a href="/rentals/gulf-breeze"><img src="/img/logo.png"><img src="/img/gb-1.jpg"></a>
      <h3>Gulf Breeze</h3><p>2 bed, 1 bath</p>
    </div>`;
  const found = extractListings(html, 'https://example.com/rentals');
  assert.equal(found.length, 2);
  assert.equal(found[0].title, 'Dock of the Bay');
  assert.equal(found[0].bedrooms, 3);
  assert.equal(found[0].sleeps, 6);
  assert.equal(found[0].has_pool, true);
  assert.equal(found[0].url, 'https://example.com/rentals/dock-of-the-bay');
  // Logos are filtered out of the photo set.
  assert.deepEqual(found[1].photo_urls, ['https://example.com/img/gb-1.jpg']);
});

test('pagination follows rel=next and textual next links', () => {
  assert.equal(
    nextPageUrl('<a rel="next" href="/rentals?page=2">More</a>', 'https://example.com/rentals'),
    'https://example.com/rentals?page=2',
  );
  assert.equal(
    nextPageUrl('<a href="/rentals?p=3">Next</a>', 'https://example.com/rentals'),
    'https://example.com/rentals?p=3',
  );
  assert.equal(nextPageUrl('<a href="/about">About</a>', 'https://example.com/rentals'), null);
});

test('robots.txt is parsed and longest-match wins', () => {
  const { rules } = parseRobots(`
User-agent: *
Disallow: /private
Allow: /private/public-listings
Crawl-delay: 5
`);
  assert.equal(isAllowed('/rentals', rules), true);
  assert.equal(isAllowed('/private/data', rules), false);
  assert.equal(isAllowed('/private/public-listings/1', rules), true);
});

test('a UA-specific robots group overrides the wildcard group', () => {
  const txt = `
User-agent: *
Disallow: /

User-agent: BeachLifeResearch
Disallow: /admin
`;
  const { rules } = parseRobots(txt, 'BeachLifeResearch/0.1');
  assert.equal(isAllowed('/rentals', rules), true);
  assert.equal(isAllowed('/admin/users', rules), false);
});
