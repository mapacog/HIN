export function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

export function analysisModeForLayers(visible = {}) {
  if (visible.safety) return 'safety';
  if (visible.hin) return 'hin';
  if (visible.crashes) return 'crashes';
  return 'hin';
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
  if (mode === 'Nonmotorist') return 'nonmotorist_counted <> 0';
  if (mode === 'Bicycle') return '(nonmotorist_counted <> 0 AND num_bike <> 0)';
  if (mode === 'Pedestrian') return '(nonmotorist_counted <> 0 AND (num_bike IS NULL OR num_bike = 0))';
  if (mode === 'Truck') return '(num_sut > 0 OR num_tt > 0)';
  return null;
}

function jsonKeyClause(field, key) {
  return `${field} LIKE '%"${escapeSqlLiteral(key)}"%'`;
}

function countTextKeyClause(field, key) {
  return `${field} LIKE '%${escapeSqlLiteral(key)}:%'`;
}

function environmentKeyClause(crash, key) {
  return crash ? jsonKeyClause('CBC_envs', key) : countTextKeyClause('CBC_envs_counts', key);
}

function contributingCircumstanceClauses(values = [], target = 'network') {
  const crash = target === 'crash';
  return values.map((value) => {
    switch (value) {
      case 'wetSurface':
        return crash ? "surface_cond = 'Wet'" : 'surface_wet > 0';
      case 'winterSurface':
        return crash ? "surface_cond IN ('Snow', 'Ice', 'Slush')" : '(surface_snow > 0 OR surface_ice > 0 OR surface_slush > 0)';
      case 'standingWater':
        return crash ? "surface_cond = 'Water'" : 'surface_water > 0';
      case 'looseSurface':
        return crash ? "surface_cond = 'Sand/mud/dirt/gravel'" : 'surface_sand > 0';
      case 'precipitation':
        return crash
          ? "(weather_cond_1 IN ('Rain', 'Snow', 'Sleet/hail/freezing rain/drizzle') OR weather_cond_2 IN ('Rain', 'Snow', 'Sleet/hail/freezing rain/drizzle'))"
          : '(weather_rain > 0 OR weather_snow > 0 OR weather_sleet > 0)';
      case 'reducedVisibility':
        return crash
          ? "(weather_cond_1 IN ('Fog/smog/smoke', 'Blowing sand/soil/dirt/snow') OR weather_cond_2 IN ('Fog/smog/smoke', 'Blowing sand/soil/dirt/snow'))"
          : '(weather_fog > 0 OR weather_blowing > 0)';
      case 'severeWinds':
        return crash ? "(weather_cond_1 = 'Severe winds' OR weather_cond_2 = 'Severe winds')" : 'weather_wind > 0';
      case 'glare': return environmentKeyClause(crash, 'Glare');
      case 'visualObstruction': return environmentKeyClause(crash, 'Visual obstruction');
      case 'roadwayObstruction': return environmentKeyClause(crash, 'Obstruction in roadway');
      case 'trafficControlIssue': return environmentKeyClause(crash, 'Traffic control issue');
      case 'animalRoadway': return environmentKeyClause(crash, 'Animal in roadway');
      case 'workZone': return crash
        ? `(wz_related = 'Yes' OR ${environmentKeyClause(true, 'Work zone')})`
        : `(wz_related > 0 OR ${environmentKeyClause(false, 'Work zone')})`;
      case 'nonHighwayWork': return environmentKeyClause(crash, 'Non-highway work');
      case 'debris': return environmentKeyClause(crash, 'Debris');
      case 'roughRoad': return environmentKeyClause(crash, 'Ruts/holes/bumps');
      case 'shoulderCondition': return environmentKeyClause(crash, 'Shoulders (none/low/soft/high)');
      case 'slipperySurface': return environmentKeyClause(crash, 'Slippery/loose/worn surface');
      case 'jackknife': return crash ? "first_harmful_event = 'Jackknife'" : countTextKeyClause('first_harm_event_counts', 'Jackknife');
      default: return null;
    }
  }).filter(Boolean);
}

export function combineReportedValues(values = [], fallback = 'Not recorded') {
  const cleaned = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  const reported = cleaned.filter((value) => value.toLowerCase() !== 'not reported');
  const source = reported.length ? reported : cleaned.some((value) => value.toLowerCase() === 'not reported') ? ['Not reported'] : [];
  return [...new Map(source.map((value) => [value.toLowerCase(), value])).values()].join(' / ') || fallback;
}

function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function nextIsoDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const SOLAR_REFERENCE = { latitude: 41.2565, longitude: -95.9345, timeZone: 'America/Chicago' };
const SOLAR_WINDOW_MINUTES = 180;
const SOLAR_WINDOW_CACHE = new Map();
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const JULIAN_ZERO = 0.0009;
const RAD = Math.PI / 180;
const OBLIQUITY = RAD * 23.4397;

function toJulian(date) { return date.valueOf() / DAY_MS - 0.5 + J1970; }
function fromJulian(julian) { return new Date((julian + 0.5 - J1970) * DAY_MS); }
function solarMeanAnomaly(days) { return RAD * (357.5291 + 0.98560028 * days); }
function eclipticLongitude(anomaly) {
  const equation = RAD * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  return anomaly + equation + RAD * 102.9372 + Math.PI;
}
function solarDeclination(longitude) { return Math.asin(Math.sin(OBLIQUITY) * Math.sin(longitude)); }
function julianCycle(days, westLongitude) { return Math.round(days - JULIAN_ZERO - westLongitude / (2 * Math.PI)); }
function approximateTransit(hourAngle, westLongitude, cycle) { return JULIAN_ZERO + (hourAngle + westLongitude) / (2 * Math.PI) + cycle; }
function solarTransitJulian(transit, anomaly, longitude) { return J2000 + transit + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * longitude); }
function solarHourAngle(altitude, latitude, declination) {
  return Math.acos((Math.sin(altitude) - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination)));
}

function solarEvent(year, month, day, period) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const days = toJulian(date) - J2000;
  const westLongitude = -SOLAR_REFERENCE.longitude * RAD;
  const latitude = SOLAR_REFERENCE.latitude * RAD;
  const cycle = julianCycle(days, westLongitude);
  const approximateNoon = approximateTransit(0, westLongitude, cycle);
  const anomaly = solarMeanAnomaly(approximateNoon);
  const longitude = eclipticLongitude(anomaly);
  const declination = solarDeclination(longitude);
  const noon = solarTransitJulian(approximateNoon, anomaly, longitude);
  const hourAngle = solarHourAngle(-0.833 * RAD, latitude, declination);
  const set = solarTransitJulian(approximateTransit(hourAngle, westLongitude, cycle), anomaly, longitude);
  const rise = noon - (set - noon);
  return fromJulian(period === 'Sunrise' ? rise : set);
}

function localClockMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SOLAR_REFERENCE.timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0) % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function clockText(minutes) {
  const bounded = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function solarTransitionWindows(period, startYear, endYear) {
  const firstYear = Math.max(2000, Number(startYear) || 2000);
  const lastYear = Math.max(firstYear, Number(endYear) || firstYear);
  const cacheKey = `${period}:${firstYear}:${lastYear}`;
  if (SOLAR_WINDOW_CACHE.has(cacheKey)) return SOLAR_WINDOW_CACHE.get(cacheKey);
  const monthly = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, minimum: Infinity, maximum: -Infinity }));
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      // Month endpoints and midpoint capture the seasonal range. Extra March and
      // November samples capture both sides of the Central Time DST transition.
      const sampleDays = new Set([1, 15, lastDay]);
      if (month === 3 || month === 11) for (let day = 7; day <= 14; day += 1) sampleDays.add(Math.min(day, lastDay));
      for (const day of sampleDays) {
        const minutes = localClockMinutes(solarEvent(year, month, day, period));
        monthly[month - 1].minimum = Math.min(monthly[month - 1].minimum, minutes);
        monthly[month - 1].maximum = Math.max(monthly[month - 1].maximum, minutes);
      }
    }
  }
  const result = monthly.map(({ month, minimum, maximum }) => [month, clockText(minimum - SOLAR_WINDOW_MINUTES), clockText(maximum + SOLAR_WINDOW_MINUTES)]);
  SOLAR_WINDOW_CACHE.set(cacheKey, result);
  return result;
}

function transitionClause(period, startYear, endYear) {
  const windows = solarTransitionWindows(period, startYear, endYear)
    .map(([month, start, end]) => `(EXTRACT(MONTH FROM date) = ${month} AND time >= '${start}' AND time <= '${end}')`)
    .join(' OR ');
  return `(light_cond = 'Dawn/Dusk' AND (${windows}))`;
}

export function buildCrashWhere(filters, selection = null) {
  const clauses = [`Year >= ${Number(filters.startYear)}`, `Year <= ${Number(filters.endYear)}`];
  if (!filters.severities?.length) clauses.push('1 = 0');
  else if (filters.severities.length < 5) clauses.push(`severity IN (${sqlList(filters.severities)})`);
  const location = parseLocation(filters.location);
  if (location?.type === 'county') clauses.push(sqlEquals('county', location.name));
  if (location?.type === 'city') clauses.push(sqlEquals('city_name', location.name));
  if (validIsoDate(filters.crashStartDate)) clauses.push(`date >= DATE '${filters.crashStartDate}'`);
  if (validIsoDate(filters.crashEndDate)) clauses.push(`date < DATE '${nextIsoDate(filters.crashEndDate)}'`);
  const months = filters.months?.map(Number).filter((month) => month >= 1 && month <= 12) || [];
  if (months.length) clauses.push(`EXTRACT(MONTH FROM date) IN (${months.join(',')})`);
  if (filters.transition === 'Sunrise' || filters.transition === 'Sunset') clauses.push(transitionClause(filters.transition, filters.startYear, filters.endYear));
  if (filters.assignment && filters.assignment !== 'All') clauses.push(sqlEquals('network_assignment', filters.assignment));
  const travelMode = modeClause(filters.mode);
  if (travelMode) clauses.push(travelMode);
  clauses.push(...peopleClauses(filters.people, 'crash'));
  clauses.push(...contributingCircumstanceClauses(filters.circumstances, 'crash'));
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
  clauses.push(...contributingCircumstanceClauses(filters.circumstances, 'network'));
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

export function concentrationRatio(selectedEvents, selectedUnits, allEvents, allUnits, minimumEvents = 5) {
  const events = Number(selectedEvents || 0);
  const units = Number(selectedUnits || 0);
  const totalEvents = Number(allEvents || 0);
  const totalUnits = Number(allUnits || 0);
  if (events < minimumEvents || units <= 0 || totalEvents <= 0 || totalUnits <= 0) return null;
  const eventShare = events / totalEvents;
  const networkShare = units / totalUnits;
  if (!Number.isFinite(eventShare) || !Number.isFinite(networkShare) || networkShare <= 0) return null;
  return eventShare / networkShare;
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
    speeding: Number(a.drv_speeding || 0), distracted: Number(a.drv_distracted || 0),
    impaired: Number(a.drv_under_inf || 0) + Number(a.alcohol_related || 0),
    unrestrained: Number(a.adult_unrestrained || 0) + Math.max(Number(a.child_6_unrestrained || 0), Number(a.child_8_unrestrained || 0), Number(a.child_6_18_unrestrained || 0), Number(a.child_8_18_unrestrained || 0)),
    youngDrivers: Number(a.driver_under_25 || 0), olderDrivers: Number(a.driver_65 || 0),
    workZones: Number(a.wz_related || 0), citations: Number(a.num_cited_drv || 0),
    hin: Number(a.HIN || 0), graphic,
  };
}

export const selectedFeatureFromGraphic = normalizeNetworkFeature;

export function chunk(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
