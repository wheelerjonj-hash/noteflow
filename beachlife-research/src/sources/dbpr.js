// Florida DBPR — Division of Hotels & Restaurants vacation-rental licences.
//
// Every legal short-term rental in Florida holds a transient public lodging
// licence, and DBPR publishes the licensee file with the LOCATION ADDRESS of
// each licensed vacation-rental dwelling or condo. That makes this the single
// most valuable source in the project and the one that makes photo-based
// address guessing largely unnecessary: for a licensed property you can start
// from the address instead of trying to deduce it.
//
// It is also the cleanest PM-company attribution available. Management
// companies typically hold the licence for the units they manage, so the
// licensee name maps a company directly onto a list of addresses.
//
// Download the lodging licensee file from DBPR's public records page into a
// local path (see docs/DATA_SOURCES.md) — it refreshes daily.

import { readFile } from 'node:fs/promises';
import { parseCsv } from './ota/csv.js';
import { ISLAND_ZIPS, ISLAND_CITY_NAMES } from '../config/ami.js';
import { attributeCompany } from '../config/companies.js';
import { log } from '../lib/log.js';

export const SOURCE = 'dbpr';

const COLS = {
  license_number: ['License Number', 'LICENSE_NBR', 'license_number'],
  licensee_name: ['Licensee Name', 'OWNER_NAME', 'licensee_name', 'Business Name'],
  dba_name: ['DBA Name', 'DBA', 'dba_name'],
  license_type: ['License Type', 'LICENSE_TYPE', 'license_type'],
  units: ['Number of Units', 'UNITS', 'units'],
  status: ['Status', 'LICENSE_STATUS', 'status'],
  address_line1: ['Location Address', 'LOCATION_ADDRESS', 'Address 1', 'address1'],
  city: ['Location City', 'LOCATION_CITY', 'City', 'city'],
  zip: ['Location Zip', 'LOCATION_ZIP', 'Zip', 'zip'],
};

function pick(row, field) {
  for (const alias of COLS[field] ?? []) {
    if (row[alias] !== undefined && row[alias] !== '') return row[alias];
  }
  return null;
}

/** Vacation-rental licence types only — skip hotels, motels, and restaurants. */
function isVacationRental(type) {
  return /vacation\s*rental|dwelling|condo/i.test(String(type ?? ''));
}

function onIsland(city, zip) {
  const z = String(zip ?? '').slice(0, 5);
  if (ISLAND_ZIPS.includes(z)) return true;
  const c = String(city ?? '').toLowerCase().trim();
  return ISLAND_CITY_NAMES.some((n) => c.includes(n));
}

export function toLicense(row) {
  const number = pick(row, 'license_number');
  if (!number) return null;

  const type = pick(row, 'license_type');
  if (!isVacationRental(type)) return null;

  const city = pick(row, 'city');
  const zip = pick(row, 'zip');
  if (!onIsland(city, zip)) return null;

  const licensee = pick(row, 'licensee_name');
  return {
    license_number: String(number).trim(),
    licensee_name: licensee,
    dba_name: pick(row, 'dba_name'),
    license_type: /condo/i.test(String(type)) ? 'condo' : 'dwelling',
    units: Number(pick(row, 'units')) || null,
    status: pick(row, 'status'),
    address_line1: pick(row, 'address_line1'),
    city,
    zip: String(zip ?? '').slice(0, 5) || null,
    // Attribution is attempted on both the licensee and the DBA — companies
    // frequently license under an LLC and trade under a brand name.
    pm_company: attributeCompany(licensee) ?? attributeCompany(pick(row, 'dba_name')),
  };
}

export async function loadLicenses({ path = process.env.DBPR_LICENSE_FILE } = {}) {
  if (!path) throw new Error('DBPR_LICENSE_FILE is not set');
  const rows = parseCsv(await readFile(path, 'utf8'));
  const licenses = rows.map(toLicense).filter(Boolean);
  log.info('parsed DBPR licence file', { path, rows: rows.length, islandVacationRentals: licenses.length });
  return licenses;
}

/**
 * Roll licences up by management company. This alone answers a large part of
 * "which properties does each company manage" — from public record, with
 * addresses attached, before any OTA data is involved.
 */
export function portfolioByCompany(licenses) {
  const byCompany = new Map();
  for (const l of licenses) {
    const key = l.pm_company ?? `(unattributed) ${l.licensee_name ?? 'unknown'}`;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(l);
  }
  return [...byCompany.entries()]
    .map(([company, rows]) => ({
      company,
      attributed: rows[0].pm_company != null,
      licenses: rows.length,
      units: rows.reduce((a, r) => a + (r.units ?? 1), 0),
      addresses: rows.map((r) => ({
        license_number: r.license_number,
        address: [r.address_line1, r.city, r.zip].filter(Boolean).join(', '),
      })),
    }))
    .sort((a, b) => b.units - a.units);
}
