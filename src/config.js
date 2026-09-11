export const WEBMAP_ID = 'e6e2ca7a346b4ef9852b64b95cd33b86';

export const MAP_EXTENT = {
  xmin: -96.3450244558656,
  ymin: 41.0526366488555,
  xmax: -95.6534168613733,
  ymax: 41.4048466621588,
  spatialReference: { wkid: 4326 },
};

export const LAYER_TITLES = {
  safetySegments: 'Safety - Segments',
  safetyIntersections: 'Safety Intersections',
  crashes: 'All Crashes 2018 to 2026',
  tmaBoundary: 'TMA Boundary',
  community: 'Community Safety Concerns',
};

export const SERVICE_URLS = {
  counties: 'https://services.arcgis.com/CHjpJeHqytL8t8op/arcgis/rest/services/Counties/FeatureServer/0',
  cities: 'https://services.arcgis.com/CHjpJeHqytL8t8op/arcgis/rest/services/City_Boundary/FeatureServer/27',
};

export const BRAND = {
  blue: '#007cab', grey: '#888c86', dark: '#4c4c4e', light: '#b9b9ba',
  coral: '#ff4540', yellow: '#fcbd33', teal: '#004b58', mint: '#83c8bb', peach: '#f9ac89',
};

export const YEAR_MIN = 2018;
export const YEAR_MAX = 2026;

export const SEVERITIES = [
  { value: 'K', label: 'Fatal', short: 'K', color: '#4c4c4e' },
  { value: 'A', label: 'Serious injury', short: 'A', color: '#ff4540' },
  { value: 'B', label: 'Minor injury', short: 'B', color: '#f9ac89' },
  { value: 'C', label: 'Possible injury', short: 'C', color: '#fcbd33' },
  { value: 'O', label: 'Property damage only', short: 'O', color: '#83c8bb' },
];

export const FUNCTIONAL_CLASSES = [
  { value: 1, label: 'Interstate' },
  { value: 2, label: 'Other freeway / expressway' },
  { value: 3, label: 'Other principal arterial' },
  { value: 4, label: 'Minor arterial' },
  { value: 5, label: 'Major collector' },
  { value: 6, label: 'Minor collector' },
  { value: 7, label: 'Local' },
  { value: 99, label: 'Not classified' },
];

export const DEFAULT_FILTERS = {
  startYear: YEAR_MIN,
  endYear: YEAR_MAX,
  severities: SEVERITIES.map(({ value }) => value),
  location: '',
  assignment: 'All',
  mode: 'All modes',
  crashStartDate: '',
  crashEndDate: '',
  months: [],
  transition: 'All times',
  people: { impaired: false, unrestrained: false, speeding: false, distracted: false, youngDriver: false },
  roads: { speeds: [], classes: [], intersectionTypes: [], controls: [] },
};

export const SPEED_OPTIONS = ['5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75'];
export const INTERSECTION_TYPES = ['2', '3', '3+', '4', '4+', '5'];
export const CONTROL_OPTIONS = [
  'All-way stop', 'One-way stop', 'Two-way stop', 'Three-way stop',
  'Signal', 'Signalized (with ped signal)', 'Signalized (without ped signal)',
  'Fixed Time', 'Fully Actuated', 'Semi-Actuated', 'Coordinated-Actuated',
  'Uncontrolled', 'Unknown',
];
