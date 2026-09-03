import { toCsv } from './utils.js';

export const NETWORK_COLUMNS = [
  { field: 'id', label: 'Network ID' },
  { field: 'name', label: 'Road / intersection' },
  { field: 'city', label: 'City' },
  { field: 'county', label: 'County' },
  { field: 'crashes', label: 'All-period crashes' },
  { field: 'kaCrashes', label: 'All-period fatal + serious crashes' },
  { field: 'fatalities', label: 'All-period fatalities' },
  { field: 'serious', label: 'All-period serious injuries' },
  { field: 'miles', label: 'Miles' },
  { field: 'speed', label: 'Posted speed' },
  { field: 'functionalClass', label: 'Functional class' },
  { field: 'lanes', label: 'Through lanes / legs' },
  { field: 'control', label: 'Traffic control' },
  { field: 'hin', label: 'HIN' },
];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function geometryToGeoJSON(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'point') return { type: 'Point', coordinates: [geometry.longitude ?? geometry.x, geometry.latitude ?? geometry.y] };
  if (geometry.type === 'polyline') {
    const paths = geometry.paths || [];
    return paths.length === 1 ? { type: 'LineString', coordinates: paths[0] } : { type: 'MultiLineString', coordinates: paths };
  }
  return null;
}

export function featuresToGeoJSON(graphics, kind) {
  return {
    type: 'FeatureCollection',
    name: kind === 'segment' ? 'hin_roads' : 'hin_intersections',
    features: graphics.map(({ graphic, ...properties }) => ({
      type: 'Feature',
      geometry: geometryToGeoJSON(graphic.geometry),
      properties: Object.fromEntries(Object.entries(properties).filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value))),
    })).filter((feature) => feature.geometry),
  };
}

export async function exportNetwork(format, records, kind) {
  const stem = `MAPA_HIN_${kind === 'segment' ? 'Roads' : 'Intersections'}`;
  if (format === 'csv') {
    downloadBlob(new Blob([toCsv(records, NETWORK_COLUMNS)], { type: 'text/csv;charset=utf-8' }), `${stem}.csv`);
    return;
  }
  const collection = featuresToGeoJSON(records, kind);
  if (format === 'shp') {
    const shpwrite = await import('@mapbox/shp-write');
    const blob = await shpwrite.zip(collection, { outputType: 'blob', compression: 'DEFLATE', types: { point: 'hin_points', polyline: 'hin_roads' } });
    downloadBlob(blob, `${stem}_Shapefile.zip`);
    return;
  }
  if (format === 'gpkg') {
    const [{ GeoPackageAPI, setSqljsWasmLocateFile }, { default: sqlWasmUrl }] = await Promise.all([
      import('@ngageoint/geopackage'),
      import('@ngageoint/geopackage/dist/sql-wasm.wasm?url'),
    ]);
    setSqljsWasmLocateFile(() => sqlWasmUrl);
    const geoPackage = await GeoPackageAPI.create();
    const gpkgFeatures = collection.features.map((feature) => {
      const { id, ...properties } = feature.properties;
      return { ...feature, properties: { ...properties, network_id: id } };
    });
    const propertyTypes = NETWORK_COLUMNS.map(({ field }) => ({ name: field === 'id' ? 'network_id' : field, dataType: ['crashes', 'kaCrashes', 'fatalities', 'serious', 'miles', 'functionalClass', 'hin'].includes(field) ? 'DOUBLE' : 'TEXT' }));
    geoPackage.createFeatureTableFromProperties(collection.name, propertyTypes);
    await geoPackage.addGeoJSONFeaturesToGeoPackage(gpkgFeatures, collection.name, false, 250);
    const bytes = await geoPackage.export();
    downloadBlob(new Blob([bytes], { type: 'application/geopackage+sqlite3' }), `${stem}.gpkg`);
  }
}
