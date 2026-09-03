# MAPA High Injury Network

A focused web application for exploring the Metropolitan Area Planning Agency (MAPA) High Injury Network (HIN), the broader safety network, and regional crash records.

This is a new, independent application. The existing [`mapacog/hpn-tool`](https://github.com/mapacog/hpn-tool) repository is a read-only reference and is not modified by this project.

## Scope

Included:

- HIN segments and intersections derived from the `HIN` field in the safety network
- Optional, interactive all-safety-network roads and intersections
- HIN-only startup view; the all-safety network and crash records are opt-in layers
- Unlabeled crash clustering prioritized by the most severe member (K, A, B, C, then O), resolving to individual severity symbols as the user zooms in
- Unified county/city location filter with boundary display and automatic zoom
- Safer People and Safer Roads cross-sectional filters
- Searchable HIN corridor ranking with K+A totals and trend direction
- Annual crash trend, crash-severity, injury-outcome, contributing-factor, and road-user views
- Full network performance: roadway/intersection crash shares, fatalities and serious injuries, coverage, capture, and relative rates
- Corridor/feature focus: selecting a HIN feature filters related crash records
- Filtered safety-network road/intersection table
- CSV, zipped Shapefile, and GeoPackage exports
- Responsive desktop and mobile-native layouts

Explicitly excluded:

- Scoring tools or score thresholds
- High Priority Network (HPN)
- High Risk Network (HRN)

## Data

The app reads MAPA's public ArcGIS Online services at runtime through the web map:

- **Web map:** `e6e2ca7a346b4ef9852b64b95cd33b86` — *PM1: MAPA HIN Network (2018 to 2026)*
- **Safety network:** segments and intersections; its `HIN` flag is the HIN source of truth
- **Crash records:** 2018–2026

The interface reports the source as a near-live NDOT and Iowa DOT database connection. Routine service updates do not require rebuilding the app as long as layer titles and schemas remain compatible.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite (normally `http://127.0.0.1:5173`).

## Verify

```bash
npm test
npm run build
npm run preview
```

The production output is written to `dist/`.

## Analysis periods

Network performance defaults to the complete available service period, currently **2018–2026**. The app reads the maximum crash year at runtime so a future 2027 update is offered automatically.

## Corridor trend method

Corridors are assembled from HIN segment records sharing a street and city. Rank is based on fatal and serious injuries. Trend compares **2021–2025** with **2018–2022**; the partial 2026 year is intentionally excluded from the trend calculation.

## GitHub Pages

Published app: **https://mapacog.github.io/HIN/**

The included workflow builds, tests, and deploys the Vite output to GitHub Pages whenever changes reach `main`.
