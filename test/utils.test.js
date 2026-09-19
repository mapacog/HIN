import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisModeForLayers, buildCrashWhere, buildNetworkWhere, classifyTrend, combineReportedValues, concentrationRatio, escapeSqlLiteral,
  normalizeNetworkFeature, parseLocation, rateRatio, toCsv,
} from '../src/utils.js';

test('analytics follow the visible network and do not fall back to HIN in crash-only view', () => {
  assert.equal(analysisModeForLayers({ safety: true, hin: false, crashes: true }), 'safety');
  assert.equal(analysisModeForLayers({ safety: false, hin: true, crashes: true }), 'hin');
  assert.equal(analysisModeForLayers({ safety: false, hin: false, crashes: true }), 'crashes');
  assert.equal(analysisModeForLayers({ safety: false, hin: false, crashes: false }), 'hin');
});

const base = {
  startYear: 2021, endYear: 2025,
  severities: ['K', 'A', 'B', 'C', 'O'], location: '', assignment: 'All', mode: 'All modes',
  crashStartDate: '', crashEndDate: '', months: [], transition: 'All times',
  circumstances: [],
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

test('travel-mode filters use their published crash and network count fields', () => {
  assert.match(buildCrashWhere({ ...base, mode: 'Nonmotorist' }), /nonmotorist_counted <> 0/);
  assert.match(buildCrashWhere({ ...base, mode: 'Bicycle' }), /nonmotorist_counted <> 0 AND num_bike <> 0/);
  assert.match(buildCrashWhere({ ...base, mode: 'Pedestrian' }), /nonmotorist_counted <> 0/);
  assert.match(buildCrashWhere({ ...base, mode: 'Truck' }), /num_sut > 0 OR num_tt > 0/);
  assert.match(buildNetworkWhere({ ...base, mode: 'Truck' }, 'segment'), /num_sut > 0 OR num_tt > 0/);
});

test('contributing circumstances use source-appropriate fields and combine with AND logic', () => {
  const filtered = { ...base, circumstances: ['wetSurface', 'precipitation', 'jackknife'] };
  const crash = buildCrashWhere(filtered);
  assert.match(crash, /surface_cond = 'Wet' AND \(weather_cond_1 IN/);
  assert.match(crash, /AND first_harmful_event = 'Jackknife'/);
  const network = buildNetworkWhere(filtered, 'segment');
  assert.match(network, /surface_wet > 0 AND \(weather_rain > 0 OR weather_snow > 0 OR weather_sleet > 0\)/);
  assert.match(network, /AND first_harm_event_counts LIKE '%Jackknife:%'/);
});

test('network circumstance fields use their published text-count format and include audited categories', () => {
  const filtered = { ...base, circumstances: ['roadwayObstruction', 'trafficControlIssue', 'nonHighwayWork', 'looseSurface'] };
  const crash = buildCrashWhere(filtered);
  assert.match(crash, /CBC_envs LIKE '%"Obstruction in roadway"%'/);
  assert.match(crash, /CBC_envs LIKE '%"Traffic control issue"%'/);
  assert.match(crash, /CBC_envs LIKE '%"Non-highway work"%'/);
  assert.match(crash, /surface_cond = 'Sand\/mud\/dirt\/gravel'/);
  const network = buildNetworkWhere(filtered, 'segment');
  assert.match(network, /CBC_envs_counts LIKE '%Obstruction in roadway:%'/);
  assert.match(network, /CBC_envs_counts LIKE '%Traffic control issue:%'/);
  assert.match(network, /CBC_envs_counts LIKE '%Non-highway work:%'/);
  assert.match(network, /surface_sand > 0/);
  const existingChoices = buildNetworkWhere({ ...base, circumstances: ['glare', 'workZone'] }, 'intersection');
  assert.match(existingChoices, /CBC_envs_counts LIKE '%Glare:%'/);
  assert.match(existingChoices, /wz_related > 0 OR CBC_envs_counts LIKE '%Work zone:%'/);
});

test('paired report values suppress Not reported only when a meaningful companion exists', () => {
  assert.equal(combineReportedValues(['Rain', 'Not reported']), 'Rain');
  assert.equal(combineReportedValues(['Not reported', 'Not reported']), 'Not reported');
  assert.equal(combineReportedValues(['Rain', 'Snow']), 'Rain / Snow');
  assert.equal(combineReportedValues(['Rain', 'Rain']), 'Rain');
  assert.equal(combineReportedValues([null, '']), 'Not recorded');
});

test('crash filters combine location, severity, safer people, and the selected segment', () => {
  const where = buildCrashWhere({ ...base, location: 'city|Omaha', severities: ['K', 'A'], people: { ...base.people, speeding: true, impaired: true } }, { type: 'segment', id: 'TFL123' });
  assert.match(where, /city_name = 'Omaha'/);
  assert.match(where, /severity IN \('K', 'A'\)/);
  assert.match(where, /drv_speeding > 0/);
  assert.match(where, /drv_under_inf > 0 OR alcohol_related = 'Yes'/);
  assert.match(where, /assigned_segment_id = 'TFL123'/);
});

test('adds exact dates, months, and recorded sunrise or sunset transitions to crash queries', () => {
  const where = buildCrashWhere({ ...base, crashStartDate: '2024-03-01', crashEndDate: '2024-05-31', months: [3, 5], transition: 'Sunrise' });
  assert.match(where, /date >= DATE '2024-03-01'/);
  assert.match(where, /date < DATE '2024-06-01'/);
  assert.match(where, /EXTRACT\(MONTH FROM date\) IN \(3,5\)/);
  assert.match(where, /state = 'IA'.*light_cond = 'Dawn\/Dusk'.*time < '12:00'/);
  assert.match(where, /state = 'NE'.*EXTRACT\(MONTH FROM date\) = 1.*time >= '07:30'.*time <= '07:53'/);
  const sunset = buildCrashWhere({ ...base, transition: 'Sunset' });
  assert.match(sunset, /state = 'IA'.*time >= '12:00'.*23:59:59/);
  assert.match(sunset, /state = 'NE'.*EXTRACT\(MONTH FROM date\) = 6.*time >= '20:50'.*time <= '21:02'/);
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
