import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCrashWhere, buildNetworkWhere, classifyTrend, concentrationRatio, escapeSqlLiteral,
  normalizeNetworkFeature, parseLocation, rateRatio, toCsv,
} from '../src/utils.js';

const base = {
  startYear: 2021, endYear: 2025,
  severities: ['K', 'A', 'B', 'C', 'O'], location: '', assignment: 'All', mode: 'All modes',
  people: { impaired: false, unrestrained: false, speeding: false, distracted: false, youngDriver: false },
  roads: { speeds: [], classes: [], intersectionTypes: [], controls: [] },
};

test('escapes ArcGIS SQL string literals', () => assert.equal(escapeSqlLiteral("O'Brien"), "O''Brien"));

test('parses the unified location selector', () => {
  assert.deepEqual(parseLocation('county|Douglas'), { type: 'county', name: 'Douglas' });
  assert.deepEqual(parseLocation('city|Omaha'), { type: 'city', name: 'Omaha' });
});

test('trend compares 2021–2025 with 2018–2022 and excludes 2026', () => {
  const values = [2018, 2019, 2020, 2021, 2022].map((year) => ({ year, count: 2 }));
  values.push(...[2023, 2024, 2025].map((year) => ({ year, count: 5 })), { year: 2026, count: 999 });
  assert.equal(classifyTrend(values), 'Increasing');
  assert.equal(classifyTrend([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((year) => ({ year, count: 3 }))), 'About the same');
});

test('nonmotorist, pedestrian, and bicycle modes always require a counted nonmotorist', () => {
  assert.match(buildCrashWhere({ ...base, mode: 'Nonmotorist' }), /nonmotorist_counted <> 0/);
  assert.match(buildCrashWhere({ ...base, mode: 'Bicycle' }), /nonmotorist_counted <> 0 AND num_bike <> 0/);
  assert.match(buildCrashWhere({ ...base, mode: 'Pedestrian' }), /nonmotorist_counted <> 0/);
});

test('crash filters combine location, severity, safer people, and the selected segment', () => {
  const where = buildCrashWhere({ ...base, location: 'city|Omaha', severities: ['K', 'A'], people: { ...base.people, speeding: true, impaired: true } }, { type: 'segment', id: 'TFL123' });
  assert.match(where, /city_name = 'Omaha'/);
  assert.match(where, /severity IN \('K', 'A'\)/);
  assert.match(where, /drv_speeding > 0/);
  assert.match(where, /drv_under_inf > 0 OR alcohol_related = 'Yes'/);
  assert.match(where, /assigned_segment_id = 'TFL123'/);
});

test('uses source-appropriate SQL for distracted and young-driver filters', () => {
  const filtered = { ...base, people: { ...base.people, distracted: true, youngDriver: true } };
  assert.match(buildCrashWhere(filtered), /drv_distracted > 0/);
  assert.match(buildCrashWhere(filtered), /driver_under_25 = 'Yes'/);
  assert.match(buildNetworkWhere(filtered, 'segment'), /driver_under_25 > 0/);
});

test('uses the Safety Network speed and HPMS functional-class fields', () => {
  const filtered = { ...base, roads: { ...base.roads, speeds: ['25'], classes: [3] } };
  const where = buildNetworkWhere(filtered, 'segment');
  assert.match(where, /maxspeed/);
  assert.match(where, /HPMS_F_SYSTEM IN \(3\)/);
});

test('safety network is the HIN foundation and uses geometry-specific fields', () => {
  assert.equal(buildNetworkWhere({ ...base, location: 'county|Sarpy' }, 'segment'), "HIN = 1 AND county_text = 'Sarpy'");
  assert.equal(buildNetworkWhere({ ...base, location: 'city|Papillion' }, 'intersection'), "HIN = 1 AND CITY = 'Papillion'");
});

test('normalizes a safety-network intersection row', () => {
  const row = normalizeNetworkFeature({ attributes: { OBJECTID: 7, int_ID: 'INT7', INTERSECTI: 'Main & 1st', CITY: 'Omaha', COUNTY: 'Douglas County', total_crashes: 11, KA_crashes: 2 } }, 'intersection');
  assert.equal(row.type, 'intersection');
  assert.equal(row.name, 'Main & 1st');
  assert.equal(row.county, 'Douglas');
});

test('computes displayed-vs-other rate ratios', () => assert.equal(rateRatio(20, 10, 30, 30), 4));

test('computes a selected-network concentration against the full network average', () => {
  assert.equal(concentrationRatio(20, 10, 40, 100), 5);
  assert.equal(concentrationRatio(4, 10, 40, 100), null);
});

test('creates safe CSV output', () => {
  const csv = toCsv([{ city: 'Omaha', note: 'Rain, "heavy"' }], [{ field: 'city', label: 'City' }, { field: 'note', label: 'Note' }]);
  assert.equal(csv, 'City,Note\r\nOmaha,"Rain, ""heavy"""');
});
