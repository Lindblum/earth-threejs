// Where the tiles come from: free, keyless, CORS-enabled XYZ tile services,
// all Web Mercator 256 px tiles. Each: { label, group, url(z, x, y),
// maxZoom (its finest; finer tiles stretch it, so world-scale sources such
// as Esri Physical and NASA's look soft up close), credit, and when its
// data is from: `date` (fixed), or `citations` (a service saying, for each
// place and zoom, which photo shows there and when it was taken) }.
//
// Esri's are asked with blankTile=false: a tile they haven't got is a 404,
// not a "no data" picture, so the coarser tile stretches over instead. The
// US Geological Survey's cover the United States only (elsewhere, the ocean
// blue). NASA's daily satellite view (VIIRS) is from two days ago, the
// latest whole day; it shows that day's clouds, and the gaps between passes.
// (Not Suomi-NPP's: its layer has had no data since 1 Nov 2026.)
//
// Elevation: AWS Terrain Tiles (Mapzen's Terrarium encoding: height in metres
// = R × 256 + G + B / 256 - 32768), to zoom 15 (about 5 m a pixel at the equator).

const esri = (service) => (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${z}/${y}/${x}?blankTile=false`;
const usgs = (service) => (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/${service}/MapServer/tile/${z}/${y}/${x}`;
const gibs = (layer, time, matrix, ext) => (z, x, y) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${time ? `${time}/` : ''}${matrix}/${z}/${y}/${x}.${ext}`;

/** Two days ago (UTC), YYYY-MM-DD: NASA's latest whole day of imagery. */
const DAILY = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

/** "22 Feb 2025", from YYYY-MM-DD or YYYYMMDD. */
export function formatDate(date) {
  const s = String(date).replace(/-/g, '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(s.slice(6, 8))} ${months[Number(s.slice(4, 6)) - 1]} ${s.slice(0, 4)}`;
}

const ESRI_CREDIT = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community';

export const IMAGERY = {
  esri: { label: 'Esri Satellite', group: 'photo', url: esri('World_Imagery'), maxZoom: 19, credit: `Imagery © ${ESRI_CREDIT}`, citations: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/4' },
  clarity: {
    label: 'Esri Clarity',
    group: 'photo',
    url: (z, x, y) => `https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`,
    maxZoom: 19,
    credit: `Imagery © ${ESRI_CREDIT} (Clarity: sharper, sometimes older)`,
    citations: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/4',
  },
  usgs: { label: 'USGS Aerial (US)', group: 'photo', url: usgs('USGSImageryOnly'), maxZoom: 16, credit: 'USGS The National Map: Orthoimagery (USDA NAIP)', date: 'NAIP, as of Jun 2024' },
  sentinel: {
    label: 'Sentinel-2 2023',
    group: 'photo',
    url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${z}/${y}/${x}.jpg`,
    maxZoom: 15,
    credit: 'Sentinel-2 cloudless 2023 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2023)',
    date: '2023 mosaic',
  },
  viirs: {
    label: 'NASA Daily',
    group: 'photo',
    // one satellite's day has gaps between its passes (black): filled from the next satellite's, in this order
    layers: [
      gibs('VIIRS_NOAA20_CorrectedReflectance_TrueColor', DAILY, 'GoogleMapsCompatible_Level9', 'jpeg'),
      gibs('VIIRS_NOAA21_CorrectedReflectance_TrueColor', DAILY, 'GoogleMapsCompatible_Level9', 'jpeg'),
      gibs('MODIS_Aqua_CorrectedReflectance_TrueColor', DAILY, 'GoogleMapsCompatible_Level9', 'jpeg'),
      gibs('MODIS_Terra_CorrectedReflectance_TrueColor', DAILY, 'GoogleMapsCompatible_Level9', 'jpeg'),
    ],
    maxZoom: 9,
    credit: `NASA GIBS: VIIRS (NOAA-20, NOAA-21) and MODIS (Aqua, Terra) true colour, ${DAILY}`,
    date: formatDate(DAILY),
  },
  bluemarble: { label: 'NASA Blue Marble', group: 'photo', url: gibs('BlueMarble_NextGeneration', null, 'GoogleMapsCompatible_Level8', 'jpeg'), maxZoom: 8, credit: 'NASA Blue Marble: Next Generation', date: '2004 composite' },
  blackmarble: { label: 'NASA Night Lights', group: 'photo', url: gibs('VIIRS_Black_Marble', '2016-01-01', 'GoogleMapsCompatible_Level8', 'png'), maxZoom: 8, credit: 'NASA Black Marble 2016 (VIIRS night lights)', date: '2016' },
  osm: { label: 'OpenStreetMap', group: 'map', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, maxZoom: 19, credit: '© OpenStreetMap contributors', date: 'live' },
  street: { label: 'Esri Streets', group: 'map', url: esri('World_Street_Map'), maxZoom: 19, credit: `Map © Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community` },
  topo: { label: 'Esri Topo', group: 'map', url: esri('World_Topo_Map'), maxZoom: 19, credit: `Map © Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors` },
  natgeo: { label: 'National Geographic', group: 'map', url: esri('NatGeo_World_Map'), maxZoom: 16, credit: 'Map © National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, increment P' },
  opentopo: { label: 'OpenTopoMap', group: 'map', url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`, maxZoom: 17, credit: 'Map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors, SRTM', date: 'OpenStreetMap, weekly' },
  usgstopo: { label: 'USGS Topo (US)', group: 'map', url: usgs('USGSTopo'), maxZoom: 16, credit: 'USGS The National Map: topographic' },
  ocean: { label: 'Esri Ocean', group: 'map', url: esri('Ocean/World_Ocean_Base'), maxZoom: 16, credit: 'Map © Esri, GEBCO, NOAA, National Geographic, Garmin, HERE' },
  physical: { label: 'Esri Physical', group: 'map', url: esri('World_Physical_Map'), maxZoom: 8, credit: 'Map © Esri, US National Park Service' },
};
export const IMAGERY_IDS = Object.keys(IMAGERY);

export const ELEVATION = {
  url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  maxZoom: 15,
  credit: 'Terrain: Mapzen Terrain Tiles on AWS (SRTM, GMTED2010, ETOPO1 and others)',
};

export const CLOUDS = {
  // NOAA's Global Mosaic of Geostationary Satellite Imagery (GOES, Meteosat, Himawari), longwave
  // infrared, hourly: one world image (latitude / longitude), brighter where colder (see the tile worker's clouds)
  url: (width) =>
    `https://nowcoast.noaa.gov/geoserver/satellite/wms?service=WMS&version=1.3.0&request=GetMap&layers=global_longwave_imagery_mosaic&styles=&crs=EPSG:4326&bbox=-90,-180,90,180&width=${width}&height=${width / 2}&format=image/png&transparent=true`,
  refreshS: 1200, // asked again this often (a new mosaic each hour)
  credit: 'Clouds: NOAA GMGSI infrared (GOES, Meteosat, Himawari) via nowCOAST',
};

/** Who to credit for what's showing. */
export function credits(imagery, terrain, clouds = false) {
  return [IMAGERY[imagery]?.credit, terrain ? ELEVATION.credit : null, clouds ? CLOUDS.credit : null].filter(Boolean).join(' · ');
}

const dateCache = new Map(); // `${source}/${zoom}/${lat}/${lon}` (rounded) -> Promise<string | null>

/**
 * When `imagery`'s data at (lat, lon) (degrees), shown at `zoom`, is from: a
 * fixed date, or (Esri's photos) asked of its citations: the photo there at
 * that zoom, "22 Feb 2025 (Vantor Vivid Advanced, 0.34 m)". Null if unknown.
 */
export function imageryDate(imagery, lat, lon, zoom) {
  const source = IMAGERY[imagery];
  if (!source) return Promise.resolve(null);
  if (!source.citations) return Promise.resolve(source.date ?? null);
  const key = `${imagery}/${zoom}/${lat.toFixed(2)}/${lon.toFixed(2)}`;
  let entry = dateCache.get(key);
  if (!entry) {
    const url = `${source.citations}/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE,SRC_RES,NICE_NAME,NICE_DESC,MinMapLevel,MaxMapLevel&returnGeometry=false&f=json`;
    entry = fetch(url, { credentials: 'omit' })
      .then((r) => r.json())
      .then((json) => {
        const at = (json.features ?? []).map((f) => f.attributes).filter((a) => a.MinMapLevel <= zoom && zoom <= a.MaxMapLevel);
        const a = at.sort((p, q) => q.MinMapLevel - p.MinMapLevel)[0];
        if (!a) return null;
        const what = [a.NICE_DESC, a.NICE_NAME].filter(Boolean).join(' ');
        const res = a.SRC_RES ? `${a.SRC_RES} m` : '';
        const detail = [what, res].filter(Boolean).join(', ');
        return a.SRC_DATE ? `${formatDate(a.SRC_DATE)}${detail ? ` (${detail})` : ''}` : detail || null;
      })
      .catch(() => {
        dateCache.delete(key); // (asked again later)
        return null;
      });
    dateCache.set(key, entry);
  }
  return entry;
}
