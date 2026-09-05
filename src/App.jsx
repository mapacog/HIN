import { useEffect, useMemo, useRef, useState } from 'react';
import WebMap from '@arcgis/core/WebMap.js';
import MapView from '@arcgis/core/views/MapView.js';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Expand from '@arcgis/core/widgets/Expand.js';
import Home from '@arcgis/core/widgets/Home.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import Search from '@arcgis/core/widgets/Search.js';
import ScaleBar from '@arcgis/core/widgets/ScaleBar.js';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel.js';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils.js';
import QRCode from 'qrcode';
import {
  BarChart3, Bike, Car, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Code2, Copy, Download, Filter, Footprints,
  Layers3, LocateFixed, Mail, Map as MapIcon, Menu, QrCode, RefreshCcw, Route, Search as SearchIcon,
  Share2, ShieldCheck, SlidersHorizontal, Table2, X,
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

function initialSharedState() {
  const base = {
    filters: {
      ...DEFAULT_FILTERS,
      people: { ...DEFAULT_FILTERS.people },
      roads: { ...DEFAULT_FILTERS.roads },
    },
    visible: { hin: true, safety: false, crashes: false },
  };
  if (typeof window === 'undefined') return base;
  const params = new URLSearchParams(window.location.search);
  if (params.get('shared') !== '1') return base;
  const startYear = Number(params.get('from'));
  const endYear = Number(params.get('through'));
  const location = params.get('location') || '';
  const validLocations = new Set([
    ...LOCATIONS.counties.map((name) => `county|${name}`),
    ...LOCATIONS.cities.map((name) => `city|${name}`),
  ]);
  const severityParams = params.getAll('severity');
  const severities = severityParams.filter((value) => SEVERITIES.some((item) => item.value === value));
  const people = new Set(params.getAll('people'));
  const speeds = params.getAll('speed').filter((value) => SPEED_OPTIONS.includes(value));
  const classes = params.getAll('class').map(Number).filter((value) => FUNCTIONAL_CLASSES.some((item) => item.value === value));
  const intersectionTypes = params.getAll('intersectionType').filter((value) => INTERSECTION_TYPES.includes(value));
  const controls = params.getAll('control').filter((value) => CONTROL_OPTIONS.includes(value));
  const assignment = ['All', 'Segment', 'Junction'].includes(params.get('assignment')) ? params.get('assignment') : base.filters.assignment;
  const mode = ['All modes', 'Pedestrian', 'Bicycle'].includes(params.get('mode')) ? params.get('mode') : base.filters.mode;
  const layers = new Set(params.getAll('layer'));
  const sharedStart = Number.isInteger(startYear) && startYear >= 1900 && startYear <= 2100 ? startYear : base.filters.startYear;
  const sharedEnd = Number.isInteger(endYear) && endYear >= 1900 && endYear <= 2100 ? endYear : base.filters.endYear;
  return {
    filters: {
      ...base.filters,
      startYear: Math.min(sharedStart, sharedEnd),
      endYear: Math.max(sharedStart, sharedEnd),
      severities: severityParams.includes('none') ? [] : severities.length ? severities : base.filters.severities,
      location: validLocations.has(location) ? location : '',
      assignment,
      mode,
      people: {
        impaired: people.has('impaired'), unrestrained: people.has('unrestrained'),
        speeding: people.has('speeding'), distracted: people.has('distracted'), youngDriver: people.has('youngDriver'),
      },
      roads: { speeds, classes, intersectionTypes, controls },
    },
    visible: {
      hin: layers.has('hin'), safety: layers.has('safety'), crashes: layers.has('crashes'),
    },
  };
}

function buildShareUrl(filters, visible, includeParameters) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  if (!includeParameters) return url.toString();
  const params = url.searchParams;
  params.set('shared', '1');
  params.set('from', String(filters.startYear));
  params.set('through', String(filters.endYear));
  if (filters.location) params.set('location', filters.location);
  if (filters.assignment !== 'All') params.set('assignment', filters.assignment);
  if (filters.mode !== 'All modes') params.set('mode', filters.mode);
  if (filters.severities.length) filters.severities.forEach((value) => params.append('severity', value));
  else params.append('severity', 'none');
  Object.entries(filters.people).forEach(([key, enabled]) => { if (enabled) params.append('people', key); });
  filters.roads.speeds.forEach((value) => params.append('speed', value));
  filters.roads.classes.forEach((value) => params.append('class', String(value)));
  filters.roads.intersectionTypes.forEach((value) => params.append('intersectionType', value));
  filters.roads.controls.forEach((value) => params.append('control', value));
  if (visible.hin) params.append('layer', 'hin');
  if (visible.safety) params.append('layer', 'safety');
  if (visible.crashes) params.append('layer', 'crashes');
  if (!visible.hin && !visible.safety && !visible.crashes) params.append('layer', 'none');
  return url.toString();
}

async function copyShareText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

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
        statistic('sum', 'nonmotorist_counted', 'nonmotorists'), statistic('sum', 'num_bike', 'bicycles'),
        statistic('sum', 'num_veh', 'vehicles'), statistic('sum', 'num_occ', 'occupants'),
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
      nonmotorists: Number(a.nonmotorists || 0), bicycles: Number(a.bicycles || 0),
      vehicles: Number(a.vehicles || 0), occupants: Number(a.occupants || 0),
      speeding: Number(a.speeding || 0), distracted: Number(a.distracted || 0),
      impaired: Number(a.underInfluence || 0) + Number(a.alcohol || 0), unrestrained: Number(a.unrestrained || 0),
      youngDrivers: Number(a.youngDrivers || 0), olderDrivers: Number(a.olderDrivers || 0), workZones: Number(a.workZones || 0),
    });
  }
  return totals;
}

async function queryCrashesByYear(layer, where, assignment) {
  const result = await layer.queryFeatures({
    where: `${where} AND network_assignment = '${assignment}'`,
    groupByFieldsForStatistics: ['Year', 'severity'],
    orderByFields: ['Year', 'severity'],
    outStatistics: [
      statistic('count', 'OBJECTID', 'crashes'),
      statistic('sum', 'num_K_occ', 'fatalOcc'), statistic('sum', 'num_K_nonm', 'fatalNonm'),
      statistic('sum', 'num_A_occ', 'seriousOcc'), statistic('sum', 'num_A_nonm', 'seriousNonm'),
      statistic('sum', 'nonmotorist_counted', 'nonmotorists'), statistic('sum', 'num_bike', 'bicycles'),
      statistic('sum', 'num_veh', 'vehicles'), statistic('sum', 'num_occ', 'occupants'),
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
  return new Map([[assignment, result.features.map((feature) => {
    const a = feature.attributes;
    return {
      year: Number(a.Year), severity: a.severity, crashes: Number(a.crashes || 0),
      fatal: Number(a.fatalOcc || 0) + Number(a.fatalNonm || 0),
      serious: Number(a.seriousOcc || 0) + Number(a.seriousNonm || 0),
      nonmotorists: Number(a.nonmotorists || 0), bicycles: Number(a.bicycles || 0),
      vehicles: Number(a.vehicles || 0), occupants: Number(a.occupants || 0),
      speeding: Number(a.speeding || 0), distracted: Number(a.distracted || 0),
      impaired: Number(a.underInfluence || 0) + Number(a.alcohol || 0),
      unrestrained: Number(a.unrestrained || 0), youngDrivers: Number(a.youngDrivers || 0),
      olderDrivers: Number(a.olderDrivers || 0), workZones: Number(a.workZones || 0),
    };
  })]]);
}

function periodTotal(map, ids, startYear, endYear) {
  const total = { crashes: 0, fatal: 0, serious: 0, nonmotorists: 0, bicycles: 0, vehicles: 0, occupants: 0, speeding: 0, distracted: 0, impaired: 0, unrestrained: 0, youngDrivers: 0, olderDrivers: 0, workZones: 0, years: {}, severity: {} };
  for (const id of ids) {
    for (const row of map.get(String(id)) || []) {
      if (row.year >= startYear && row.year <= endYear) {
        total.crashes += row.crashes; total.fatal += row.fatal; total.serious += row.serious;
        total.nonmotorists += row.nonmotorists || 0; total.bicycles += row.bicycles || 0;
        total.vehicles += row.vehicles || 0; total.occupants += row.occupants || 0;
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

function periodNetworkRows(rows, linkedYears, startYear, endYear, qualifyingYears = null) {
  return rows.map((row) => {
    const period = periodTotal(linkedYears, [row.id], startYear, endYear);
    if (!period.crashes) return null;
    if (qualifyingYears) {
      const qualification = periodTotal(qualifyingYears, [row.id], startYear, endYear);
      const qualifyingCrashes = Number(qualification.severity.K || 0) + Number(qualification.severity.A || 0);
      if (!qualifyingCrashes) return null;
    }
    return {
      ...row,
      crashes: period.crashes,
      kaCrashes: Number(period.severity.K || 0) + Number(period.severity.A || 0),
      fatalities: period.fatal,
      serious: period.serious,
      nonmotorists: period.nonmotorists,
      bicycles: period.bicycles,
      vehicles: period.vehicles,
      occupants: period.occupants,
      speeding: period.speeding,
      distracted: period.distracted,
      impaired: period.impaired,
      unrestrained: period.unrestrained,
      youngDrivers: period.youngDrivers,
      olderDrivers: period.olderDrivers,
      workZones: period.workZones,
    };
  }).filter(Boolean);
}

const LINKED_ID_STATISTICS = [
  statistic('count', 'OBJECTID', 'crashes'),
  statistic('sum', "CASE WHEN severity IN ('K','A') THEN 1 ELSE 0 END", 'kaCrashes'),
  statistic('sum', 'num_K_occ', 'fatalOcc'), statistic('sum', 'num_K_nonm', 'fatalNonm'),
  statistic('sum', 'num_A_occ', 'seriousOcc'), statistic('sum', 'num_A_nonm', 'seriousNonm'),
  statistic('sum', 'nonmotorist_counted', 'nonmotorists'), statistic('sum', 'num_bike', 'bicycles'),
  statistic('sum', 'num_veh', 'vehicles'), statistic('sum', 'num_occ', 'occupants'),
  statistic('sum', 'drv_speeding', 'speeding'), statistic('sum', 'drv_distracted', 'distracted'),
  statistic('sum', 'drv_under_inf', 'underInfluence'),
  statistic('sum', "CASE WHEN alcohol_related = 'Yes' THEN 1 ELSE 0 END", 'alcohol'),
  statistic('sum', 'adult_unrestrained', 'adultUnrestrained'),
  statistic('sum', 'child_6_unrestrained', 'child6Unrestrained'),
  statistic('sum', 'child_8_unrestrained', 'child8Unrestrained'),
  statistic('sum', 'child_6_18_unrestrained', 'child618Unrestrained'),
  statistic('sum', 'child_8_18_unrestrained', 'child818Unrestrained'),
  statistic('sum', "CASE WHEN driver_under_25 = 'Yes' THEN 1 ELSE 0 END", 'youngDrivers'),
  statistic('sum', "CASE WHEN driver_65 = 'Yes' THEN 1 ELSE 0 END", 'olderDrivers'),
  statistic('sum', "CASE WHEN wz_related = 'Yes' THEN 1 ELSE 0 END", 'workZones'),
  statistic('sum', 'num_cited_drv', 'citations'),
];

function crashSummary(attributes = {}) {
  return {
    crashes: Number(attributes.crashes || 0), kaCrashes: Number(attributes.kaCrashes || 0),
    fatalities: Number(attributes.fatalOcc || 0) + Number(attributes.fatalNonm || 0),
    serious: Number(attributes.seriousOcc || 0) + Number(attributes.seriousNonm || 0),
    nonmotorists: Number(attributes.nonmotorists || 0), bicycles: Number(attributes.bicycles || 0),
    vehicles: Number(attributes.vehicles || 0), occupants: Number(attributes.occupants || 0),
    speeding: Number(attributes.speeding || 0), distracted: Number(attributes.distracted || 0),
    impaired: Number(attributes.underInfluence || 0) + Number(attributes.alcohol || 0),
    unrestrained: Number(attributes.adultUnrestrained || 0) + Math.max(Number(attributes.child6Unrestrained || 0), Number(attributes.child8Unrestrained || 0), Number(attributes.child618Unrestrained || 0), Number(attributes.child818Unrestrained || 0)),
    youngDrivers: Number(attributes.youngDrivers || 0), olderDrivers: Number(attributes.olderDrivers || 0),
    workZones: Number(attributes.workZones || 0), citations: Number(attributes.citations || 0),
  };
}

async function queryLinkedIdSummaries(layer, where, idField) {
  const summaries = new Map();
  const pageSize = 2000;
  for (let start = 0; start < 40000; start += pageSize) {
    const result = await layer.queryFeatures({
      where: `${where} AND ${idField} IS NOT NULL`,
      groupByFieldsForStatistics: [idField], orderByFields: [idField],
      outStatistics: LINKED_ID_STATISTICS, returnGeometry: false,
      start, num: pageSize, maxRecordCountFactor: 5,
    });
    for (const feature of result.features) summaries.set(String(feature.attributes[idField]), crashSummary(feature.attributes));
    if (!result.exceededTransferLimit || result.features.length < pageSize) break;
  }
  return summaries;
}

async function queryActiveSafetyRows(crashLayer, networkLayer, filters, kind) {
  if ((kind === 'segment' && filters.assignment === 'Junction') || (kind === 'intersection' && filters.assignment === 'Segment')) return [];
  const idField = kind === 'segment' ? 'TFL_UID' : 'int_ID';
  const crashIdField = kind === 'segment' ? 'assigned_segment_id' : 'assigned_junction_id';
  const assignment = kind === 'segment' ? 'Segment' : 'Junction';
  const summaries = await queryLinkedIdSummaries(crashLayer, `${buildCrashWhere(filters)} AND network_assignment = '${assignment}'`, crashIdField);
  const ids = [...summaries.keys()];
  if (!ids.length) return [];
  const baseWhere = buildNetworkWhere(filters, kind, { hinOnly: false });
  const groups = await Promise.all(chunk(ids, 200).map((idChunk) => queryNetworkRows(
    networkLayer,
    `(${baseWhere}) AND ${idField} IN (${idChunk.map((id) => `'${escapeSqlLiteral(id)}'`).join(',')})`,
    kind,
  )));
  return groups.flat().map((row) => ({ ...row, ...summaries.get(String(row.id)) })).sort((left, right) => right.kaCrashes - left.kaCrashes || right.crashes - left.crashes);
}

function withObjectIds(where, objectIds) {
  if (objectIds == null) return where;
  const ids = objectIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return '1=0';
  return `(${where}) AND OBJECTID IN (${ids.join(',')})`;
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

function leadingValues(features, field, limit = 3) {
  const counts = new Map();
  for (const feature of features || []) {
    const value = fieldText(feature.attributes?.[field], '');
    if (!value || /^(unknown|not applicable|not reported|not recorded|no data)$/i.test(value)) continue;
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value);
        for (const [label, weight] of Object.entries(parsed)) counts.set(label, (counts.get(label) || 0) + Number(weight || 0));
        continue;
      } catch { /* Preserve the recorded text when a legacy value is not valid JSON. */ }
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1]).slice(0, limit);
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
        let periodMetrics = crashSummary();
        let patternFeatures = [];
        try {
          const linkedWhere = `${base} AND ${crashIdField} = '${escapeSqlLiteral(id)}'`;
          const [result, patterns] = await Promise.all([
            crashLayer.queryFeatures({
              where: linkedWhere, groupByFieldsForStatistics: ['severity'],
              outStatistics: LINKED_ID_STATISTICS, returnGeometry: false,
            }),
            crashLayer.queryFeatures({
              where: linkedWhere, outFields: ['manner_of_collision', 'CBC_drvs', 'veh_actions', 'nonm_locations'],
              returnGeometry: false, num: 2000,
            }),
          ]);
          counts = Object.fromEntries(result.features.map((feature) => [feature.attributes.severity, Number(feature.attributes.crashes || 0)]));
          const summaries = result.features.map((feature) => crashSummary(feature.attributes));
          periodMetrics = summaries.reduce((total, item) => Object.fromEntries(Object.keys(total).map((key) => [key, Number(total[key] || 0) + Number(item[key] || 0)])), crashSummary());
          patternFeatures = patterns.features;
        } catch { counts = {}; periodMetrics = crashSummary(); patternFeatures = []; }
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        const wrap = document.createElement('div');
        wrap.className = 'network-popup';
        const summary = document.createElement('p');
        summary.textContent = `${total.toLocaleString()} linked crash records match the active crash filters.`;
        wrap.append(summary);
        const metrics = [
          ['Crashes in selected period', periodMetrics.crashes],
          ['Fatal + serious crashes', periodMetrics.kaCrashes],
          ['People killed', periodMetrics.fatalities],
          ['Seriously injured', periodMetrics.serious],
          ['Nonmotorists', periodMetrics.nonmotorists],
          ['Bicyclists', periodMetrics.bicycles],
        ];
        addPopupMetrics(wrap, metrics);
        const a = graphic.attributes;
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
        const locationKind = segment
          ? `${numeric(a, 'Segment_Miles').toFixed(2)}-mile roadway segment`
          : a.number_of_legs ? `${a.number_of_legs}-leg intersection` : 'intersection';
        addPopupSection(wrap, 'Selected-period safety profile', `For ${activeFilters.startYear}–${activeFilters.endYear}, this ${locationKind} has ${periodMetrics.crashes.toLocaleString()} matching crashes involving ${periodMetrics.vehicles.toLocaleString()} vehicles and ${periodMetrics.occupants.toLocaleString()} occupants.`, 'popup-profile');
        addPopupChips(wrap, 'Recorded factors and users', [
          ['Speeding', periodMetrics.speeding], ['Distracted driving', periodMetrics.distracted],
          ['Impairment / alcohol', periodMetrics.impaired], ['Unrestrained', periodMetrics.unrestrained],
          ['Driver under 25', periodMetrics.youngDrivers], ['Driver 65+', periodMetrics.olderDrivers],
          ['Work zone', periodMetrics.workZones], ['Citations', periodMetrics.citations],
        ], `${activeFilters.startYear}–${activeFilters.endYear} recorded indicators; categories can overlap and are not percentages.`);
        const patterns = [];
        const formatLeaders = (values) => values.map(([label, value]) => `${label} (${value.toLocaleString()})`).join(', ');
        const collisions = leadingValues(patternFeatures, 'manner_of_collision');
        if (collisions.length) patterns.push(`Leading collision types: ${formatLeaders(collisions)}.`);
        const driverActions = leadingValues(patternFeatures, 'CBC_drvs', 2);
        if (driverActions.length) patterns.push(`Driver factors: ${formatLeaders(driverActions)}.`);
        const vehicleActions = leadingValues(patternFeatures, 'veh_actions', 2);
        if (vehicleActions.length) patterns.push(`Vehicle actions: ${formatLeaders(vehicleActions)}.`);
        const nonmotoristLocations = leadingValues(patternFeatures, 'nonm_locations', 2);
        if (nonmotoristLocations.length) patterns.push(`Nonmotorist locations: ${formatLeaders(nonmotoristLocations)}.`);
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
  const webmapSafetyIntersectionRenderer = layers.safetyIntersections.renderer?.clone?.() || layers.safetyIntersections.renderer;
  layers.safetySegments.renderer = { type: 'simple', symbol: { type: 'simple-line', color: BRAND.blue, width: 2.4 } };
  layers.safetyIntersections.renderer = { type: 'simple', symbol: { type: 'simple-marker', style: 'circle', color: BRAND.yellow, size: 6, outline: { color: BRAND.blue, width: 1.1 } } };
  layers.allSafetySegments.renderer = { type: 'simple', symbol: { type: 'simple-line', style: 'solid', color: BRAND.blue, width: 1, cap: 'round', join: 'round' } };
  layers.allSafetyIntersections.renderer = webmapSafetyIntersectionRenderer || { type: 'simple', symbol: { type: 'simple-marker', style: 'circle', color: [15, 27, 43, 255], size: 3, outline: { color: [143, 168, 184, 128], width: .9 } } };
  layers.allSafetyIntersections.opacity = 1;
  const severityRenderer = {
    type: 'unique-value', field: 'severity', orderByClassesEnabled: true,
    defaultSymbol: { type: 'simple-marker', color: BRAND.grey, size: 5, outline: { color: 'white', width: .5 } },
    uniqueValueInfos: SEVERITIES.map((item) => ({ value: item.value, label: item.label, symbol: { type: 'simple-marker', style: 'circle', color: item.color, size: item.value === 'K' ? 10 : item.value === 'A' ? 8 : 6, outline: { color: 'white', width: .8 } } })),
  };
  layers.crashes.featureReduction = null;
  layers.crashes.renderer = severityRenderer;
  layers.crashes.outFields = CRASH_POPUP_FIELDS;
  layers.crashes.popupTemplate = crashPopupTemplate();
  layers.safetySegments.popupTemplate = popupTemplate('segment', layers.crashes, filterRef);
  layers.safetyIntersections.popupTemplate = popupTemplate('intersection', layers.crashes, filterRef);
  layers.allSafetySegments.popupTemplate = popupTemplate('segment', layers.crashes, filterRef);
  layers.allSafetyIntersections.popupTemplate = popupTemplate('intersection', layers.crashes, filterRef);
}

function MapCanvas({ filters, selection, visible, onReady, onSelect, onSpatialSelect, onStatus }) {
  const node = useRef(null);
  const apiRef = useRef(null);
  const filterRef = useRef(filters);
  const visibleRef = useRef(visible);
  const callbacks = useRef({ onReady, onSelect, onSpatialSelect, onStatus });
  useEffect(() => { filterRef.current = filters; }, [filters]);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { callbacks.current = { onReady, onSelect, onSpatialSelect, onStatus }; }, [onReady, onSelect, onSpatialSelect, onStatus]);

  useEffect(() => {
    let disposed = false;
    let clickHandle;
    let popupHandle;
    let highlight;
    let sketchHandle;
    let sketchViewModel;
    let selectionLayer;
    let selectionToolbar;
    let pointPointerHandler;
    let pointPicking = false;
    let currentSelectedGraphic = null;
    let selectionPopupWasVisible = false;
    let selectionHighlights = [];
    const selectedObjectIds = { segment: new Set(), intersection: new Set() };
    let view;
    const webmap = new WebMap({ portalItem: { id: WEBMAP_ID } });
    callbacks.current.onStatus('loading');
    webmap.load().then(async () => {
      if (disposed) return;
      const unwanted = webmap.allLayers.filter((layer) => /^HIN - /.test(layer.title || '') || /^NM Severity - Chart$/i.test(layer.title || '') || /High (Priority|Risk) Network|Community Safety Concerns/i.test(layer.title || ''));
      unwanted.forEach((layer) => { if (layer.parent?.remove) layer.parent.remove(layer); else webmap.remove(layer); });
      view = new MapView({ container: node.current, map: webmap, extent: MAP_EXTENT, constraints: { snapToZoom: false }, popup: { dockEnabled: false, alignment: 'auto', dockOptions: { buttonEnabled: false } }, ui: { components: ['attribution', 'zoom'] } });
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
      const querySegments = new FeatureLayer({ url: `${layers.safetySegments.url}/${layers.safetySegments.layerId}`, outFields: ['*'] });
      const queryIntersections = new FeatureLayer({ url: `${layers.safetyIntersections.url}/${layers.safetyIntersections.layerId}`, outFields: ['*'] });
      const queryCrashes = new FeatureLayer({ url: `${layers.crashes.url}/${layers.crashes.layerId}`, outFields: ['*'] });
      selectionLayer = new GraphicsLayer({ title: 'Map selection', listMode: 'hide' });
      const counties = new FeatureLayer({ url: SERVICE_URLS.counties, title: 'Selected county boundary', visible: false, outFields: ['*'], renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: BRAND.teal, width: 1.5 } } }, popupEnabled: false, listMode: 'hide' });
      const cities = new FeatureLayer({ url: SERVICE_URLS.cities, title: 'Selected city boundary', visible: false, outFields: ['*'], renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: BRAND.blue, width: 1.5 } } }, popupEnabled: false, listMode: 'hide' });
      webmap.addMany([allSafetySegments, allSafetyIntersections, counties, cities], 0);
      webmap.add(selectionLayer);
      layers.allSafetySegments = allSafetySegments; layers.allSafetyIntersections = allSafetyIntersections;
      layers.counties = counties; layers.cities = cities;
      layers.querySegments = querySegments; layers.queryIntersections = queryIntersections; layers.queryCrashes = queryCrashes;
      configureLayers(layers, filterRef);
      layers.safetySegments.visible = visible.hin; layers.safetyIntersections.visible = visible.hin;
      layers.allSafetySegments.visible = visible.safety; layers.allSafetyIntersections.visible = visible.safety;
      layers.crashes.visible = visible.crashes;
      view.ui.add(new Expand({ view, content: new Search({ view, popupEnabled: false, includeDefaultSources: true }), expanded: false, expandTooltip: 'Search for an address or place', collapseTooltip: 'Close search' }), { position: 'top-right', index: 0 });
      view.ui.add(new Home({ view }), 'top-left');
      view.ui.add(new ScaleBar({ view, unit: 'dual' }), 'bottom-left');
      view.ui.add(new Expand({ view, content: new Legend({ view }), group: 'map-tools', expandTooltip: 'Legend', collapseTooltip: 'Close legend' }), 'top-right');
      sketchViewModel = new SketchViewModel({
        view, layer: selectionLayer,
        pointSymbol: { type: 'simple-marker', style: 'circle', color: BRAND.yellow, size: 8, outline: { color: BRAND.blue, width: 1.5 } },
        polygonSymbol: { type: 'simple-fill', color: [0, 132, 175, .08], outline: { color: BRAND.blue, width: 2, style: 'dash' } },
      });
      const clearSpatialSelection = () => {
        pointPicking = false;
        selectedObjectIds.segment.clear(); selectedObjectIds.intersection.clear();
        selectionHighlights.forEach((item) => item.remove()); selectionHighlights = [];
        selectionLayer.removeAll();
        callbacks.current.onSpatialSelect(null);
        const count = selectionToolbar?.querySelector('.selection-count');
        if (count) count.textContent = 'No active selection';
      };
      const clearPointSelection = (notify = false, closePopup = true) => {
        highlight?.remove();
        highlight = null;
        currentSelectedGraphic = null;
        selectionPopupWasVisible = false;
        if (closePopup) view.closePopup();
        if (notify) callbacks.current.onSelect(null);
      };
      const applySpatialSelection = async (geometry) => {
        const active = visibleRef.current.safety
          ? [[layers.allSafetySegments, 'segment'], [layers.allSafetyIntersections, 'intersection']]
          : visibleRef.current.hin
            ? [[layers.safetySegments, 'segment'], [layers.safetyIntersections, 'intersection']]
            : [];
        for (const [layer, kind] of active) {
          const ids = await layer.queryObjectIds({
            geometry, spatialRelationship: 'intersects', where: layer.definitionExpression || '1=1',
            distance: geometry.type === 'point' ? Math.max(25, view.resolution * 10) : undefined, units: geometry.type === 'point' ? 'meters' : undefined,
          });
          ids.forEach((id) => selectedObjectIds[kind].add(Number(id)));
        }
        selectionHighlights.forEach((item) => item.remove()); selectionHighlights = [];
        for (const [layer, kind] of active) {
          const ids = [...selectedObjectIds[kind]];
          if (ids.length) selectionHighlights.push((await view.whenLayerView(layer)).highlight(ids));
        }
        const result = { segment: [...selectedObjectIds.segment], intersection: [...selectedObjectIds.intersection] };
        callbacks.current.onSpatialSelect(result);
        const count = selectionToolbar?.querySelector('.selection-count');
        if (count) count.textContent = `${result.segment.length.toLocaleString()} roads · ${result.intersection.length.toLocaleString()} intersections`;
      };
      sketchHandle = sketchViewModel.on('create', (event) => {
        if (event.state === 'complete') applySpatialSelection(event.graphic.geometry).catch((error) => callbacks.current.onStatus(error.message || 'Map selection could not be completed.'));
      });
      pointPointerHandler = (event) => {
        if (!pointPicking || event.target.closest?.('.selection-tools')) return;
        pointPicking = false;
        const bounds = view.container.getBoundingClientRect();
        const mapPoint = view.toMap({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        if (!mapPoint) return;
        selectionLayer.add(new Graphic({ geometry: mapPoint, symbol: { type: 'simple-marker', style: 'circle', color: BRAND.yellow, size: 8, outline: { color: BRAND.blue, width: 1.5 } } }));
        applySpatialSelection(mapPoint).catch((error) => callbacks.current.onStatus(error.message || 'Map selection could not be completed.'));
      };
      view.container.addEventListener('pointerdown', pointPointerHandler, true);
      selectionToolbar = document.createElement('div');
      selectionToolbar.className = 'selection-tools esri-widget';
      selectionToolbar.innerHTML = '<strong>Select network</strong><div><button type="button" data-shape="point" title="Pick a location">Point</button><button type="button" data-shape="rectangle" title="Select by rectangle">Rect.</button><button type="button" data-shape="lasso" title="Select with a freehand lasso">Lasso</button><button type="button" data-shape="clear" title="Clear selected network">Clear</button></div><small class="selection-count">No active selection</small>';
      selectionToolbar.addEventListener('click', (event) => {
        const shape = event.target.closest('button')?.dataset.shape;
        if (!shape) return;
        if (shape === 'clear') { clearSpatialSelection(); return; }
        const count = selectionToolbar.querySelector('.selection-count');
        if (shape === 'point') {
          pointPicking = true;
          if (count) count.textContent = 'Click a network location on the map';
          return;
        }
        if (count) count.textContent = shape === 'lasso' ? 'Draw a freehand selection on the map' : 'Drag a selection rectangle on the map';
        if (shape === 'lasso') sketchViewModel.create('polygon', { mode: 'freehand' });
        else sketchViewModel.create(shape);
      });
      view.ui.add(new Expand({ view, content: selectionToolbar, expanded: false, expandTooltip: 'Select network features', collapseTooltip: 'Close selection tools' }), { position: 'top-left', index: 0 });
      clickHandle = view.on('click', async (event) => {
        const hit = await view.hitTest(event, { include: [layers.safetySegments, layers.safetyIntersections, layers.allSafetySegments, layers.allSafetyIntersections] });
        const result = hit.results.find((item) => item.type === 'graphic');
        if (!result) {
          if (currentSelectedGraphic) clearPointSelection(true);
          return;
        }
        const selectedLayer = result.graphic.layer;
        const kind = selectedLayer === layers.safetySegments || selectedLayer === layers.allSafetySegments ? 'segment' : 'intersection';
        const objectId = result.graphic.getObjectId();
        if (currentSelectedGraphic && currentSelectedGraphic.layer === selectedLayer && currentSelectedGraphic.getObjectId() === objectId) {
          clearPointSelection(true);
          return;
        }
        let selectedGraphic = result.graphic;
        if (objectId != null) {
          const fullResult = await selectedLayer.queryFeatures({ objectIds: [objectId], outFields: ['*'], returnGeometry: true });
          if (fullResult.features.length) selectedGraphic = fullResult.features[0];
        }
        highlight?.remove();
        currentSelectedGraphic = selectedGraphic;
        highlight = (await view.whenLayerView(selectedLayer)).highlight(selectedGraphic);
        selectionPopupWasVisible = Boolean(view.popup?.visible);
        callbacks.current.onSelect({ ...normalizeNetworkFeature(selectedGraphic, kind), networkMode: selectedLayer === layers.allSafetySegments || selectedLayer === layers.allSafetyIntersections ? 'safety' : 'hin' });
      });
      popupHandle = reactiveUtils.watch(() => view.popup?.visible, (isVisible) => {
        if (isVisible && currentSelectedGraphic) selectionPopupWasVisible = true;
        if (!isVisible && currentSelectedGraphic && selectionPopupWasVisible) clearPointSelection(true, false);
      });
      const api = {
        view, layers,
        clearSelection: () => clearPointSelection(false),
        clearSpatialSelection,
        zoomSelection: async () => {
          const selectionGraphics = selectionLayer.graphics.toArray();
          const selectedGraphic = currentSelectedGraphic || (selectionGraphics.length === 1 ? selectionGraphics[0] : null);
          if (selectedGraphic) {
            const geometry = selectedGraphic.geometry;
            const target = geometry?.type === 'point'
              ? { target: geometry, zoom: 16 }
              : geometry?.extent ? geometry.extent.expand(1.45) : selectedGraphic;
            await view.goTo(target, { duration: 650 }).catch(() => {});
            return;
          }
          if (selectionGraphics.length) {
            const extent = selectionGraphics.reduce((combined, graphic) => {
              const graphicExtent = graphic.geometry?.extent;
              return graphicExtent ? (combined ? combined.union(graphicExtent) : graphicExtent.clone()) : combined;
            }, null);
            if (extent) await view.goTo(extent.expand(1.25), { duration: 650 }).catch(() => {});
          }
        },
        setPeriodNetworkIds: ({ segment, intersection }) => {
          const current = filterRef.current;
          const segmentWhere = current.assignment === 'Junction' ? '1=0' : buildNetworkWhere(current, 'segment');
          const intersectionWhere = current.assignment === 'Segment' ? '1=0' : buildNetworkWhere(current, 'intersection');
          layers.safetySegments.definitionExpression = withObjectIds(segmentWhere, segment);
          layers.safetyIntersections.definitionExpression = withObjectIds(intersectionWhere, intersection);
        },
        focus: async (record) => { highlight?.remove(); const safety = record.networkMode === 'safety' || Number(record.hin) !== 1; const layer = record.type === 'segment' ? (safety ? layers.allSafetySegments : layers.safetySegments) : (safety ? layers.allSafetyIntersections : layers.safetyIntersections); const result = await layer.queryFeatures({ objectIds: [record.objectId], outFields: ['*'], returnGeometry: true }); if (!result.features.length) return; currentSelectedGraphic = result.features[0]; highlight = (await view.whenLayerView(layer)).highlight(currentSelectedGraphic); await view.goTo(currentSelectedGraphic, { duration: 600 }).catch(() => {}); view.openPopup({ features: result.features, location: currentSelectedGraphic.geometry.extent?.center || currentSelectedGraphic.geometry }); selectionPopupWasVisible = true; },
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
    return () => { disposed = true; clickHandle?.remove(); popupHandle?.remove(); sketchHandle?.remove(); sketchViewModel?.cancel(); if (view?.container && pointPointerHandler) view.container.removeEventListener('pointerdown', pointPointerHandler, true); highlight?.remove(); selectionHighlights.forEach((item) => item.remove()); apiRef.current?.layers.querySegments?.destroy(); apiRef.current?.layers.queryIntersections?.destroy(); apiRef.current?.layers.queryCrashes?.destroy(); view?.destroy(); };
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
  useEffect(() => { const api = apiRef.current; if (api) { api.layers.safetySegments.visible = visible.hin; api.layers.safetyIntersections.visible = visible.hin; api.layers.allSafetySegments.visible = visible.safety; api.layers.allSafetyIntersections.visible = visible.safety; api.clearSpatialSelection(); } }, [visible.hin, visible.safety]);
  useEffect(() => { const api = apiRef.current; if (api) api.layers.crashes.visible = visible.crashes; }, [visible.crashes]);
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
      <Toggle checked={visible.hin} onChange={(checked) => setVisible((v) => checked ? { ...v, hin: true, safety: false } : { ...v, hin: false })} label="High Injury Network" description="HIN roads and intersections" icon={Route} color={BRAND.blue} />
      <Toggle checked={visible.safety} onChange={(checked) => setVisible((v) => checked ? { ...v, safety: true, hin: false } : { ...v, safety: false })} label="All Safety Network" description="Every road and intersection in the analysis network" icon={ShieldCheck} color={BRAND.teal} />
      <Toggle checked={visible.crashes} onChange={(crashes) => setVisible((v) => ({ ...v, crashes }))} label="Crash records" description="Individual crash events symbolized by highest severity" icon={Car} color={BRAND.coral} />
    </section>
    <section className="panel-section"><h2>Location</h2><label className="field"><span>Select county or city</span><select value={filters.location} onChange={(event) => patch({ location: event.target.value })}><option value="">MAPA TMA</option><optgroup label="Counties">{LOCATIONS.counties.map((name) => <option key={name} value={`county|${name}`}>{name} County</option>)}</optgroup><optgroup label="Cities">{LOCATIONS.cities.map((name) => <option key={name} value={`city|${name}`}>{name}</option>)}</optgroup></select><ChevronDown size={17} /></label></section>
    <section className="panel-section assignment-section"><h2>Network assignment</h2><label className="field"><span>Show network and crashes assigned to</span><select value={filters.assignment} onChange={(event) => patch({ assignment: event.target.value })}><option>All</option><option>Segment</option><option>Junction</option></select><ChevronDown size={17} /></label></section>
    {selection && <section className="focus-card"><button onClick={clearSelection} aria-label="Clear selected network feature"><X size={18} /></button><span>Selected {selection.type}</span><h3>{selection.name}</h3><p>{[selection.city, selection.county].filter(Boolean).join(' · ')}</p><div><b>{formatNumber(selection.crashes)}</b><small>{filters.startYear}–{filters.endYear} crashes</small><b>{formatNumber(selection.kaCrashes)}</b><small>fatal + serious crashes</small></div></section>}
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

function CrashAnalytics({ performance, period, networkLabel }) {
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
  return <section className="analytics-section"><div className="section-heading"><div><span>{networkLabel} crash records</span><h2>Patterns in the displayed network</h2></div><small>{period}</small></div>
    <article className="chart-card"><h3>Annual crash trend</h3><div className="year-chart">{yearRows.map((row) => <div key={row.year}><span title={`${formatNumber(row.value)} crashes`} style={{ height: `${Math.max(4, row.value / maxYear * 100)}%` }} /><b>{formatNumber(row.value)}</b><small>{row.year}</small></div>)}</div></article>
    <article className="chart-card"><h3>Crash records by highest severity</h3><div className="analysis-bars">{severityRows.map((row) => <div key={row.value + row.label}><span><i style={{ background: row.color }} />{row.label} crash</span><b>{formatNumber(row.value)}</b><em><i style={{ width: `${row.value / maxSeverity * 100}%`, background: row.color }} /></em></div>)}</div><p>This chart counts crash records. One crash can involve more than one injured person.</p></article>
    <article className="chart-card"><h3>Injury outcomes — people</h3><div className="analysis-bars">{outcomeRows.map((row) => <div key={row.label}><span><i style={{ background: row.color }} />{row.label}</span><b>{formatNumber(row.value)}</b><em><i style={{ width: `${row.value / maxOutcome * 100}%`, background: row.color }} /></em></div>)}</div></article>
    <article className="chart-card"><h3>Contributing factors and users</h3><div className="analysis-bars factor-bars">{factorRows.map((row) => <div key={row.label}><span>{row.label}</span><b>{formatNumber(row.value)}</b><em><i style={{ width: `${row.value / maxFactor * 100}%` }} /></em></div>)}</div><p>Factor totals count recorded indicators and may overlap because one crash can involve more than one factor.</p></article>
  </section>;
}

function PerformancePanel({ performance, loading, impacts, onFocusImpact, period, networkMode, assignment, selectionCount }) {
  const [impactType, setImpactType] = useState('segment');
  const impactRows = impacts[impactType] || [];
  const safetyMode = networkMode === 'safety';
  const networkLabel = safetyMode ? 'All Safety Network' : 'High Injury Network';
  const networkShort = safetyMode ? 'safety network' : 'HIN';
  const showRoads = assignment !== 'Junction';
  const showIntersections = assignment !== 'Segment';
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
      <div className="performance-title"><span>Network performance</span><h2>What are the statistics of the network?</h2><p>Statistics cover <b>{period}</b> for the <b>{networkLabel}</b> and update with the active location, assignment, network filters{selectionCount ? `, and ${selectionCount.toLocaleString()} selected network locations` : ''}.</p></div>
      {loading ? <div className="loading-block">Updating network statistics…</div> : <>
        <div className="performance-total"><span>Crashes on the displayed {networkShort}</span><strong>{formatNumber(totalCrashes)}</strong><small>{formatNumber(areaCrashes)} matching crashes occurred across the entire selected area</small><div>{showRoads && <p><b>{percent(performance.roads.crashes, totalCrashes)}%</b>occurred on roadways</p>}{showIntersections && <p><b>{percent(performance.intersections.crashes, totalCrashes)}%</b>occurred at intersections</p>}</div></div>
        <div className="performance-total"><span>People killed or seriously injured</span><strong>{formatNumber(totalFatal + totalSerious)}</strong><small>People killed: <b>{formatNumber(totalFatal)}</b> · People seriously injured: <b>{formatNumber(totalSerious)}</b></small><div>{showRoads && <p><b>{percent(roadFsi, totalFatal + totalSerious)}%</b>on roadways</p>}{showIntersections && <p><b>{percent(intersectionFsi, totalFatal + totalSerious)}%</b>at intersections</p>}</div></div>
        <div className="network-profile"><h3>Network pulse</h3><div>{showRoads && <span><b>{formatNumber(performance.roads.miles, 1)}</b>{networkShort} roadway miles</span>}{showIntersections && <span><b>{formatNumber(performance.intersections.count)}</b>{networkShort} intersections</span>}<span><b>{formatNumber((performance.roads.nonmotorists || 0) + (performance.intersections.nonmotorists || 0))}</b>nonmotorists recorded</span><span><b>{formatNumber((performance.roads.vehicles || 0) + (performance.intersections.vehicles || 0))}</b>vehicles involved</span></div></div>
        {safetyMode ? <div className="comparison whole-network"><h3>Entire safety network view</h3><p>The All Safety Network is the full comparison baseline for the selected location and assignment. Turn this layer off to return the performance panel to the period-filtered HIN comparison.</p></div> : <div className="comparison"><h3>How does it compare to the entire network?</h3><p>Comparison uses the same location, crash period, severity, travel mode, and Safer People filters.</p>
          <div className="comparison-grid">{showRoads && <article><h4>Roadways</h4><p>The displayed roadways have on average <strong>{roadRatio == null ? '—' : `${formatNumber(roadRatio, 1)}×`}</strong> more fatal and serious injuries than other roadways.</p><div className="coverage"><span><b>{roadCoverage}%</b>of all roadway miles</span><i /><span><b>{roadCapture}%</b>of roadway fatalities and serious injuries</span></div></article>}
          {showIntersections && <article><h4>Intersections</h4><p>The displayed intersections have on average <strong>{intRatio == null ? '—' : `${formatNumber(intRatio, 1)}×`}</strong> more fatal and serious injuries than other intersections.</p><div className="coverage"><span><b>{intCoverage}%</b>of all intersections</span><i /><span><b>{intCapture}%</b>of intersection fatalities and serious injuries</span></div></article>}</div>
        </div>}
      </>}
    </section>
    {!loading && <CrashAnalytics performance={performance} period={period} networkLabel={networkLabel} />}
    <section className="corridors"><div className="section-heading"><div><span>High-impact HIN</span><h2>Highest-impact {impactType === 'segment' ? 'roads' : 'intersections'}</h2></div><small>Trend: 2021–2025 vs. 2018–2022</small></div><div className="impact-tabs"><button className={impactType === 'segment' ? 'active' : ''} onClick={() => setImpactType('segment')}>Roads</button><button className={impactType === 'intersection' ? 'active' : ''} onClick={() => setImpactType('intersection')}>Intersections</button></div><div className="corridor-list">{impactRows.slice(0, 12).map((item, index) => <button key={item.key} onClick={() => onFocusImpact(item)}><b>{index + 1}</b><span><strong>{item.name}</strong><small>{item.city || 'MAPA region'}</small><em>{formatNumber(item.fsi)} fatal / serious injuries · <i className={`trend-${item.trend.toLowerCase().replaceAll(' ', '-')}`}>{item.trend}</i></em></span></button>)}{!impactRows.length && <p className="empty">No HIN locations are available for this location.</p>}</div></section>
  </>;
}

function DataDrawer({ open, setOpen, tab, setTab, rows, loading, onFocus, onExport, period, networkLabel }) {
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState('');
  const visibleRows = rows.filter((row) => `${row.name} ${row.city} ${row.county} ${row.id}`.toLowerCase().includes(search.toLowerCase())).slice(0, 1000);
  const doExport = async (format) => { setExporting(format); try { await onExport(format); } finally { setExporting(''); } };
  return <section className={`data-drawer ${open ? 'open' : ''}`}><button className="drawer-handle" onClick={() => setOpen(!open)} aria-expanded={open}><span /><Table2 size={18} /><b>Network table</b><small>{networkLabel} · {formatNumber(rows.length)} filtered {tab === 'segment' ? 'roads' : 'intersections'} · {period}</small><ChevronDown size={19} /></button>{open && <div className="drawer-body"><div className="drawer-tools"><div className="table-tabs"><button className={tab === 'segment' ? 'active' : ''} onClick={() => setTab('segment')}>Roads</button><button className={tab === 'intersection' ? 'active' : ''} onClick={() => setTab('intersection')}>Intersections</button></div><label className="table-search"><SearchIcon size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the filtered network" /></label><div className="export-menu"><span>Export:</span>{[['csv', 'CSV'], ['shp', 'Shapefile'], ['gpkg', 'GeoPackage']].map(([value, label]) => <button key={value} disabled={Boolean(exporting) || !rows.length} onClick={() => doExport(value)}><Download size={15} />{exporting === value ? 'Preparing…' : label}</button>)}</div></div>{loading ? <div className="table-state">Updating the filtered network…</div> : <div className="table-wrap"><table><thead><tr><th>#</th><th>{tab === 'segment' ? 'Road' : 'Intersection'}</th><th>Location</th><th>HIN</th><th>K+A crashes</th><th>All crashes</th><th>Killed</th><th>Seriously injured</th><th>Nonmotorists</th><th>Bicyclists</th><th>Vehicles</th><th>Speeding</th><th>Distracted</th><th>Impaired / alcohol</th><th>{tab === 'segment' ? 'Miles / class' : 'Control / legs'}</th><th /></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={`${row.type}-${row.objectId}`}><td>{index + 1}</td><td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.city || '—'}<small>{row.county || '—'}</small></td><td>{row.hin === 1 ? 'Yes' : 'No'}</td><td>{formatNumber(row.kaCrashes)}</td><td>{formatNumber(row.crashes)}</td><td>{formatNumber(row.fatalities)}</td><td>{formatNumber(row.serious)}</td><td>{formatNumber(row.nonmotorists)}</td><td>{formatNumber(row.bicycles)}</td><td>{formatNumber(row.vehicles)}</td><td>{formatNumber(row.speeding)}</td><td>{formatNumber(row.distracted)}</td><td>{formatNumber(row.impaired)}</td><td>{tab === 'segment' ? <>{formatNumber(row.miles, 2)} mi<small>{functionalClassLabel(row.functionalClass)}</small></> : <>{row.control || '—'}<small>{row.lanes ? `${row.lanes} legs` : 'Legs not recorded'}</small></>}</td><td><button onClick={() => onFocus(row)}>Show</button></td></tr>)}</tbody></table>{rows.length > 1000 && <p className="row-limit">Showing the first 1,000 rows. Exports include up to 2,000 filtered features.</p>}</div>}</div>}</section>;
}

function SelectionSummary({ count, onZoom }) {
  return <div className="selection-summary" aria-live="polite">
    <button type="button" onClick={onZoom} disabled={!count} title={count ? 'Zoom to selected features' : 'No selected features'} aria-label="Zoom to selected features"><LocateFixed size={16} /></button>
    <span>Selected features: <b>{formatNumber(count)}</b></span>
  </div>;
}

function ShareDialog({ filters, visible }) {
  const [open, setOpen] = useState(false);
  const [includeParameters, setIncludeParameters] = useState(true);
  const [copied, setCopied] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const shareUrl = useMemo(() => buildShareUrl(filters, visible, includeParameters), [filters, visible, includeParameters]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!showQr) return;
    let current = true;
    QRCode.toDataURL(shareUrl, { width: 220, margin: 1, color: { dark: BRAND.teal, light: '#ffffff' } })
      .then((value) => { if (current) setQrUrl(value); })
      .catch(() => { if (current) setQrUrl(''); });
    return () => { current = false; };
  }, [shareUrl, showQr]);

  const copy = async (text, label) => {
    await copyShareText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1800);
  };
  const openShareTarget = (url) => {
    const popup = window.open(url, '_blank', 'noopener,noreferrer,width=720,height=620');
    if (popup) popup.opener = null;
  };
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent('MAPA High Injury Network');
  const embedCode = `<iframe src="${shareUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" title="MAPA High Injury Network" width="100%" height="720" loading="lazy"></iframe>`;
  const targets = [
    ['email', 'Email', <Mail size={21} />, `mailto:?subject=${encodedTitle}&body=${encodedUrl}`],
    ['facebook', 'Facebook', 'f', `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`],
    ['x', 'X', 'X', `https://x.com/intent/post?url=${encodedUrl}&text=${encodedTitle}`],
    ['pinterest', 'Pinterest', 'p', `https://www.pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedTitle}`],
    ['linkedin', 'LinkedIn', 'in', `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`],
  ];

  return <>
    <button type="button" className="share-trigger" onClick={() => setOpen(true)}><Share2 size={17} />Share</button>
    {open && <div className="share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <header><h2 id="share-title">Share</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close share dialog"><X size={20} /></button></header>
        <div className="share-link"><input value={shareUrl} readOnly aria-label="Share URL" /><button type="button" onClick={() => copy(shareUrl, 'link')} title="Copy link" aria-label="Copy link"><Copy size={18} /></button></div>
        <label className="share-check"><input type="checkbox" checked={includeParameters} onChange={(event) => setIncludeParameters(event.target.checked)} />Include active filters and visible layers</label>
        <div className="share-options">
          <button type="button" className="share-option embed" onClick={() => copy(embedCode, 'embed')}><Code2 size={22} /><span>Embed</span></button>
          <button type="button" className="share-option qr" onClick={() => setShowQr((value) => !value)}><QrCode size={22} /><span>QR code</span></button>
          {navigator.share && <button type="button" className="share-option device" onClick={() => navigator.share({ title: 'MAPA High Injury Network', url: shareUrl }).catch(() => {})}><Share2 size={22} /><span>Device</span></button>}
          {targets.map(([key, label, icon, url]) => <button type="button" key={key} className={`share-option ${key}`} onClick={() => openShareTarget(url)}><b>{icon}</b><span>{label}</span></button>)}
        </div>
        {showQr && <div className="share-qr">{qrUrl ? <img src={qrUrl} alt="QR code for this shared map" /> : <span>Preparing QR code…</span>}</div>}
        {copied && <p className="share-confirm" role="status">{copied === 'embed' ? 'Embed code copied.' : 'Link copied.'}</p>}
      </section>
    </div>}
  </>;
}

export default function App() {
  const [sharedState] = useState(initialSharedState);
  const [filters, setFilters] = useState(sharedState.filters);
  const [visible, setVisible] = useState(sharedState.visible);
  const [yearMax, setYearMax] = useState(YEAR_MAX);
  const [leftTab, setLeftTab] = useState('explore');
  const [mobilePanel, setMobilePanel] = useState('map');
  const [mapApi, setMapApi] = useState(null);
  const [mapStatus, setMapStatus] = useState('loading');
  const [analyticsError, setAnalyticsError] = useState('');
  const [statusHovered, setStatusHovered] = useState(false);
  const [statusPinned, setStatusPinned] = useState(false);
  const showStatus = statusHovered || statusPinned;
  const [selection, setSelection] = useState(null);
  const [spatialSelection, setSpatialSelection] = useState(null);
  const [performance, setPerformance] = useState(EMPTY_PERFORMANCE);
  const [networkRows, setNetworkRows] = useState({ segment: [], intersection: [] });
  const [impactRows, setImpactRows] = useState({ segment: [], intersection: [] });
  const [impactYears, setImpactYears] = useState({ segment: new Map(), intersection: new Map() });
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('segment');

  const reset = () => { setFilters(DEFAULT_FILTERS); setSelection(null); setSpatialSelection(null); mapApi?.clearSelection(); mapApi?.clearSpatialSelection(); };
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
    const fixedFilters = { ...DEFAULT_FILTERS, location: filters.location, startYear: YEAR_MIN, endYear: yearMax };
    const loadCorridors = async () => {
      try {
        const [segments, intersections] = await Promise.all([
          queryNetworkRows(mapApi.layers.querySegments, buildNetworkWhere(fixedFilters, 'segment'), 'segment'),
          queryNetworkRows(mapApi.layers.queryIntersections, buildNetworkWhere(fixedFilters, 'intersection'), 'intersection'),
        ]);
        const [segmentYears, intersectionYears] = await Promise.all([
          queryLinkedByYear(mapApi.layers.queryCrashes, segments.map((row) => row.id), 'assigned_segment_id', buildCrashWhere(fixedFilters)),
          queryLinkedByYear(mapApi.layers.queryCrashes, intersections.map((row) => row.id), 'assigned_junction_id', buildCrashWhere(fixedFilters)),
        ]);
        if (!cancelled) {
          setImpactRows({ segment: periodNetworkRows(segments, segmentYears, YEAR_MIN, yearMax), intersection: periodNetworkRows(intersections, intersectionYears, YEAR_MIN, yearMax) });
          setImpactYears({ segment: segmentYears, intersection: intersectionYears });
        }
      } catch { if (!cancelled) { setImpactRows({ segment: [], intersection: [] }); setImpactYears({ segment: new Map(), intersection: new Map() }); } }
    };
    loadCorridors();
    return () => { cancelled = true; };
  }, [mapApi, yearMax, filters.location]);

  useEffect(() => {
    if (!mapApi) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setAnalyticsLoading(true);
      setAnalyticsError('');
      try {
        const segmentWhere = filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(filters, 'segment');
        const intersectionWhere = filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(filters, 'intersection');
        const safetySegmentWhere = filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(filters, 'segment', { hinOnly: false });
        const safetyIntersectionWhere = filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(filters, 'intersection', { hinOnly: false });
        const baseFilters = { ...DEFAULT_FILTERS, location: filters.location };
        const baseSegmentWhere = filters.assignment === 'Junction' ? '1=0' : buildNetworkWhere(baseFilters, 'segment', { hinOnly: false });
        const baseIntersectionWhere = filters.assignment === 'Segment' ? '1=0' : buildNetworkWhere(baseFilters, 'intersection', { hinOnly: false });
        const relationshipFilters = { ...filters, startYear: YEAR_MIN, endYear: yearMax };
        const qualificationFilters = {
          ...DEFAULT_FILTERS,
          location: filters.location,
          assignment: filters.assignment,
          startYear: YEAR_MIN,
          endYear: yearMax,
          severities: ['K', 'A'],
        };
        const currentCrashWhere = buildCrashWhere(filters);
        const relationshipCrashWhere = buildCrashWhere(relationshipFilters);
        const qualificationCrashWhere = buildCrashWhere(qualificationFilters);
        const safetyMode = visible.safety;
        const [segments, intersections, baseRoadUnits, baseIntersectionUnits, baseRoadCrashes, baseIntersectionCrashes, safetyRoadUnits, safetyIntersectionUnits, safetyRoadYears, safetyIntersectionYears] = await Promise.all([
          queryNetworkRows(mapApi.layers.querySegments, segmentWhere, 'segment'),
          queryNetworkRows(mapApi.layers.queryIntersections, intersectionWhere, 'intersection'),
          querySafetyBase(mapApi.layers.querySegments, baseSegmentWhere, 'segment'),
          querySafetyBase(mapApi.layers.queryIntersections, baseIntersectionWhere, 'intersection'),
          queryCrashBase(mapApi.layers.queryCrashes, currentCrashWhere, 'Segment'),
          queryCrashBase(mapApi.layers.queryCrashes, currentCrashWhere, 'Junction'),
          safetyMode ? querySafetyBase(mapApi.layers.querySegments, safetySegmentWhere, 'segment') : Promise.resolve(null),
          safetyMode ? querySafetyBase(mapApi.layers.queryIntersections, safetyIntersectionWhere, 'intersection') : Promise.resolve(null),
          safetyMode ? queryCrashesByYear(mapApi.layers.queryCrashes, currentCrashWhere, 'Segment') : Promise.resolve(null),
          safetyMode ? queryCrashesByYear(mapApi.layers.queryCrashes, currentCrashWhere, 'Junction') : Promise.resolve(null),
        ]);
        const [segmentYears, intersectionYears, segmentQualificationYears, intersectionQualificationYears] = await Promise.all([
          queryLinkedByYear(mapApi.layers.queryCrashes, segments.map((row) => row.id), 'assigned_segment_id', relationshipCrashWhere),
          queryLinkedByYear(mapApi.layers.queryCrashes, intersections.map((row) => row.id), 'assigned_junction_id', relationshipCrashWhere),
          queryLinkedByYear(mapApi.layers.queryCrashes, segments.map((row) => row.id), 'assigned_segment_id', qualificationCrashWhere),
          queryLinkedByYear(mapApi.layers.queryCrashes, intersections.map((row) => row.id), 'assigned_junction_id', qualificationCrashWhere),
        ]);
        if (cancelled) return;
        const periodSegments = periodNetworkRows(segments, segmentYears, filters.startYear, filters.endYear, segmentQualificationYears);
        const periodIntersections = periodNetworkRows(intersections, intersectionYears, filters.startYear, filters.endYear, intersectionQualificationYears);
        const [activeSegments, activeIntersections] = safetyMode ? await Promise.all([
          queryActiveSafetyRows(mapApi.layers.queryCrashes, mapApi.layers.querySegments, filters, 'segment'),
          queryActiveSafetyRows(mapApi.layers.queryCrashes, mapApi.layers.queryIntersections, filters, 'intersection'),
        ]) : [periodSegments, periodIntersections];
        if (cancelled) return;
        const selectedSegments = spatialSelection ? activeSegments.filter((row) => spatialSelection.segment.includes(Number(row.objectId))) : activeSegments;
        const selectedIntersections = spatialSelection ? activeIntersections.filter((row) => spatialSelection.intersection.includes(Number(row.objectId))) : activeIntersections;
        mapApi.setPeriodNetworkIds({
          segment: periodSegments.map((row) => row.objectId),
          intersection: periodIntersections.map((row) => row.objectId),
        });
        const selectedHinSegments = spatialSelection ? periodSegments.filter((row) => spatialSelection.segment.includes(Number(row.objectId))) : periodSegments;
        const selectedHinIntersections = spatialSelection ? periodIntersections.filter((row) => spatialSelection.intersection.includes(Number(row.objectId))) : periodIntersections;
        const linkedRoad = periodTotal(segmentYears, selectedHinSegments.map((row) => row.id), filters.startYear, filters.endYear);
        const linkedIntersection = periodTotal(intersectionYears, selectedHinIntersections.map((row) => row.id), filters.startYear, filters.endYear);
        const hinRoad = { ...aggregateNetworkRows(selectedHinSegments), ...linkedRoad };
        const hinIntersection = { ...aggregateNetworkRows(selectedHinIntersections), ...linkedIntersection };
        const roadCrash = safetyMode
          ? spatialSelection ? aggregateNetworkRows(selectedSegments) : { ...safetyRoadUnits, ...periodTotal(safetyRoadYears, ['Segment'], filters.startYear, filters.endYear) }
          : hinRoad;
        const intCrash = safetyMode
          ? spatialSelection ? aggregateNetworkRows(selectedIntersections) : { ...safetyIntersectionUnits, ...periodTotal(safetyIntersectionYears, ['Junction'], filters.startYear, filters.endYear) }
          : hinIntersection;
        setNetworkRows({
          segment: selectedSegments.map((row) => ({ ...row, networkMode: safetyMode ? 'safety' : 'hin' })),
          intersection: selectedIntersections.map((row) => ({ ...row, networkMode: safetyMode ? 'safety' : 'hin' })),
        });
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
  }, [filters, mapApi, yearMax, visible.safety, spatialSelection]);

  const impacts = useMemo(() => Object.fromEntries(['segment', 'intersection'].map((type) => {
    const grouped = new Map();
    for (const row of impactRows[type]) {
      const key = `${row.name.trim().toUpperCase()}|${row.city || ''}`;
      if (!grouped.has(key)) grouped.set(key, { key: `${type}|${key}`, type, name: row.name, city: row.city, ids: [], crashes: 0, fsi: 0, years: new Map() });
      const item = grouped.get(key); item.ids.push(row.id); item.crashes += row.crashes; item.fsi += row.fatalities + row.serious;
      for (const point of impactYears[type].get(String(row.id)) || []) item.years.set(point.year, (item.years.get(point.year) || 0) + point.fatal + point.serious);
    }
    return [type, [...grouped.values()].map((item) => ({ ...item, trend: classifyTrend([...item.years].map(([year, count]) => ({ year, count }))) })).sort((a, b) => b.fsi - a.fsi)];
  })), [impactRows, impactYears]);

  const focusImpact = async (item) => {
    const matching = impactRows[item.type].filter((row) => item.ids.includes(row.id));
    if (matching[0]) await mapApi?.focus({ ...matching[0], networkMode: 'safety' });
    setSelection({ type: item.type === 'segment' ? 'corridor' : 'impact', id: item.key, ids: item.ids, name: item.name, city: item.city, county: '', crashes: item.crashes, kaCrashes: item.fsi });
    setMobilePanel('map');
  };

  const exportRows = async (format) => {
    const kind = drawerTab;
    const periodRows = networkRows[kind];
    if (!periodRows.length) return;
    const source = kind === 'segment' ? mapApi.layers.querySegments : mapApi.layers.queryIntersections;
    const geometryRows = await queryNetworkRows(source, withObjectIds('1=1', periodRows.map((row) => row.objectId)), kind, true);
    const metrics = new Map(periodRows.map((row) => [row.objectId, row]));
    const rows = geometryRows.map((row) => ({ ...row, ...metrics.get(row.objectId), graphic: row.graphic }));
    await exportNetwork(format, rows.slice(0, 2000), kind);
  };

  const drawerRows = networkRows[drawerTab];
  const selectedFeatureCount = spatialSelection
    ? spatialSelection.segment.length + spatialSelection.intersection.length
    : selection ? 1 : 0;
  const hasNotice = mapStatus !== 'ready' || Boolean(analyticsError);
  const statusMessage = mapStatus === 'loading' ? 'The web map and ArcGIS layers are still loading.' : analyticsError || (mapStatus === 'ready' ? 'The map and network analytics are connected to the near-live NDOT and Iowa DOT database.' : String(mapStatus));
  return <main className={`app mobile-${mobilePanel}`}>
    <header className="topbar"><a className="brand-link" href="https://www.mapacog.org" target="_blank" rel="noreferrer" aria-label="Visit the MAPA website"><img src="./mapa-logo.png" alt="Metropolitan Area Planning Agency" /></a><div className="product-name"><span>Safety planning</span><h1>High Injury Network</h1></div><div className="top-actions"><div className="status-wrap" onMouseEnter={() => setStatusHovered(true)} onMouseLeave={() => setStatusHovered(false)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setStatusPinned(false); }}><button className={`status-button ${hasNotice ? 'notice' : ''}`} onClick={() => setStatusPinned((current) => !current)} onFocus={() => setStatusPinned(true)} onKeyDown={(event) => { if (event.key === 'Escape') { setStatusPinned(false); setStatusHovered(false); event.currentTarget.blur(); } }} aria-expanded={showStatus} aria-controls="data-status-popover"><CircleAlert size={16} />{mapStatus === 'loading' ? 'Loading data' : hasNotice ? 'Data notice' : 'Data is current'}</button>{showStatus && <div id="data-status-popover" className="status-popover"><strong>{hasNotice ? 'Data notice' : 'Data is current'}</strong><p>{statusMessage}</p><small>This control reports connection or query issues; it does not change the map.</small></div>}</div><ShareDialog filters={filters} visible={visible} /><button onClick={reset}><RefreshCcw size={17} />Reset filters</button><button className="mobile-menu" onClick={() => setMobilePanel(mobilePanel === 'filters' ? 'map' : 'filters')}><Menu size={22} /></button></div></header>
    <div className={`workspace ${leftCollapsed ? 'left-collapsed' : ''}`}>
      <aside className="left-panel"><nav><button className={leftTab === 'explore' ? 'active' : ''} onClick={() => setLeftTab('explore')}><Layers3 size={18} />Explore</button><button className={leftTab === 'filters' ? 'active' : ''} onClick={() => setLeftTab('filters')}><Filter size={18} />Filters</button></nav><div className="panel-scroll">{leftTab === 'explore' ? <ExplorePanel filters={filters} setFilters={setFilters} visible={visible} setVisible={setVisible} selection={selection} clearSelection={clearSelection} yearMax={yearMax} /> : <FiltersPanel filters={filters} setFilters={setFilters} />}</div></aside>
      <section className="map-panel"><button className="left-collapse" onClick={() => setLeftCollapsed((current) => !current)} aria-label={leftCollapsed ? 'Expand explore panel' : 'Collapse explore panel'}>{leftCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</button><MapCanvas filters={filters} selection={selection} visible={visible} onReady={setMapApi} onSelect={(record) => { if (!record) { setSelection(null); return; } const current = networkRows[record.type]?.find((row) => String(row.id) === String(record.id)); setSelection(current || { ...record, crashes: 0, kaCrashes: 0 }); if (window.innerWidth < 840) setMobilePanel('insights'); }} onSpatialSelect={setSpatialSelection} onStatus={setMapStatus} /><SelectionSummary count={selectedFeatureCount} onZoom={() => mapApi?.zoomSelection()} /><div className="map-key">{visible.hin && <><span><i className="line" />HIN roadway</span><span><i className="intersection" />HIN intersection</span></>}{visible.safety && <span><i className="safety" />Safety network</span>}{visible.crashes && <span><i className="crash" />Crash severity</span>}</div><DataDrawer open={drawerOpen} setOpen={setDrawerOpen} tab={drawerTab} setTab={setDrawerTab} rows={drawerRows} loading={analyticsLoading} onFocus={(row) => { mapApi?.focus(row); setSelection(row); }} onExport={exportRows} period={`${filters.startYear}–${filters.endYear}`} networkLabel={visible.safety ? 'All Safety Network' : 'High Injury Network'} /></section>
      <aside className="insights-panel"><div className="insights-scroll"><PerformancePanel performance={performance} loading={analyticsLoading} impacts={impacts} onFocusImpact={focusImpact} period={`${filters.startYear}–${filters.endYear}`} networkMode={visible.safety ? 'safety' : 'hin'} assignment={filters.assignment} selectionCount={spatialSelection ? spatialSelection.segment.length + spatialSelection.intersection.length : 0} /></div></aside>
    </div>
    <nav className="mobile-nav"><button className={mobilePanel === 'map' ? 'active' : ''} onClick={() => setMobilePanel('map')}><MapIcon size={21} />Map</button><button className={mobilePanel === 'filters' ? 'active' : ''} onClick={() => setMobilePanel('filters')}><SlidersHorizontal size={21} />Explore</button><button className={mobilePanel === 'insights' ? 'active' : ''} onClick={() => setMobilePanel('insights')}><BarChart3 size={21} />Insights</button><button className={drawerOpen ? 'active' : ''} onClick={() => { setDrawerOpen(true); setMobilePanel('map'); }}><Table2 size={21} />Data</button></nav>
  </main>;
}
