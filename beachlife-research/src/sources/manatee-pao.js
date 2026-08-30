// Manatee County Property Appraiser — parcel and ownership records.
//
// This reads the county's BULK CAMA download rather than scraping the parcel
// search UI. That is not just politeness: the bulk file is the same data the
// county certifies, it comes with a documented layout, and one download beats
// forty thousand HTTP requests. Download it from the appraiser's CAMA reports
// page into MANATEE_CAMA_DIR (see docs/DATA_SOURCES.md).
//
// Ownership records in Florida are public under Ch. 119, F.S. Note the two
// carve-outs this module respects: homesteaded parcels are excluded from
// prospecting (they are residences, not rentals), and s. 119.071(4)(d), F.S.
// exempts the home addresses of certain protected occupations from disclosure —
// if the county has suppressed a record, it will not be in the file, and this
// code must not try to reconstruct it from another source.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './ota/csv.js';
import { jurisdictionFor, isAbsentee, RENTABLE_USE_CODES, USE_CODE_TO_TYPE, ISLAND_ZIPS }
  from '../config/ami.js';
import { log } from '../lib/log.js';

export const SOURCE = 'manatee_pao';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const yn = (v) => (v == null || v === '' ? null : /^(y|yes|1|true)$/i.test(String(v).trim()));

/**
 * Column aliases. The CAMA export's header names have changed across roll
 * years, so each logical field lists the variants seen rather than pinning one.
 */
const COLS = {
  parcel_id: ['PARID', 'PARCEL_ID', 'PARCELID', 'PIN'],
  situs_address: ['SITUS_ADDR', 'SITUS_ADDRESS', 'PHYADDR1', 'SITE_ADDR'],
  situs_unit: ['SITUS_UNIT', 'PHYADDR2', 'UNIT'],
  situs_city: ['SITUS_CITY', 'PHYCITY', 'SITE_CITY'],
  situs_zip: ['SITUS_ZIP', 'PHYZIP', 'SITE_ZIP'],
  latitude: ['LATITUDE', 'LAT', 'Y'],
  longitude: ['LONGITUDE', 'LON', 'LONG', 'X'],
  use_code: ['DOR_UC', 'USE_CODE', 'DORCODE', 'PA_UC'],
  bedrooms: ['BEDROOMS', 'BEDS', 'RMBED'],
  bathrooms: ['BATHROOMS', 'BATHS', 'FIXBATH'],
  living_area_sqft: ['LIVING_AREA', 'TOT_LVG_AR', 'HEATED_SQFT', 'SFLA'],
  year_built: ['YEAR_BUILT', 'ACT_YR_BLT', 'YRBLT'],
  pool: ['POOL', 'HAS_POOL', 'XFOB_POOL'],
  owner_name: ['OWNER_NAME', 'OWN_NAME', 'OWNER1'],
  owner_name_2: ['OWNER_NAME2', 'OWN_NAME2', 'OWNER2'],
  owner_mail_line1: ['OWNER_ADDR', 'OWN_ADDR1', 'MAIL_ADDR1'],
  owner_mail_line2: ['OWNER_ADDR2', 'OWN_ADDR2', 'MAIL_ADDR2'],
  owner_mail_city: ['OWNER_CITY', 'OWN_CITY', 'MAIL_CITY'],
  owner_mail_state: ['OWNER_STATE', 'OWN_STATE', 'MAIL_STATE'],
  owner_mail_zip: ['OWNER_ZIP', 'OWN_ZIPCD', 'MAIL_ZIP'],
  homestead: ['HOMESTEAD', 'HX', 'HMSTD', 'EXMPT_01'],
  last_sale_date: ['SALE_DATE', 'LAST_SALE_DATE', 'SALEDT'],
  last_sale_price: ['SALE_PRC', 'SALE_PRICE', 'LAST_SALE_PRICE'],
  just_value: ['JUST_VALUE', 'JV', 'TOTAL_VAL'],
};

/** Read a logical field from a row using the first header alias present. */
export function pick(row, field) {
  for (const alias of COLS[field] ?? []) {
    if (row[alias] !== undefined && row[alias] !== '') return row[alias];
  }
  return null;
}

/** CAMA row → parcel record, or null if it is not an island rental candidate. */
export function toParcel(row) {
  const parcelId = pick(row, 'parcel_id');
  if (!parcelId) return null;

  const useCode = String(pick(row, 'use_code') ?? '').padStart(4, '0');
  if (!RENTABLE_USE_CODES.has(useCode)) return null;

  const zip = String(pick(row, 'situs_zip') ?? '').slice(0, 5);
  const lat = num(pick(row, 'latitude'));
  const lon = num(pick(row, 'longitude'));
  const jurisdiction = jurisdictionFor(lat, lon);

  // Keep the row only if it is on the island by coordinate or by ZIP.
  if (!jurisdiction && !ISLAND_ZIPS.includes(zip)) return null;

  const state = pick(row, 'owner_mail_state');
  const mailCity = pick(row, 'owner_mail_city');
  const mailZip = pick(row, 'owner_mail_zip');

  return {
    parcel_id: String(parcelId).trim(),
    situs_address: pick(row, 'situs_address'),
    situs_unit: pick(row, 'situs_unit'),
    situs_city: pick(row, 'situs_city'),
    situs_zip: zip || null,
    jurisdiction: jurisdiction ?? 'unincorporated',
    latitude: lat,
    longitude: lon,
    use_code: useCode,
    property_type: USE_CODE_TO_TYPE[useCode] ?? null,
    bedrooms: num(pick(row, 'bedrooms')),
    bathrooms: num(pick(row, 'bathrooms')),
    living_area_sqft: int(pick(row, 'living_area_sqft')),
    year_built: int(pick(row, 'year_built')),
    has_pool: yn(pick(row, 'pool')),
    owner_name: pick(row, 'owner_name'),
    owner_name_2: pick(row, 'owner_name_2'),
    owner_mail_line1: pick(row, 'owner_mail_line1'),
    owner_mail_line2: pick(row, 'owner_mail_line2'),
    owner_mail_city: mailCity,
    owner_mail_state: state,
    owner_mail_zip: mailZip,
    owner_is_absentee: isAbsentee({ city: mailCity, state, zip: mailZip }),
    homestead_exempt: yn(pick(row, 'homestead')),
    last_sale_date: pick(row, 'last_sale_date'),
    last_sale_price: num(pick(row, 'last_sale_price')),
    just_value: num(pick(row, 'just_value')),
  };
}

/** Load every CSV in the CAMA directory and yield island rental-candidate parcels. */
export async function* loadParcels({ dir = process.env.MANATEE_CAMA_DIR } = {}) {
  if (!dir) throw new Error('MANATEE_CAMA_DIR is not set');
  const files = (await readdir(dir)).filter((f) => /\.(csv|txt)$/i.test(f));
  if (!files.length) throw new Error(`No CSV files found in ${dir}`);

  for (const file of files) {
    const full = path.join(dir, file);
    const rows = parseCsv(await readFile(full, 'utf8'));
    let kept = 0;
    for (const row of rows) {
      const parcel = toParcel(row);
      if (parcel) { kept++; yield parcel; }
    }
    log.info('parsed CAMA file', { file, rows: rows.length, kept });
  }
}
