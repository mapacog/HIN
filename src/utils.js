export function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

export function sqlEquals(field, value) {
  return `${field} = '${escapeSqlLiteral(value)}'`;
}

export function parseLocation(value) {
  if (!value) return null;
  const divider = value.indexOf('|');
  return divider < 0 ? null : { type: value.slice(0, divider), name: value.slice(divider + 1) };
}

function sqlList(values) {
  return values.map((value) => `'${escapeSqlLiteral(value)}'`).join(', ');
}

function peopleClauses(people = {}, target = 'network') {
  const clauses = [];
  if (people.impaired) clauses.push(target === 'crash' ? "(drv_under_inf > 0 OR alcohol_related = 'Yes')" : '(drv_under_inf > 0 OR alcohol_related > 0)');
  if (people.unrestrained) clauses.push('(adult_unrestrained > 0 OR child_6_unrestrained > 0 OR child_8_unrestrained > 0 OR child_6_18_unrestrained > 0 OR child_8_18_unrestrained > 0)');
  if (people.speeding) clauses.push('drv_speeding > 0');
  if (people.distracted) clauses.push('drv_distracted > 0');
  if (people.youngDriver) clauses.push(target === 'crash' ? "driver_under_25 = 'Yes'" : 'driver_under_25 > 0');
  return clauses;
}

function modeClause(mode) {
  if (mode === 'Bicycle') return '(nonmotorist_counted <> 0 AND num_bike <> 0)';
  if (mode === 'Pedestrian') return '(nonmotorist_counted <> 0 AND (num_bike IS NULL OR num_bike = 0))';
  return null;
}

export function buildCrashWhere(filters, selection = null) {
  const clauses = [`Year >= ${Number(filters.startYear)}`, `Year <= ${Number(filters.endYear)}`];
  if (!filters.severities?.length) clauses.push('1 = 0');
  else if (filters.severities.length < 5) clauses.push(`severity IN (${sqlList(filters.severities)})`);
  const location = parseLocation(filters.location);
  if (location?.type === 'county') clauses.push(sqlEquals('county', location.name));
  if (location?.type === 'city') clauses.push(sqlEquals('city_name', location.name));
  if (filters.assignment && filters.assignment !== 'All') clauses.push(sqlEquals('network_assignment', filters.assignment));
  const travelMode = modeClause(filters.mode);
  if (travelMode) clauses.push(travelMode);
  clauses.push(...peopleClauses(filters.people, 'crash'));
  if (selection?.type === 'segment' && selection.id) clauses.push(sqlEquals('assigned_segment_id', selection.id));
  if (selection?.type === 'intersection' && selection.id) clauses.push(sqlEquals('assigned_junction_id', selection.id));
  if (selection?.type === 'corridor' && selection.ids?.length) clauses.push(`assigned_segment_id IN (${sqlList(selection.ids)})`);
  return clauses.join(' AND ');
}

export function buildNetworkWhere(filters, kind, { hinOnly = true, includeRoadFilters = true } = {}) {
  const clauses = hinOnly ? ['HIN = 1'] : ['1 = 1'];
  const location = parseLocation(filters.location);
  if (location?.type === 'county') clauses.push(kind === 'segment' ? sqlEquals('county_text', location.name) : `COUNTY LIKE '${escapeSqlLiteral(location.name)}%'`);
  if (location?.type === 'city') clauses.push(sqlEquals(kind === 'segment' ? 'city_name' : 'CITY', location.name));
  const travelMode = modeClause(filters.mode);
  if (travelMode) clauses.push(travelMode);
  clauses.push(...peopleClauses(filters.people, 'network'));
  if (includeRoadFilters) {
    const roads = filters.roads || {};
    if (roads.speeds?.length) {
      const parts = roads.speeds.flatMap((speed) => [sqlEquals('maxspeed', speed), sqlEquals('maxspeed', `${speed} mph`), `maxspeed LIKE '%${escapeSqlLiteral(speed)} mph%'`]);
      clauses.push(`(${parts.join(' OR ')})`);
    }
    if (roads.classes?.length) clauses.push(`HPMS_F_SYSTEM IN (${roads.classes.map(Number).join(', ')})`);
    if (kind === 'intersection' && roads.intersectionTypes?.length) clauses.push(`number_of_legs IN (${sqlList(roads.intersectionTypes)})`);
    if (kind === 'intersection' && roads.controls?.length) clauses.push(`traffic_control_type IN (${sqlList(roads.controls)})`);
  }
  return clauses.join(' AND ');
}

export function formatNumber(value, maximumFractionDigits = 0) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(Number(value));
}

export function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part || 0) / Number(whole)) * 100);
}

export function rateRatio(selectedEvents, selectedUnits, allEvents, allUnits) {
  const selectedRate = Number(selectedEvents || 0) / Number(selectedUnits || 0);
  const otherEvents = Math.max(0, Number(allEvents || 0) - Number(selectedEvents || 0));
  const otherUnits = Math.max(0, Number(allUnits || 0) - Number(selectedUnits || 0));
  const otherRate = otherEvents / otherUnits;
  if (!Number.isFinite(selectedRate) || !Number.isFinite(otherRate) || otherRate === 0) return null;
  return selectedRate / otherRate;
}

export function toCsv(records, columns) {
  const escape = (value) => {
    if (value == null) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.map((column) => escape(column.label)).join(','), ...records.map((record) => columns.map((column) => escape(record[column.field])).join(','))].join('\r\n');
}

export function classifyTrend(yearCounts) {
  const lookup = new Map(yearCounts.map(({ year, count }) => [Number(year), Number(count || 0)]));
  const total = (from, through) => {
    let value = 0;
    for (let year = from; year <= through; year += 1) value += lookup.get(year) || 0;
    return value;
  };
  const prior = total(2018, 2022);
  const recent = total(2021, 2025);
  if (prior + recent < 3) return 'About the same';
  const change = prior ? (recent - prior) / prior : recent > 0 ? 1 : 0;
  if (change >= 0.1) return 'Increasing';
  if (change <= -0.1) return 'Decreasing';
  return 'About the same';
}

export function normalizeNetworkFeature(graphic, kind) {
  const a = graphic?.attributes || {};
  const segment = kind === 'segment';
  return {
    objectId: a.OBJECTID, type: kind,
    id: segment ? a.TFL_UID : a.int_ID,
    name: segment ? a.street_name || `Road ${a.TFL_UID || ''}` : a.INTERSECTI || `Intersection ${a.int_ID || ''}`,
    city: segment ? a.city_name : a.CITY,
    county: segment ? a.county_text : String(a.COUNTY || '').replace(/ County$/i, ''),
    crashes: Math.max(Number(a.total_crashes || 0), Number(a.num_K_count || 0) + Number(a.num_A_count || 0) + Number(a.num_B_count || 0) + Number(a.num_C_count || 0)),
    kaCrashes: Math.max(Number(a.KA_crashes || 0), Number(a.num_K_count || 0) + Number(a.num_A_count || 0)),
    fatalities: Number(a.num_K_occ || 0) + Number(a.num_K_nonm || 0),
    serious: Number(a.num_A_occ || 0) + Number(a.num_A_nonm || 0),
    miles: segment ? Number(a.Segment_Miles || 0) : null,
    speed: a.maxspeed, functionalClass: a.HPMS_F_SYSTEM,
    lanes: segment ? a.lanes : a.number_of_legs,
    control: segment ? null : a.traffic_control_type,
    nonmotorists: Number(a.nonmotorist_counted || 0), bicycles: Number(a.num_bike || 0),
    vehicles: Number(a.num_veh_count || a.num_veh || 0), occupants: Number(a.num_occ_count || a.num_occ || 0),
    speeding: Number(a.drv_speeding || 0), impaired: Number(a.drv_under_inf || 0) + Number(a.alcohol_related || 0),
    hin: Number(a.HIN || 0), graphic,
  };
}

export const selectedFeatureFromGraphic = normalizeNetworkFeature;

export function chunk(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
