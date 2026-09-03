import { useEffect, useMemo, useRef, useState } from 'react';
import WebMap from '@arcgis/core/WebMap.js';
import MapView from '@arcgis/core/views/MapView.js';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import BasemapGallery from '@arcgis/core/widgets/BasemapGallery.js';
import Expand from '@arcgis/core/widgets/Expand.js';
import Home from '@arcgis/core/widgets/Home.js';
import LayerList from '@arcgis/core/widgets/LayerList.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import Search from '@arcgis/core/widgets/Search.js';
import ScaleBar from '@arcgis/core/widgets/ScaleBar.js';
import {
  BarChart3, Bike, Car, ChevronDown, CircleAlert, Download, Filter, Footprints,
  Layers3, Map as MapIcon, Menu, RefreshCcw, Route, Search as SearchIcon,
  ShieldCheck, SlidersHorizontal, Table2, X,
} from 'lucide-react';
import {
  BRAND, CONTROL_OPTIONS, DEFAULT_FILTERS, FUNCTIONAL_CLASSES, INTERSECTION_TYPES,
  LAYER_TITLES, MAP_EXTENT, SEVERITIES, SERVICE_URLS, SPEED_OPTIONS,
  WEBMAP_ID, YEAR_MAX, YEAR_MIN,
} from './config.js';
import {
  buildCrashWhere, buildNetworkWhere, chunk, classifyTrend, escapeSqlLiteral,
  formatNumber, normalizeNetworkFeature, parseLocation, percent, rateRatio,
} from './utils.js';
import { exportNetwork } from './exports.js';

const LOCATIONS = {
  counties: ['Douglas', 'Pottawattamie', 'Sarpy'],
  cities: ['Bellevue', 'Bennington', 'Carter Lake', 'Council Bluffs', 'Crescent', 'Gretna', 'La Vista', 'McClelland', 'Offutt AFB', 'Omaha', 'Papillion', 'Ralston', 'Springfield', 'Valley', 'Waterloo'],
};

const NETWORK_METRIC_FIELDS = [
  'total_crashes', 'KA_crashes', 'num_K_count', 'num_A_count', 'num_B_count', 'num_C_count',
  'num_K_occ', 'num_K_nonm', 'num_A_occ', 'num_A_nonm', 'nonmotorist_counted', 'num_bike',
  'num_veh_count', 'num_veh', 'num_occ_count', 'num_occ', 'drv_speeding', 'drv_under_inf',
  'alcohol_related', 'drv_distracted', 'drv_fatigued', 'driver_under_25', 'driver_13_19',
  'driver_65', 'driver_75', 'num_occ_65', 'num_occ_75', 'num_nonm_child', 'num_cited_drv',
  'adult_unrestrained', 'child_6_unrestrained', 'child_8_unrestrained',
  'child_6_18_unrestrained', 'child_8_18_unrestrained', 'wz_related', 'school_zone',
  'weekend_crashes', 'dark_lit', 'manner_broadside', 'manner_headon', 'manner_angle',
  'manner_leftturn', 'manner_rearend', 'manner_sideswipe_opp', 'manner_sideswipe_same',
  'first_harm_event_counts', 'CBC_drvs_counts', 'veh_actions_counts', 'nonm_locations_counts',
  'HIN',
];
const SEGMENT_OUT_FIELDS = ['OBJECTID', 'TFL_UID', 'street_name', 'city_name', 'county_text', 'Segment_Miles', 'maxspeed', 'HPMS_F_SYSTEM', 'URBAN_RURAL', 'lanes', 'surface', 'one_way', 'ADJ_AADT2025', ...NETWORK_METRIC_FIELDS];
const INTERSECTION_OUT_FIELDS = ['OBJECTID', 'int_ID', 'INTERSECTI', 'CITY', 'COUNTY', 'number_of_legs', 'traffic_control_type', 'intersection_lighting', 'lighting', 'maxspeed', 'HPMS_F_SYSTEM', 'URBAN_RURAL', ...NETWORK_METRIC_FIELDS];
const CRASH_POPUP_FIELDS = [
  'OBJECTID', 'crash_id', 'severity', 'date', 'day', 'time', 'city_name', 'county',
  'num_K_count', 'num_A_count', 'num_B_count', 'num_C_count', 'num_veh', 'num_veh_count',
  'num_occ', 'num_occ_count', 'num_K_occ', 'num_A_occ', 'num_K_nonm', 'num_A_nonm',
  'nonmotorist_counted', 'num_bike', 'light_cond', 'weather_cond_1', 'weather_cond_2',
  'surface_cond', 'manner_of_collision', 'first_harmful_event', 'first_harm_location',
  'alcohol_related', 'driver_under_25', 'driver_13_19', 'driver_65', 'driver_75',
  'drv_phys_impairment', 'drv_fatigued', 'drv_under_inf', 'drv_distracted', 'drv_speeding',
  'adult_unrestrained', 'child_6_unrestrained', 'child_8_unrestrained',
  'child_6_18_unrestrained', 'child_8_18_unrestrained', 'num_ejected', 'num_trapped',
  'wz_related', 'wz_location', 'wz_type', 'wz_workers_present', 'school_zone',
  'school_bus_rlt', 'emergency_veh_rlt', 'traffic_signal', 'stop_sign', 'yield_sign',
  'network_assignment', 'assigned_segment_id', 'assigned_junction_id',
];

const EMPTY_PERFORMANCE = {
  roads: { crashes: 0, fatal: 0, serious: 0, miles: 0, count: 0 },
  intersections: { crashes: 0, fatal: 0, serious: 0, count: 0 },
  baseRoads: { crashes: 0, fatal: 0, serious: 0, miles: 0, count: 0 },
  baseIntersections: { crashes: 0, fatal: 0, serious: 0, count: 0 },
};

function findLayer(webmap, title) {
  return webmap.allLayers.find((layer) => layer.title?.trim() === title);
}

function statistic(statisticType, onStatisticField, outStatisticFieldName) {
  return { statisticType, onStatisticField, outStatisticFieldName };
}

function attributesOf(result) {
  return result?.features?.[0]?.attributes || {};
}

async function queryNetworkRows(layer, where, kind, geometry = false) {
  const result = await layer.queryFeatures({ where, outFields: ['*'], returnGeometry: geometry, outSpatialReference: { wkid: 4326 }, orderByFields: ['KA_crashes DESC'] });
  return result.features.map((graphic) => normalizeNetworkFeature(graphic, kind));
}

async function querySafetyBase(layer, where, kind) {
  const outStatistics = [
    statistic('count', 'OBJECTID', 'count'), statistic('sum', 'total_crashes', 'crashes'),
    statistic('sum', 'num_K_occ', 'fatalOcc'), statistic('sum', 'num_K_nonm', 'fatalNonm'),
    statistic('sum', 'num_A_occ', 'seriousOcc'), statistic('sum', 'num_A_nonm', 'seriousNonm'),
  ];
  if (kind === 'segment') outStatistics.push(statistic('sum', 'Segment_Miles', 'miles'));
  const result = await layer.queryFeatures({ where, outStatistics, returnGeometry: false });
  const values = attributesOf(result);
  return {
    count: Number(values.count || 0), miles: Number(values.miles || 0), crashes: Number(values.crashes || 0),
    fatal: Number(values.fatalOcc || 0) + Number(values.fatalNonm || 0),
    serious: Number(values.seriousOcc || 0) + Number(values.seriousNonm || 0),
  };
}

function aggregateNetworkRows(rows) {
  return rows.reduce((totals, row) => ({
    crashes: totals.crashes + row.crashes,
    fatal: totals.fatal + row.fatalities,
    serious: totals.serious + row.serious,
    miles: totals.miles + Number(row.miles || 0),
    count: totals.count + 1,
    nonmotorists: totals.nonmotorists + row.nonmotorists,
    bicycles: totals.bicycles + row.bicycles,
    vehicles: totals.vehicles + row.vehicles,
    occupants: totals.occupants + row.occupants,
  }), { crashes: 0, fatal: 0, serious: 0, miles: 0, count: 0, nonmotorists: 0, bicycles: 0, vehicles: 0, occupants: 0 });
}

async function queryCrashBase(layer, where, assignment) {
  const result = await layer.queryFeatures({
    where: `${where} AND network_assignment = '${assignment}'`,
    outStatistics: [
      statistic('count', 'OBJECTID', 'crashes'),
      statistic('sum', 'num_K_occ', 'fatalOcc'), statistic('sum', 'num_K_nonm', 'fatalNonm'),
      statistic('sum', 'num_A_occ', 'seriousOcc'), statistic('sum', 'num_A_nonm', 'seriousNonm'),
    ],
    returnGeometry: false,
  });
  const a = attributesOf(result);
  return {
    crashes: Number(a.crashes || 0),
    fatal: Number(a.fatalOcc || 0) + Number(a.fatalNonm || 0),
    serious: Number(a.seriousOcc || 0) + Number(a.seriousNonm || 0),
  };
}

async function queryLinkedByYear(layer, ids, idField, where) {
  const totals = new Map();
  const groups = await Promise.all(chunk(ids.filter(Boolean), 80).map(async (idChunk) => {
    const quoted = idChunk.map((id) => `'${escapeSqlLiteral(id)}'`).join(',');
    const result = await layer.queryFeatures({
      where: `${where} AND ${idField} IN (${quoted})`,
      groupByFieldsForStatistics: [idField, 'Year', 'severity'],
      orderByFields: [idField, 'Year', 'severity'],
      outStatistics: [
        statistic('count', 'OBJECTID', 'crashes'),
        statistic('sum', 'num_K_occ', 'fatalOcc'), statistic('sum', 'num_K_nonm', 'fatalNonm'),
        statistic('sum', 'num_A_occ', 'seriousOcc'), statistic('sum', 'num_A_nonm', 'seriousNonm'),
        statistic('sum', 'nonmotorist_counted', 'nonmotorists'), statistic('sum', 'num_veh_count', 'vehicles'),
        statistic('sum', 'drv_speeding', 'speeding'), statistic('sum', 'drv_distracted', 'distracted'),
        statistic('sum', 'drv_under_inf', 'underInfluence'),
        statistic('sum', "CASE WHEN alcohol_related = 'Yes' THEN 1 ELSE 0 END", 'alcohol'),
        statistic('sum', "CASE WHEN driver_under_25 = 'Yes' THEN 1 ELSE 0 END", 'youngDrivers'),
        statistic('sum', "CASE WHEN driver_65 = 'Yes' THEN 1 ELSE 0 END", 'olderDrivers'),
        statistic('sum', "CASE WHEN wz_related = 'Yes' THEN 1 ELSE 0 END", 'workZones'),
        statistic('sum', 'adult_unrestrained', 'unrestrained'),
      ],
      returnGeometry: false,
      maxRecordCountFactor: 5,
    });
    return result.features;
  }));
  for (const feature of groups.flat()) {
    const a = feature.attributes;
    const id = String(a[idField]);
    if (!totals.has(id)) totals.set(id, []);
    totals.get(id).push({
      year: Number(a.Year), severity: a.severity, crashes: Number(a.crashes || 0),
      fatal: Number(a.fatalOcc || 0) + Number(a.fatalNonm || 0),
      serious: Number(a.seriousOcc || 0) + Number(a.seriousNonm || 0),
      nonmotorists: Number(a.nonmotorists || 0), vehicles: Number(a.vehicles || 0),
      speeding: Number(a.speeding || 0), distracted: Number(a.distracted || 0),
      impaired: Number(a.underInfluence || 0) + Number(a.alcohol || 0), unrestrained: Number(a.unrestrained || 0),
      youngDrivers: Number(a.youngDrivers || 0), olderDrivers: Number(a.olderDrivers || 0), workZones: Number(a.workZones || 0),
    });
  }
  return totals;
}

function periodTotal(map, ids, startYear, endYear) {
  const total = { crashes: 0, fatal: 0, serious: 0, nonmotorists: 0, vehicles: 0, speeding: 0, distracted: 0, impaired: 0, unrestrained: 0, youngDrivers: 0, olderDrivers: 0, workZones: 0, years: {}, severity: {} };
  for (const id of ids) {
    for (const row of map.get(String(id)) || []) {
      if (row.year >= startYear && row.year <= endYear) {
        total.crashes += row.crashes; total.fatal += row.fatal; total.serious += row.serious;
        total.nonmotorists += row.nonmotorists || 0; total.vehicles += row.vehicles || 0;
        total.speeding += row.speeding || 0; total.distracted += row.distracted || 0;
        total.impaired += row.impaired || 0; total.unrestrained += row.unrestrained || 0;
        total.youngDrivers += row.youngDrivers || 0; total.olderDrivers += row.olderDrivers || 0; total.workZones += row.workZones || 0;
        total.years[row.year] = (total.years[row.year] || 0) + row.crashes;
        total.severity[row.severity] = (total.severity[row.severity] || 0) + row.crashes;
      }
    }
  }
  return total;
}

function numeric(attributes, field) {
  return Number(attributes?.[field] || 0);
}

function isYes(value) {
  return value === true || Number(value) > 0 || /^(yes|true)$/i.test(String(value || '').trim());
}

function fieldText(value, fallback = 'Not recorded') {
  const text = String(value ?? '').trim();
  return text && !/^(null|undefined)$/i.test(text) ? text : fallback;
}

function functionalClassLabel(value) {
  const match = FUNCTIONAL_CLASSES.find((item) => Number(item.value) === Number(value));
  return match?.label || fieldText(value);
}

function addPopupSection(container, title, text, className = '') {
  if (!text) return;
  const section = document.createElement('section');
  section.className = `popup-section ${className}`.trim();
  const heading = document.createElement('h4');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  section.append(heading, paragraph);
  container.append(section);
}

function addPopupChips(container, title, items, note) {
  const visibleItems = items.filter(([, value]) => Number(value) > 0);
  if (!visibleItems.length) return;
  const section = document.createElement('section');
  section.className = 'popup-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const chips = document.createElement('div');
  chips.className = 'popup-chips';
  for (const [label, value] of visibleItems) {
    const chip = document.createElement('span');
    chip.textContent = `${label} · ${Number(value).toLocaleString()}`;
    chips.append(chip);
  }
  section.append(heading, chips);
  if (note) {
    const small = document.createElement('small');
    small.className = 'popup-note';
    small.textContent = note;
    section.append(small);
  }
  container.append(section);
}

function addPopupDetails(container, title, rows) {
  const section = document.createElement('section');
  section.className = 'popup-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const detail = document.createElement('dl');
  for (const [term, value] of rows.filter(([, value]) => value !== null && value !== undefined && value !== '')) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    detail.append(dt, dd);
  }
  section.append(heading, detail);
  container.append(section);
}

function summarizedCounts(value, limit = 2) {
  const text = String(value || '').trim();
  if (!text || /^no data$/i.test(text)) return '';
  return text.split(/,\s*/).slice(0, limit).join('; ');
}

function addPopupMetrics(container, metrics) {
  const grid = document.createElement('div');
  grid.className = 'popup-metrics';
  for (const [labelText, metricValue] of metrics) {
    const item = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = typeof metricValue === 'number' ? metricValue.toLocaleString() : metricValue;
    const small = document.createElement('small');
    small.textContent = labelText;
    item.append(b, small);
    grid.append(item);
  }
  container.append(grid);
}

function crashPopupTemplate() {
  return {
    title: 'Crash {crash_id}',
    outFields: CRASH_POPUP_FIELDS,
    content: [{
      type: 'custom',
      creator: ({ graphic }) => {
        const a = graphic.attributes || {};
        const wrap = document.createElement('div');
        wrap.className = 'network-popup crash-popup';
        const severity = SEVERITIES.find((item) => item.value === a.severity)?.label || fieldText(a.severity);
        const killed = numeric(a, 'num_K_occ') + numeric(a, 'num_K_nonm');
        const seriouslyInjured = numeric(a, 'num_A_occ') + numeric(a, 'num_A_nonm');
        const vehicles = numeric(a, 'num_veh') || numeric(a, 'num_veh_count');
        const occupants = numeric(a, 'num_occ') || numeric(a, 'num_occ_count');
        const nonmotorists = numeric(a, 'nonmotorist_counted');
        const location = [a.city_name, a.county].filter(Boolean).join(', ') || 'the selected area';
        const date = a.date ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(a.date)) : 'an unrecorded date';
        const lead = document.createElement('p');
        lead.textContent = `${severity} crash recorded ${date} in ${location}.`;
        wrap.append(lead);
        addPopupMetrics(wrap, [
          ['Highest severity', severity], ['People killed', killed], ['Seriously injured', seriouslyInjured],
          ['Vehicles', vehicles], ['Occupants', occupants], ['Nonmotorists', nonmotorists],
        ]);
        addPopupChips(wrap, 'Recorded factors', [
          ['Speeding', numeric(a, 'drv_speeding')],
          ['Distracted driving', numeric(a, 'drv_distracted')],
          ['Impairment / alcohol', Math.max(numeric(a, 'drv_under_inf'), numeric(a, 'drv_phys_impairment'), isYes(a.alcohol_related) ? 1 : 0)],
          ['Unrestrained', numeric(a, 'adult_unrestrained') + Math.max(numeric(a, 'child_6_unrestrained'), numeric(a, 'child_8_unrestrained'), numeric(a, 'child_6_18_unrestrained'), numeric(a, 'child_8_18_unrestrained'))],
          ['Driver under 25', isYes(a.driver_under_25) ? 1 : 0],
          ['Driver 65+', isYes(a.driver_65) ? 1 : 0],
          ['Fatigue', numeric(a, 'drv_fatigued')],
          ['Work zone', isYes(a.wz_related) ? 1 : 0],
          ['School zone', isYes(a.school_zone) ? 1 : 0],
          ['Ejected', numeric(a, 'num_ejected')],
          ['Trapped', numeric(a, 'num_trapped')],
        ], 'Only recorded indicators are shown; categories may overlap.');
        const weather = [a.weather_cond_1, a.weather_cond_2].filter((value, index, values) => value && value !== values[index - 1]).join(' / ');
        addPopupDetails(wrap, 'Crash circumstances', [
          ['Day / time', [a.day, a.time].filter(Boolean).join(' · ') || 'Not recorded'],
          ['Light', fieldText(a.light_cond)], ['Weather', fieldText(weather)], ['Surface', fieldText(a.surface_cond)],
          ['Collision', fieldText(a.manner_of_collision)], ['First harmful event', fieldText(a.first_harmful_event)],
          ['Event location', fieldText(a.first_harm_location)],
        ]);
        const vulnerable = [];
        if (nonmotorists) vulnerable.push(`${nonmotorists.toLocaleString()} nonmotorist${nonmotorists === 1 ? '' : 's'}`);
        if (numeric(a, 'num_bike')) vulnerable.push(`${numeric(a, 'num_bike').toLocaleString()} bicyclist${numeric(a, 'num_bike') === 1 ? '' : 's'}`);
        if (vulnerable.length) addPopupSection(wrap, 'Vulnerable road users', `This crash involved ${vulnerable.join(', including ')}.`);
        addPopupDetails(wrap, 'Network linkage', [
          ['Assignment', fieldText(a.network_assignment)],
          ['Safety segment', fieldText(a.assigned_segment_id)],
          ['Safety intersection', fieldText(a.assigned_junction_id)],
        ]);
        return wrap;
      },
    }],
  };
}

function popupTemplate(kind, crashLayer, filterRef) {
  const segment = kind === 'segment';
  const idField = segment ? 'TFL_UID' : 'int_ID';
  const crashIdField = segment ? 'assigned_segment_id' : 'assigned_junction_id';
  return {
    title: segment ? '{street_name}' : '{INTERSECTI}',
    outFields: segment ? SEGMENT_OUT_FIELDS : INTERSECTION_OUT_FIELDS,
    content: [{
      type: 'custom',
      creator: async ({ graphic }) => {
        const id = graphic.attributes[idField];
        const activeFilters = filterRef.current;
        const base = buildCrashWhere(activeFilters);
        let counts = {};
        try {
          const result = await crashLayer.queryFeatures({
            where: `${base} AND ${crashIdField} = '${escapeSqlLiteral(id)}'`,
            groupByFieldsForStatistics: ['severity'],
            outStatistics: [statistic('count', 'OBJECTID', 'count')],
            returnGeometry: false,
          });
          counts = Object.fromEntries(result.features.map((feature) => [feature.attributes.severity, Number(feature.attributes.count || 0)]));
        } catch { counts = {}; }
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        const wrap = document.createElement('div');
        wrap.className = 'network-popup';
        const summary = document.createElement('p');
        summary.textContent = `${total.toLocaleString()} linked crash records match the active crash filters.`;
        wrap.append(summary);
        const a = graphic.attributes;
        const metrics = [
          ['All-period crashes', Math.max(numeric(a, 'total_crashes'), numeric(a, 'num_K_count') + numeric(a, 'num_A_count') + numeric(a, 'num_B_count') + numeric(a, 'num_C_count'))],
          ['Fatal + serious crashes', Math.max(numeric(a, 'KA_crashes'), numeric(a, 'num_K_count') + numeric(a, 'num_A_count'))],
          ['People killed', numeric(a, 'num_K_occ') + numeric(a, 'num_K_nonm')],
          ['Seriously injured', numeric(a, 'num_A_occ') + numeric(a, 'num_A_nonm')],
          ['Nonmotorists', numeric(a, 'nonmotorist_counted')],
          ['Bicyclists', numeric(a, 'num_bike')],
        ];
        addPopupMetrics(wrap, metrics);
        const reasons = [];
        if (activeFilters.mode !== 'All modes') reasons.push(activeFilters.mode.toLowerCase());
        for (const [key, labelText] of Object.entries({ impaired: 'impaired', unrestrained: 'unrestrained', speeding: 'speeding', distracted: 'distracted-driving', youngDriver: 'young-driver' })) if (activeFilters.people[key]) reasons.push(labelText);
        if (reasons.length) { const reason = document.createElement('p'); reason.className = 'popup-reason'; reason.textContent = `Shown because this location has ${reasons.join(' + ')} crash attributes in the safety network.`; wrap.append(reason); }
        const severitySection = document.createElement('section');
        severitySection.className = 'popup-section';
        const severityHeading = document.createElement('h4');
        severityHeading.textContent = 'Active-filter crash severity';
        severitySection.append(severityHeading);
        for (const severity of SEVERITIES) {
          const row = document.createElement('div');
          row.className = 'popup-bar';
          const label = document.createElement('span'); label.textContent = severity.label;
          const track = document.createElement('i');
          const fill = document.createElement('b'); fill.style.width = `${total ? (counts[severity.value] || 0) / total * 100 : 0}%`; fill.style.background = severity.color;
          track.append(fill);
          const value = document.createElement('strong'); value.textContent = (counts[severity.value] || 0).toLocaleString();
          row.append(label, track, value); severitySection.append(row);
        }
        wrap.append(severitySection);
        const allPeriodCrashes = Number(metrics[0][1]);
        const vehicles = numeric(a, 'num_veh') || numeric(a, 'num_veh_count');
        const occupants = numeric(a, 'num_occ') || numeric(a, 'num_occ_count');
        const locationKind = segment
          ? `${numeric(a, 'Segment_Miles').toFixed(2)}-mile roadway segment`
          : a.number_of_legs ? `${a.number_of_legs}-leg intersection` : 'intersection';
        addPopupSection(wrap, 'All-period safety profile', `This ${locationKind} has ${allPeriodCrashes.toLocaleString()} recorded crashes involving ${vehicles.toLocaleString()} vehicles and ${occupants.toLocaleString()} occupants.`, 'popup-profile');
        const unrestrained = numeric(a, 'adult_unrestrained') + Math.max(numeric(a, 'child_6_unrestrained'), numeric(a, 'child_8_unrestrained'), numeric(a, 'child_6_18_unrestrained'), numeric(a, 'child_8_18_unrestrained'));
        addPopupChips(wrap, 'Recorded factors and users', [
          ['Speeding', numeric(a, 'drv_speeding')], ['Distracted driving', numeric(a, 'drv_distracted')],
          ['Impairment / alcohol', Math.max(numeric(a, 'drv_under_inf'), numeric(a, 'alcohol_related'))],
          ['Unrestrained', unrestrained], ['Driver under 25', numeric(a, 'driver_under_25')],
          ['Driver 65+', numeric(a, 'driver_65')], ['Work zone', numeric(a, 'wz_related')],
          ['Weekend', numeric(a, 'weekend_crashes')], ['Dark but lit', numeric(a, 'dark_lit')],
          ['Citations', numeric(a, 'num_cited_drv')],
        ], 'All-period recorded indicators; categories can overlap and are not percentages.');
        const collisionPatterns = [
          ['Broadside', numeric(a, 'manner_broadside')], ['Rear-end', numeric(a, 'manner_rearend')],
          ['Angle', numeric(a, 'manner_angle')], ['Left turn', numeric(a, 'manner_leftturn')],
          ['Head-on', numeric(a, 'manner_headon')], ['Opposite-direction sideswipe', numeric(a, 'manner_sideswipe_opp')],
          ['Same-direction sideswipe', numeric(a, 'manner_sideswipe_same')],
        ].filter(([, value]) => value > 0).sort((left, right) => right[1] - left[1]).slice(0, 3);
        const patterns = [];
        if (collisionPatterns.length) patterns.push(`Leading recorded collision types: ${collisionPatterns.map(([label, value]) => `${label} (${value.toLocaleString()})`).join(', ')}.`);
        const driverActions = summarizedCounts(a.CBC_drvs_counts);
        if (driverActions) patterns.push(`Driver factors: ${driverActions}.`);
        const vehicleActions = summarizedCounts(a.veh_actions_counts);
        if (vehicleActions) patterns.push(`Vehicle actions: ${vehicleActions}.`);
        const nonmotoristLocations = summarizedCounts(a.nonm_locations_counts);
        if (nonmotoristLocations) patterns.push(`Nonmotorist locations: ${nonmotoristLocations}.`);
        addPopupSection(wrap, 'Common recorded patterns', patterns.join(' '));
        const details = segment
          ? [
            ['Network ID', a.TFL_UID], ['HIN', numeric(a, 'HIN') === 1 ? 'Yes' : 'No'],
            ['Location', [a.city_name, a.county_text].filter(Boolean).join(', ')],
            ['Length', `${numeric(a, 'Segment_Miles').toFixed(2)} mi`], ['Posted speed', fieldText(a.maxspeed)],
            ['Functional class', functionalClassLabel(a.HPMS_F_SYSTEM)], ['Travel lanes', fieldText(a.lanes)],
            ['Surface', fieldText(a.surface)], ['Setting', fieldText(a.URBAN_RURAL)],
            ['One-way', isYes(a.one_way) ? 'Yes' : 'No'],
            ['2025 AADT', numeric(a, 'ADJ_AADT2025') ? Math.round(numeric(a, 'ADJ_AADT2025')).toLocaleString() : 'Not recorded'],
          ]
          : [
            ['Network ID', a.int_ID], ['HIN', numeric(a, 'HIN') === 1 ? 'Yes' : 'No'],
            ['Location', [a.CITY, String(a.COUNTY || '').replace(/ County$/i, '')].filter(Boolean).join(', ')],
            ['Traffic control', fieldText(a.traffic_control_type)],
            ['Intersection type', a.number_of_legs ? `${a.number_of_legs} legs` : 'Not recorded'],
            ['Lighting', fieldText(a.intersection_lighting)], ['Posted speed', fieldText(a.maxspeed)],
            ['Functional class', functionalClassLabel(a.HPMS_F_SYSTEM)], ['Setting', fieldText(a.URBAN_RURAL)],
          ];
        addPopupDetails(wrap, segment ? 'Roadway context' : 'Intersection context', details);
        return wrap;
      },
    }],
  };
}

function configureLayers(layers, filterRef) {
  [layers.safetySegments, layers.safetyIntersections, layers.allSafetySegments, layers.allSafetyIntersections, layers.crashes].forEach((layer) => { layer.popupEnabled = true; });
  layers.safetySegments.renderer = { type: 'simple', symbol: { type: 'simple-line', color: BRAND.blue, width: 2.4 } };
  layers.safetyIntersections.renderer = { type: 'simple', symbol: { type: 'simple-marker', style: 'circle', color: BRAND.yellow, size: 6, outline: { color: BRAND.blue, width: 1.1 } } };
  layers.allSafetySegments.renderer = { type: 'simple', symbol: { type: 'simple-line', style: 'solid', color: BRAND.blue, width: 1, cap: 'round', join: 'round' } };
  layers.allSafetyIntersections.renderer = { type: 'simple', symbol: { type: 'simple-marker', style: 'circle', color: BRAND.blue, size: 4, outline: { color: 'white', width: .4 } } };
  const severityRenderer = {
    type: 'unique-value', field: 'severity', orderByClassesEnabled: true,
    defaultSymbol: { type: 'simple-marker', color: BRAND.grey, size: 5, outline: { color: 'white', width: .5 } },
    uniqueValueInfos: SEVERITIES.map((item) => ({ value: item.value, label: item.label, symbol: { type: 'simple-marker', style: 'circle', color: item.color, size: item.value === 'K' ? 10 : item.value === 'A' ? 8 : 6, outline: { color: 'white', width: .8 } } })),
  };
  layers.crashes.featureReduction = {
    type: 'cluster', clusterRadius: '64px', clusterMinSize: '15px', clusterMaxSize: '40px',
    fields: [{
      name: 'most_severe_rank', alias: 'Most severe crash in cluster', statisticType: 'min',
      onStatisticExpression: { expression: "Decode($feature.severity, 'K', 1, 'A', 2, 'B', 3, 'C', 4, 'O', 5, 6)", title: 'Severity priority' },
    }],
    renderer: {
      type: 'unique-value', field: 'most_severe_rank', orderByClassesEnabled: true,
      defaultSymbol: { type: 'simple-marker', color: BRAND.grey, size: 5, outline: { color: 'white', width: .8 } },
      uniqueValueInfos: SEVERITIES.map((item, index) => ({ value: index + 1, label: item.label, symbol: { type: 'simple-marker', style: 'circle', color: item.color, size: item.value === 'K' ? 10 : item.value === 'A' ? 8 : 6, outline: { color: 'white', width: 1 } } })),
    },
    popupTemplate: { title: 'Crash concentration', content: 'This cluster contains <b>{cluster_count}</b> crash records. Zoom in to inspect individual records by severity.' },
  };
  layers.crashes.renderer = severityRenderer;
  layers.crashes.outFields = CRASH_POPUP_FIELDS;
  layers.crashes.popupTemplate = crashPopupTemplate();
  layers.safetySegments.popupTemplate = popupTemplate('segment', layers.crashes, filterRef);
  layers.safetyIntersections.popupTemplate = popupTemplate('intersection', layers.crashes, filterRef);
  layers.allSafetySegments.popupTemplate = popupTemplate('segment', layers.crashes, filterRef);
  layers.allSafetyIntersections.popupTemplate = popupTemplate('intersection', layers.crashes, filterRef);
}

function MapCanvas({ filters, selection, visible, onReady, onSelect, onStatus }) {
  const node = useRef(null);
  const apiRef = useRef(null);
  const filterRef = useRef(filters);
  const callbacks = useRef({ onReady, onSelect, onStatus });
  useEffect(() => { filterRef.current = filters; }, [filters]);
  useEffect(() => { callbacks.current = { onReady, onSelect, onStatus }; }, [onReady, onSelect, onStatus]);

  useEffect(() => {
    let disposed = false;
    let clickHandle;
    let highlight;
    let view;
    const webmap = new WebMap({ portalItem: { id: WEBMAP_ID } });
    callbacks.current.onStatus('loading');
    webmap.load().then(async () => {
      if (disposed) return;
      const unwanted = webmap.allLayers.filter((layer) => /^HIN - /.test(layer.title || '') || /^NM Severity - Chart$/i.test(layer.title || '') || /High (Priority|Risk) Network|Community Safety Concerns/i.test(layer.title || ''));
      unwanted.forEach((layer) => { if (layer.parent?.remove) layer.parent.remove(layer); else webmap.remove(layer); });
      view = new MapView({ container: node.current, map: webmap, extent: MAP_EXTENT, constraints: { snapToZoom: false }, popup: { dockEnabled: true, dockOptions: { position: 'bottom-right', buttonEnabled: false } }, ui: { components: ['attribution', 'zoom'] } });
      await view.when();
      const layers = {
        safetySegments: findLayer(webmap, LAYER_TITLES.safetySegments), safetyIntersections: findLayer(webmap, LAYER_TITLES.safetyIntersections),
        crashes: findLayer(webmap, LAYER_TITLES.crashes), tmaBoundary: findLayer(webmap, LAYER_TITLES.tmaBoundary),
      };
      const missing = Object.entries(layers).filter(([, layer]) => !layer).map(([name]) => name);
      if (missing.length) throw new Error(`Missing map layers: ${missing.join(', ')}`);
      const prepareOperationalLayer = (layer) => {
        layer.popupEnabled = false;
        if (layer === layers.tmaBoundary) {
          layer.visible = true;
          layer.listMode = 'hide';
          return;
        }
        layer.visible = layer.type === 'group';
        layer.layers?.forEach(prepareOperationalLayer);
      };
      webmap.layers.forEach(prepareOperationalLayer);
      const allSafetySegments = new FeatureLayer({ url: `${layers.safetySegments.url}/${layers.safetySegments.layerId}`, title: 'All Safety Network — Roads', outFields: SEGMENT_OUT_FIELDS, visible: false });
      const allSafetyIntersections = new FeatureLayer({ url: `${layers.safetyIntersections.url}/${layers.safetyIntersections.layerId}`, title: 'All Safety Network — Intersections', outFields: INTERSECTION_OUT_FIELDS, visible: false });
      const counties = new FeatureLayer({ url: SERVICE_URLS.counties, title: 'Selected county boundary', visible: false, outFields: ['*'], renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [131, 200, 187, .12], outline: { color: BRAND.teal, width: 2.5 } } }, popupEnabled: false, listMode: 'hide' });
      const cities = new FeatureLayer({ url: SERVICE_URLS.cities, title: 'Selected city boundary', visible: false, outFields: ['*'], renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [252, 189, 51, .12], outline: { color: BRAND.blue, width: 2.5 } } }, popupEnabled: false, listMode: 'hide' });
      webmap.addMany([allSafetySegments, allSafetyIntersections, counties, cities], 0);
      layers.allSafetySegments = allSafetySegments; layers.allSafetyIntersections = allSafetyIntersections;
      layers.counties = counties; layers.cities = cities;
      configureLayers(layers, filterRef);
      layers.safetySegments.visible = visible.hin; layers.safetyIntersections.visible = visible.hin;
      layers.allSafetySegments.visible = visible.safety; layers.allSafetyIntersections.visible = visible.safety;
      layers.crashes.visible = visible.crashes;
      view.ui.add(new Search({ view, popupEnabled: false, includeDefaultSources: true }), 'top-right');
      view.ui.add(new Home({ view }), 'top-left');
      view.ui.add(new ScaleBar({ view, unit: 'dual' }), 'bottom-left');
      view.ui.add(new Expand({ view, content: new LayerList({ view }), group: 'map-tools', expandTooltip: 'Layers', collapseTooltip: 'Close layers' }), 'top-right');
      view.ui.add(new Expand({ view, content: new BasemapGallery({ view }), group: 'map-tools', expandTooltip: 'Basemaps', collapseTooltip: 'Close basemaps' }), 'top-right');
      view.ui.add(new Expand({ view, content: new Legend({ view }), group: 'map-tools', expandTooltip: 'Legend', collapseTooltip: 'Close legend' }), 'top-right');
      clickHandle = view.on('click', async (event) => {
        const hit = await view.hitTest(event, { include: [layers.safetySegments, layers.safetyIntersections, layers.allSafetySegments, layers.allSafetyIntersections] });
        const result = hit.results.find((item) => item.type === 'graphic');
        if (!result) return;
        const selectedLayer = result.graphic.layer;
        const kind = selectedLayer === layers.safetySegments || selectedLayer === layers.allSafetySegments ? 'segment' : 'intersection';
        const objectId = result.graphic.getObjectId();
        let selectedGraphic = result.graphic;
        if (objectId != null) {
          const fullResult = await selectedLayer.queryFeatures({ objectIds: [objectId], outFields: ['*'], returnGeometry: true });
          if (fullResult.features.length) selectedGraphic = fullResult.features[0];
        }
        highlight?.remove();
        highlight = (await view.whenLayerView(selectedLayer)).highlight(selectedGraphic);
        callbacks.current.onSelect(normalizeNetworkFeature(selectedGraphic, kind));
      });
      const api = {
        view, layers,
        clearSelection: () => { highlight?.remove(); view.closePopup(); },
        focus: async (record) => { highlight?.remove(); const layer = record.type === 'segment' ? layers.safetySegments : layers.safetyIntersections; const result = await layer.queryFeatures({ objectIds: [record.objectId], outFields: ['*'], returnGeometry: true }); if (!result.features.length) return; highlight = (await view.whenLayerView(layer)).highlight(result.features[0]); await view.goTo(result.features[0], { duration: 600 }).catch(() => {}); view.openPopup({ features: result.features, location: result.features[0].geometry.extent?.center || result.features[0].geometry }); },
        zoomLocation: async (value) => {
          const location = parseLocation(value);
          counties.visible = location?.type === 'county'; cities.visible = location?.type === 'city';
          counties.definitionExpression = location?.type === 'county' ? `NAME10 = '${escapeSqlLiteral(location.name)}'` : '1=0';
          cities.definitionExpression = location?.type === 'city' ? `City_Name = '${escapeSqlLiteral(location.name)}'` : '1=0';
          if (!location) { await view.goTo(MAP_EXTENT, { duration: 650 }).catch(() => {}); return; }
          const boundary = location.type === 'county' ? counties : cities;
          const result = await boundary.queryExtent({ where: boundary.definitionExpression });
          if (result.extent) await view.goTo(result.extent.expand(1.12), { duration: 700 }).catch(() => {});
        },
      };
      apiRef.current = api; callbacks.current.onReady(api); callbacks.current.onStatus('ready');
    }).catch((error) => { if (!disposed) callbacks.current.onStatus(error.message || 'The map could not be loaded.'); });
    return () => { disposed = true; clickHandle?.remove(); highlight?.remove(); view?.destroy(); };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.layers.safetySegments.definitionExpression = filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(filters, 'segment');
    api.layers.safetyIntersections.definitionExpression = filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(filters, 'intersection');
    api.layers.allSafetySegments.definitionExpression = filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(filters, 'segment', { hinOnly: false });
    api.layers.allSafetyIntersections.definitionExpression = filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(filters, 'intersection', { hinOnly: false });
    api.layers.crashes.definitionExpression = buildCrashWhere(filters, selection);
  }, [filters, selection]);
  useEffect(() => { const api = apiRef.current; if (api) { api.layers.safetySegments.visible = visible.hin; api.layers.safetyIntersections.visible = visible.hin; api.layers.allSafetySegments.visible = visible.safety; api.layers.allSafetyIntersections.visible = visible.safety; api.layers.crashes.visible = visible.crashes; } }, [visible]);
  useEffect(() => { apiRef.current?.zoomLocation(filters.location); }, [filters.location]);
  return <div ref={node} className="map-canvas" aria-label="Interactive MAPA High Injury Network map" />;
}

function Toggle({ checked, onChange, label, description, icon: Icon, color }) {
  return <button type="button" className={`toggle-row ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
    <span className="toggle-icon" style={{ '--toggle-color': color }}><Icon size={18} /></span>
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span><i className="switch"><b /></i>
  </button>;
}

function CheckToggle({ checked, onChange, label }) {
  return <button type="button" className={`check-toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}><span>{label}</span><i><b /></i></button>;
}

function MultiSelect({ label, values, options, onChange, disabled, note }) {
  const toggle = (value) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  return <details className={`multi-select ${disabled ? 'disabled' : ''}`}>
    <summary><span>{label}</span><strong>{disabled ? 'Unavailable' : `${values.length} selected`}</strong><ChevronDown size={16} /></summary>
    {!disabled && <div>{options.map((option) => { const value = typeof option === 'object' ? option.value : option; const text = typeof option === 'object' ? option.label : option; return <label key={value}><input type="checkbox" checked={values.includes(value)} onChange={() => toggle(value)} />{text}</label>; })}</div>}
    {disabled && <p>{note}</p>}
  </details>;
}

function ExplorePanel({ filters, setFilters, visible, setVisible, selection, clearSelection, yearMax }) {
  const patch = (next) => setFilters((current) => ({ ...current, ...next }));
  const toggleSeverity = (value) => patch({ severities: filters.severities.includes(value) ? filters.severities.filter((item) => item !== value) : [...filters.severities, value] });
  return <>
    <section className="panel-section"><h2>Map layers</h2>
      <Toggle checked={visible.hin} onChange={(hin) => setVisible((v) => ({ ...v, hin }))} label="High Injury Network" description="HIN roads and intersections" icon={Route} color={BRAND.blue} />
      <Toggle checked={visible.safety} onChange={(safety) => setVisible((v) => ({ ...v, safety }))} label="All Safety Network" description="Every road and intersection in the analysis network" icon={ShieldCheck} color={BRAND.teal} />
      <Toggle checked={visible.crashes} onChange={(crashes) => setVisible((v) => ({ ...v, crashes }))} label="Crash records" description="Grouped at regional scale; severity records appear as you zoom in" icon={Car} color={BRAND.coral} />
    </section>
    <section className="panel-section"><h2>Location</h2><label className="field"><span>Select county or city</span><select value={filters.location} onChange={(event) => patch({ location: event.target.value })}><option value="">Entire MAPA region</option><optgroup label="Counties">{LOCATIONS.counties.map((name) => <option key={name} value={`county|${name}`}>{name} County</option>)}</optgroup><optgroup label="Cities">{LOCATIONS.cities.map((name) => <option key={name} value={`city|${name}`}>{name}</option>)}</optgroup></select><ChevronDown size={17} /></label></section>
    <section className="panel-section assignment-section"><h2>Network assignment</h2><label className="field"><span>Show network and crashes assigned to</span><select value={filters.assignment} onChange={(event) => patch({ assignment: event.target.value })}><option>All</option><option>Segment</option><option>Junction</option></select><ChevronDown size={17} /></label></section>
    {selection && <section className="focus-card"><button onClick={clearSelection} aria-label="Clear selected network feature"><X size={18} /></button><span>Selected {selection.type}</span><h3>{selection.name}</h3><p>{[selection.city, selection.county].filter(Boolean).join(' · ')}</p><div><b>{formatNumber(selection.crashes)}</b><small>all-period crashes</small><b>{formatNumber(selection.kaCrashes)}</b><small>fatal + serious crashes</small></div></section>}
    <section className="panel-section"><h2>Crash records</h2>
      <div className="mode-control">{[['All modes', Car], ['Pedestrian', Footprints], ['Bicycle', Bike]].map(([mode, Icon]) => <button type="button" key={mode} className={filters.mode === mode ? 'active' : ''} onClick={() => patch({ mode })}><Icon size={17} />{mode}</button>)}</div>
      <div className="period-row"><label><span>From</span><select value={filters.startYear} onChange={(e) => patch({ startYear: Math.min(Number(e.target.value), filters.endYear) })}>{Array.from({ length: yearMax - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i).map((year) => <option key={year}>{year}</option>)}</select></label><span>—</span><label><span>Through</span><select value={filters.endYear} onChange={(e) => patch({ endYear: Math.max(Number(e.target.value), filters.startYear) })}>{Array.from({ length: yearMax - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i).map((year) => <option key={year}>{year}</option>)}</select></label></div>
      <div className="severity-list">{SEVERITIES.map((item) => <button type="button" key={item.value} className={filters.severities.includes(item.value) ? 'active' : ''} onClick={() => toggleSeverity(item.value)} style={{ '--severity': item.color }}><i />{item.label}<span>{item.short}</span></button>)}</div>
    </section>
  </>;
}

function FiltersPanel({ filters, setFilters }) {
  const setPeople = (key, value) => setFilters((current) => ({ ...current, people: { ...current.people, [key]: value } }));
  const setRoad = (key, value) => setFilters((current) => ({ ...current, roads: { ...current.roads, [key]: value } }));
  return <>
    <section className="panel-section filter-intro"><h2>Safer People</h2><p>Display HIN roads, intersections, and matching crash records where specific crashes occurred. Active choices are combined with <strong>AND</strong>.</p>
      <h3>Roads and intersections with:</h3>
      <CheckToggle label="Alcohol / drug-impaired crashes" checked={filters.people.impaired} onChange={(v) => setPeople('impaired', v)} />
      <CheckToggle label="Unrestrained occupant crashes" checked={filters.people.unrestrained} onChange={(v) => setPeople('unrestrained', v)} />
      <CheckToggle label="Speeding crashes" checked={filters.people.speeding} onChange={(v) => setPeople('speeding', v)} />
      <CheckToggle label="Distracted-driving crashes" checked={filters.people.distracted} onChange={(v) => setPeople('distracted', v)} />
      <CheckToggle label="Crashes involving a driver under 25" checked={filters.people.youngDriver} onChange={(v) => setPeople('youngDriver', v)} />
    </section>
    <section className="panel-section filter-intro"><h2>Safer Roads</h2><p>Refine the HIN by roadway and intersection characteristics. These choices are also combined with <strong>AND</strong>.</p>
      <div className="multi-grid">
        <MultiSelect label="Posted speed" values={filters.roads.speeds} options={SPEED_OPTIONS.map((value) => ({ value, label: `${value} mph` }))} onChange={(v) => setRoad('speeds', v)} />
        <MultiSelect label="Functional classification" values={filters.roads.classes} options={FUNCTIONAL_CLASSES} onChange={(v) => setRoad('classes', v)} />
        <MultiSelect label="Intersection type" values={filters.roads.intersectionTypes} options={INTERSECTION_TYPES.map((value) => ({ value, label: `${value} legs` }))} onChange={(v) => setRoad('intersectionTypes', v)} />
        <MultiSelect label="Traffic control" values={filters.roads.controls} options={CONTROL_OPTIONS} onChange={(v) => setRoad('controls', v)} />
      </div>
    </section>
  </>;
}

function CrashAnalytics({ performance, period }) {
  const years = {};
  for (const source of [performance.roads.years || {}, performance.intersections.years || {}]) for (const [year, value] of Object.entries(source)) years[year] = (years[year] || 0) + value;
  const yearRows = Object.entries(years).map(([year, value]) => ({ year: Number(year), value })).sort((a, b) => a.year - b.year);
  const maxYear = Math.max(1, ...yearRows.map((row) => row.value));
  const severityRows = SEVERITIES.map((item) => ({ ...item, value: Number(performance.roads.severity?.[item.value] || 0) + Number(performance.intersections.severity?.[item.value] || 0) }));
  const maxSeverity = Math.max(1, ...severityRows.map((row) => row.value));
  const outcomeRows = [
    { label: 'People killed', value: Number(performance.roads.fatal || 0) + Number(performance.intersections.fatal || 0), color: BRAND.dark },
    { label: 'People seriously injured', value: Number(performance.roads.serious || 0) + Number(performance.intersections.serious || 0), color: BRAND.coral },
  ];
  const maxOutcome = Math.max(1, ...outcomeRows.map((row) => row.value));
  const factorRows = [
    ['Speeding', 'speeding'], ['Distracted driving', 'distracted'], ['Impairment / alcohol', 'impaired'],
    ['Unrestrained occupants', 'unrestrained'], ['Young drivers (under 25)', 'youngDrivers'],
    ['Older drivers (65+)', 'olderDrivers'], ['Nonmotorists', 'nonmotorists'], ['Work-zone related', 'workZones'],
  ].map(([label, field]) => ({ label, value: Number(performance.roads[field] || 0) + Number(performance.intersections[field] || 0) }));
  const maxFactor = Math.max(1, ...factorRows.map((row) => row.value));
  return <section className="analytics-section"><div className="section-heading"><div><span>HIN-linked crash records</span><h2>Patterns in the displayed network</h2></div><small>{period}</small></div>
    <article className="chart-card"><h3>Annual crash trend</h3><div className="year-chart">{yearRows.map((row) => <div key={row.year}><span title={`${formatNumber(row.value)} crashes`} style={{ height: `${Math.max(4, row.value / maxYear * 100)}%` }} /><b>{formatNumber(row.value)}</b><small>{row.year}</small></div>)}</div></article>
    <article className="chart-card"><h3>Crash records by highest severity</h3><div className="analysis-bars">{severityRows.map((row) => <div key={row.value + row.label}><span><i style={{ background: row.color }} />{row.label} crash</span><b>{formatNumber(row.value)}</b><em><i style={{ width: `${row.value / maxSeverity * 100}%`, background: row.color }} /></em></div>)}</div><p>This chart counts crash records. One crash can involve more than one injured person.</p></article>
    <article className="chart-card"><h3>Injury outcomes — people</h3><div className="analysis-bars">{outcomeRows.map((row) => <div key={row.label}><span><i style={{ background: row.color }} />{row.label}</span><b>{formatNumber(row.value)}</b><em><i style={{ width: `${row.value / maxOutcome * 100}%`, background: row.color }} /></em></div>)}</div></article>
    <article className="chart-card"><h3>Contributing factors and users</h3><div className="analysis-bars factor-bars">{factorRows.map((row) => <div key={row.label}><span>{row.label}</span><b>{formatNumber(row.value)}</b><em><i style={{ width: `${row.value / maxFactor * 100}%` }} /></em></div>)}</div><p>Factor totals count recorded indicators and may overlap because one crash can involve more than one factor.</p></article>
  </section>;
}

function PerformancePanel({ performance, loading, corridors, onFocusCorridor, period }) {
  const roadFsi = performance.roads.fatal + performance.roads.serious;
  const intersectionFsi = performance.intersections.fatal + performance.intersections.serious;
  const baseRoadFsi = performance.baseRoads.fatal + performance.baseRoads.serious;
  const baseIntersectionFsi = performance.baseIntersections.fatal + performance.baseIntersections.serious;
  const totalCrashes = performance.roads.crashes + performance.intersections.crashes;
  const areaCrashes = performance.baseRoads.crashes + performance.baseIntersections.crashes;
  const totalFatal = performance.roads.fatal + performance.intersections.fatal;
  const totalSerious = performance.roads.serious + performance.intersections.serious;
  const roadCoverage = percent(performance.roads.miles, performance.baseRoads.miles);
  const intCoverage = percent(performance.intersections.count, performance.baseIntersections.count);
  const roadCapture = percent(roadFsi, baseRoadFsi);
  const intCapture = percent(intersectionFsi, baseIntersectionFsi);
  const roadRatio = rateRatio(roadFsi, performance.roads.miles, baseRoadFsi, performance.baseRoads.miles);
  const intRatio = rateRatio(intersectionFsi, performance.intersections.count, baseIntersectionFsi, performance.baseIntersections.count);
  return <>
    <section className="performance">
      <div className="performance-title"><span>Network performance</span><h2>What are the statistics of the network?</h2><p>Statistics cover <b>{period}</b> for the displayed HIN in blue and update with the active location and network filters.</p></div>
      {loading ? <div className="loading-block">Updating network statistics…</div> : <>
        <div className="performance-total"><span>Crashes on the displayed HIN</span><strong>{formatNumber(totalCrashes)}</strong><small>{formatNumber(areaCrashes)} crashes occurred in the entire selected area</small><div><p><b>{percent(performance.roads.crashes, totalCrashes)}%</b>occurred on HIN roadways</p><p><b>{percent(performance.intersections.crashes, totalCrashes)}%</b>occurred at HIN intersections</p></div></div>
        <div className="performance-total"><span>People killed or seriously injured</span><strong>{formatNumber(totalFatal + totalSerious)}</strong><small>People killed: <b>{formatNumber(totalFatal)}</b> · People seriously injured: <b>{formatNumber(totalSerious)}</b></small><div><p><b>{percent(roadFsi, totalFatal + totalSerious)}%</b>on roadways</p><p><b>{percent(intersectionFsi, totalFatal + totalSerious)}%</b>at intersections</p></div></div>
        <div className="network-profile"><h3>Network pulse</h3><div><span><b>{formatNumber(performance.roads.miles, 1)}</b>HIN roadway miles</span><span><b>{formatNumber(performance.intersections.count)}</b>HIN intersections</span><span><b>{formatNumber((performance.roads.nonmotorists || 0) + (performance.intersections.nonmotorists || 0))}</b>nonmotorists recorded</span><span><b>{formatNumber((performance.roads.vehicles || 0) + (performance.intersections.vehicles || 0))}</b>vehicles involved</span></div></div>
        <div className="comparison"><h3>How does it compare to the entire network?</h3><p>Comparison uses the same location, crash period, severity, travel mode, and Safer People filters.</p>
          <div className="comparison-grid"><article><h4>Roadways</h4><p>The displayed roadways have on average <strong>{roadRatio == null ? '—' : `${formatNumber(roadRatio, 1)}×`}</strong> more fatal and serious injuries than other roadways.</p><div className="coverage"><span><b>{roadCoverage}%</b>of all roadway miles</span><i /><span><b>{roadCapture}%</b>of roadway fatalities and serious injuries</span></div></article>
          <article><h4>Intersections</h4><p>The displayed intersections have on average <strong>{intRatio == null ? '—' : `${formatNumber(intRatio, 1)}×`}</strong> more fatal and serious injuries than other intersections.</p><div className="coverage"><span><b>{intCoverage}%</b>of all intersections</span><i /><span><b>{intCapture}%</b>of intersection fatalities and serious injuries</span></div></article></div>
        </div>
      </>}
    </section>
    {!loading && <CrashAnalytics performance={performance} period={period} />}
    <section className="corridors"><div className="section-heading"><div><span>HIN corridors</span><h2>Highest-impact roads</h2></div><small>Trend: 2021–2025 vs. 2018–2022</small></div><div className="corridor-list">{corridors.slice(0, 12).map((corridor, index) => <button key={corridor.key} onClick={() => onFocusCorridor(corridor)}><b>{index + 1}</b><span><strong>{corridor.name}</strong><small>{corridor.city || 'Regional corridor'}</small><em>{formatNumber(corridor.fsi)} fatal / serious injuries · <i className={`trend-${corridor.trend.toLowerCase().replaceAll(' ', '-')}`}>{corridor.trend}</i></em></span></button>)}{!corridors.length && <p className="empty">No corridors match the current filters.</p>}</div></section>
  </>;
}

function DataDrawer({ open, setOpen, tab, setTab, rows, loading, onFocus, onExport }) {
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState('');
  const visibleRows = rows.filter((row) => `${row.name} ${row.city} ${row.county} ${row.id}`.toLowerCase().includes(search.toLowerCase())).slice(0, 1000);
  const doExport = async (format) => { setExporting(format); try { await onExport(format); } finally { setExporting(''); } };
  return <section className={`data-drawer ${open ? 'open' : ''}`}><button className="drawer-handle" onClick={() => setOpen(!open)} aria-expanded={open}><span /><Table2 size={18} /><b>HIN network table</b><small>{formatNumber(rows.length)} filtered {tab === 'segment' ? 'roads' : 'intersections'}</small><ChevronDown size={19} /></button>{open && <div className="drawer-body"><div className="drawer-tools"><div className="table-tabs"><button className={tab === 'segment' ? 'active' : ''} onClick={() => setTab('segment')}>Roads</button><button className={tab === 'intersection' ? 'active' : ''} onClick={() => setTab('intersection')}>Intersections</button></div><label className="table-search"><SearchIcon size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the filtered network" /></label><div className="export-menu"><span>Export:</span>{[['csv', 'CSV'], ['shp', 'Shapefile'], ['gpkg', 'GeoPackage']].map(([value, label]) => <button key={value} disabled={Boolean(exporting) || !rows.length} onClick={() => doExport(value)}><Download size={15} />{exporting === value ? 'Preparing…' : label}</button>)}</div></div>{loading ? <div className="table-state">Updating the filtered network…</div> : <div className="table-wrap"><table><thead><tr><th>#</th><th>{tab === 'segment' ? 'Road' : 'Intersection'}</th><th>Location</th><th>K+A crashes</th><th>All crashes</th><th>{tab === 'segment' ? 'Miles' : 'Control'}</th><th /></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={`${row.type}-${row.objectId}`}><td>{index + 1}</td><td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.city || '—'}<small>{row.county || '—'}</small></td><td>{formatNumber(row.kaCrashes)}</td><td>{formatNumber(row.crashes)}</td><td>{tab === 'segment' ? formatNumber(row.miles, 2) : row.control || '—'}</td><td><button onClick={() => onFocus(row)}>Show</button></td></tr>)}</tbody></table>{rows.length > 1000 && <p className="row-limit">Showing the first 1,000 rows. Exports include up to 2,000 filtered features.</p>}</div>}</div>}</section>;
}

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [visible, setVisible] = useState({ hin: true, safety: false, crashes: false });
  const [yearMax, setYearMax] = useState(YEAR_MAX);
  const [leftTab, setLeftTab] = useState('explore');
  const [mobilePanel, setMobilePanel] = useState('map');
  const [mapApi, setMapApi] = useState(null);
  const [mapStatus, setMapStatus] = useState('loading');
  const [analyticsError, setAnalyticsError] = useState('');
  const [showStatus, setShowStatus] = useState(false);
  const [selection, setSelection] = useState(null);
  const [performance, setPerformance] = useState(EMPTY_PERFORMANCE);
  const [networkRows, setNetworkRows] = useState({ segment: [], intersection: [] });
  const [linkedYears, setLinkedYears] = useState(new Map());
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('segment');

  const reset = () => { setFilters(DEFAULT_FILTERS); setSelection(null); mapApi?.clearSelection(); };
  const clearSelection = () => { setSelection(null); mapApi?.clearSelection(); };

  useEffect(() => {
    if (!mapApi) return;
    mapApi.layers.crashes.queryFeatures({ outStatistics: [statistic('max', 'Year', 'maxYear')], returnGeometry: false, where: '1=1' })
      .then((result) => {
        const max = Number(attributesOf(result).maxYear || YEAR_MAX);
        setYearMax(max);
        setFilters((current) => current.endYear === YEAR_MAX ? { ...current, endYear: max } : current);
      }).catch(() => {});
  }, [mapApi]);

  useEffect(() => {
    if (!mapApi) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setAnalyticsLoading(true);
      setAnalyticsError('');
      try {
        const segmentWhere = filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(filters, 'segment');
        const intersectionWhere = filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(filters, 'intersection');
        const baseFilters = { ...DEFAULT_FILTERS, location: filters.location };
        const relationshipFilters = { ...filters, startYear: YEAR_MIN, endYear: yearMax };
        const currentCrashWhere = buildCrashWhere(filters);
        const relationshipCrashWhere = buildCrashWhere(relationshipFilters);
        const [segments, intersections, baseRoadUnits, baseIntersectionUnits, baseRoadCrashes, baseIntersectionCrashes] = await Promise.all([
          queryNetworkRows(mapApi.layers.safetySegments, segmentWhere, 'segment'),
          queryNetworkRows(mapApi.layers.safetyIntersections, intersectionWhere, 'intersection'),
          querySafetyBase(mapApi.layers.safetySegments, buildNetworkWhere(baseFilters, 'segment', { hinOnly: false }), 'segment'),
          querySafetyBase(mapApi.layers.safetyIntersections, buildNetworkWhere(baseFilters, 'intersection', { hinOnly: false }), 'intersection'),
          queryCrashBase(mapApi.layers.crashes, currentCrashWhere, 'Segment'),
          queryCrashBase(mapApi.layers.crashes, currentCrashWhere, 'Junction'),
        ]);
        const [segmentYears, intersectionYears] = await Promise.all([
          queryLinkedByYear(mapApi.layers.crashes, segments.map((row) => row.id), 'assigned_segment_id', relationshipCrashWhere),
          queryLinkedByYear(mapApi.layers.crashes, intersections.map((row) => row.id), 'assigned_junction_id', relationshipCrashWhere),
        ]);
        if (cancelled) return;
        const roadAggregate = aggregateNetworkRows(segments);
        const intersectionAggregate = aggregateNetworkRows(intersections);
        const linkedRoad = periodTotal(segmentYears, segments.map((row) => row.id), filters.startYear, filters.endYear);
        const linkedIntersection = periodTotal(intersectionYears, intersections.map((row) => row.id), filters.startYear, filters.endYear);
        const roadCrash = { ...roadAggregate, ...linkedRoad };
        const intCrash = { ...intersectionAggregate, ...linkedIntersection };
        setNetworkRows({ segment: segments, intersection: intersections });
        setLinkedYears(segmentYears);
        setPerformance({
          roads: roadCrash,
          intersections: intCrash,
          baseRoads: { ...baseRoadUnits, ...baseRoadCrashes },
          baseIntersections: { ...baseIntersectionUnits, ...baseIntersectionCrashes },
        });
      } catch (error) {
        if (!cancelled) setAnalyticsError(error.message || 'Network analytics could not be updated.');
      } finally { if (!cancelled) setAnalyticsLoading(false); }
    }, 320);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters, mapApi, yearMax]);

  const corridors = useMemo(() => {
    const grouped = new Map();
    for (const row of networkRows.segment) {
      const key = `${row.name.trim().toUpperCase()}|${row.city || ''}`;
      if (!grouped.has(key)) grouped.set(key, { key, name: row.name, city: row.city, ids: [], crashes: 0, fsi: 0, years: new Map() });
      const corridor = grouped.get(key); corridor.ids.push(row.id); corridor.crashes += row.crashes; corridor.fsi += row.fatalities + row.serious;
      for (const point of linkedYears.get(String(row.id)) || []) corridor.years.set(point.year, (corridor.years.get(point.year) || 0) + point.fatal + point.serious);
    }
    return [...grouped.values()].map((item) => ({ ...item, trend: classifyTrend([...item.years].map(([year, count]) => ({ year, count }))) })).sort((a, b) => b.fsi - a.fsi);
  }, [networkRows.segment, linkedYears]);

  const focusCorridor = async (corridor) => {
    const matching = networkRows.segment.filter((row) => corridor.ids.includes(row.id));
    if (matching[0]) await mapApi?.focus(matching[0]);
    setSelection({ type: 'corridor', id: corridor.key, ids: corridor.ids, name: corridor.name, city: corridor.city, county: '', crashes: corridor.crashes, kaCrashes: corridor.fsi });
    setMobilePanel('map');
  };

  const exportRows = async (format) => {
    const kind = drawerTab;
    const layer = kind === 'segment' ? mapApi.layers.safetySegments : mapApi.layers.safetyIntersections;
    const where = kind === 'segment' ? (filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(filters, 'segment')) : (filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(filters, 'intersection'));
    const rows = await queryNetworkRows(layer, where, kind, true);
    await exportNetwork(format, rows.slice(0, 2000), kind);
  };

  const drawerRows = networkRows[drawerTab];
  const hasNotice = mapStatus !== 'ready' || Boolean(analyticsError);
  const statusMessage = mapStatus === 'loading' ? 'The web map and ArcGIS layers are still loading.' : analyticsError || (mapStatus === 'ready' ? 'The map and network analytics are connected to the near-live NDOT and Iowa DOT database.' : String(mapStatus));
  return <main className={`app mobile-${mobilePanel}`}>
    <header className="topbar"><img src="./mapa-logo.png" alt="Metropolitan Area Planning Agency" /><div className="product-name"><span>Safety planning</span><h1>High Injury Network</h1></div><div className="top-actions"><div className="status-wrap"><button className={`status-button ${hasNotice ? 'notice' : ''}`} onClick={() => setShowStatus(!showStatus)} aria-expanded={showStatus}><CircleAlert size={16} />{mapStatus === 'loading' ? 'Loading data' : hasNotice ? 'Data notice' : 'Data is current'}</button>{showStatus && <div className="status-popover"><strong>{hasNotice ? 'Data notice' : 'Data is current'}</strong><p>{statusMessage}</p><small>This control reports connection or query issues; it does not change the map.</small></div>}</div><button onClick={reset}><RefreshCcw size={17} />Reset filters</button><button className="mobile-menu" onClick={() => setMobilePanel(mobilePanel === 'filters' ? 'map' : 'filters')}><Menu size={22} /></button></div></header>
    <div className="workspace">
      <aside className="left-panel"><nav><button className={leftTab === 'explore' ? 'active' : ''} onClick={() => setLeftTab('explore')}><Layers3 size={18} />Explore</button><button className={leftTab === 'filters' ? 'active' : ''} onClick={() => setLeftTab('filters')}><Filter size={18} />Filters</button></nav><div className="panel-scroll">{leftTab === 'explore' ? <ExplorePanel filters={filters} setFilters={setFilters} visible={visible} setVisible={setVisible} selection={selection} clearSelection={clearSelection} yearMax={yearMax} /> : <FiltersPanel filters={filters} setFilters={setFilters} />}</div></aside>
      <section className="map-panel"><MapCanvas filters={filters} selection={selection} visible={visible} onReady={setMapApi} onSelect={(record) => { setSelection(record); if (window.innerWidth < 840) setMobilePanel('insights'); }} onStatus={setMapStatus} /><div className="map-key"><span><i className="line" />HIN roadway</span><span><i className="intersection" />HIN intersection</span><span><i className="safety" />Safety network</span><span><i className="crash" />Crash clusters / severity</span></div><DataDrawer open={drawerOpen} setOpen={setDrawerOpen} tab={drawerTab} setTab={setDrawerTab} rows={drawerRows} loading={analyticsLoading} onFocus={(row) => { mapApi?.focus(row); setSelection(row); }} onExport={exportRows} /></section>
      <aside className="insights-panel"><div className="insights-scroll"><PerformancePanel performance={performance} loading={analyticsLoading} corridors={corridors} onFocusCorridor={focusCorridor} period={`${filters.startYear}–${filters.endYear}`} /></div></aside>
    </div>
    <nav className="mobile-nav"><button className={mobilePanel === 'map' ? 'active' : ''} onClick={() => setMobilePanel('map')}><MapIcon size={21} />Map</button><button className={mobilePanel === 'filters' ? 'active' : ''} onClick={() => setMobilePanel('filters')}><SlidersHorizontal size={21} />Explore</button><button className={mobilePanel === 'insights' ? 'active' : ''} onClick={() => setMobilePanel('insights')}><BarChart3 size={21} />Insights</button><button className={drawerOpen ? 'active' : ''} onClick={() => { setDrawerOpen(true); setMobilePanel('map'); }}><Table2 size={21} />Data</button></nav>
  </main>;
}
