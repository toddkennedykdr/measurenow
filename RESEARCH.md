# MeasureNow — Research & API Landscape

> **Last Updated:** 2026-02-23  
> **Purpose:** Drive architecture decisions for the MeasureNow app — an instant roof measurement tool for K&D Roofing  
> **App Concept:** (1) Customer enters address on website → instant roof quote (replaces Roofle at ~$500/mo), (2) Rep uses iPhone LiDAR on-site → precise measurements (replaces Hover at $70/report). App averages both for best accuracy.

---

## Table of Contents
1. [Property/Roof Data APIs](#1-propertyroof-data-apis)
2. [Google Solar API (Deep Dive)](#2-google-solar-api-deep-dive)
3. [Satellite/Aerial Imagery APIs](#3-satelliteaerial-imagery-apis)
4. [Apple ARKit + LiDAR for Outdoor Scanning](#4-apple-arkit--lidar-for-outdoor-scanning)
5. [How Hover Works](#5-how-hover-works)
6. [How Roofle Works](#6-how-roofle-works)
7. [Proof of Concept Recommendation](#7-proof-of-concept-recommendation)

---

## 1. Property/Roof Data APIs

### Google Solar API ⭐ **TOP PICK**
- **What it provides:** Roof segment geometry, pitch/azimuth per segment, total roof area (m²), building center/bounding box, imagery quality levels, digital surface model
- **Data returned per building:** `solarPotential.roofSegmentStats[]` with area, pitch, azimuth, planeHeight for EACH roof segment; `maxArrayAreaMeters2` (total usable roof area); `wholeRoofStats` with total area and sunshine hours
- **Pricing:** Pay-as-you-go via Google Cloud. Building Insights is "Essentials" tier. ~$5-7 per 1,000 requests (based on GMP Environment pricing). Google offers $200/mo free credit for Maps Platform.
- **Accuracy:** HIGH quality = 0.1m/pixel from low-altitude aerial; MEDIUM = 0.25m/pixel; BASE = 0.25m/pixel from satellite
- **NC Coverage:** US has extensive coverage. NC metro areas (Charlotte, Raleigh, etc.) likely HIGH quality. Rural areas may be MEDIUM/BASE. Coverage map available at Google's docs.
- **Free tier:** $200/mo GMP credit covers ~28,000-40,000 Building Insights requests/month — **more than enough for a roofing company**
- **Verdict:** 🔥 **This is the primary API for Mode 1 (instant quote by address).** It literally provides roof segment areas, pitch, and azimuth — everything needed for a roofing estimate.

### ATTOM Data
- **What it provides:** 158M+ US properties. Property details including square footage, lot size, building area, year built, stories, ownership, sales history, tax data. Covers 99% of US population.
- **Roof-specific data:** Building square footage and stories (can estimate roof footprint), but does NOT provide roof pitch, segments, or actual roof area. Limited for roofing use.
- **Pricing:** Enterprise/custom pricing. Free trial API key available for sandbox testing. Expect $500-2,000+/mo for production use depending on volume.
- **NC Coverage:** Excellent — nationwide county assessor data.
- **Verdict:** Useful for property enrichment (owner info, value, year built) but NOT a roof measurement source. Could supplement for lead qualification.

### Estated (Now ATTOM)
- **What it provides:** Was a simpler property data API — building area, lot size, year built, bedrooms/bathrooms, owner info. Clean REST API.
- **Status:** ⚠️ **Acquired by ATTOM in 2024.** API keys still work but documentation being deprecated in 2026. Migrating to ATTOM infrastructure.
- **Pricing:** Was ~$0.10-0.50 per lookup. Now folded into ATTOM pricing.
- **Verdict:** Skip — use ATTOM directly if property enrichment needed.

### Regrid (Parcel Data)
- **What it provides:** Nationwide parcel boundaries/polygons, ownership data, building footprints, zoning, standardized addresses. 155M+ parcels.
- **Roof-specific data:** Building footprint polygons (2D outline of structure) — gives roof footprint area but NOT pitch or 3D geometry.
- **Pricing:** Self-serve API with 30-day free sandbox. Production pricing is enterprise/custom. Raster and vector tile APIs available.
- **NC Coverage:** Nationwide including all NC counties.
- **Verdict:** Building footprints could provide a fallback roof area estimate (flat/2D). Useful if Google Solar API doesn't cover a specific address.

### CoreLogic
- **What it provides:** The largest property data provider. Building characteristics, square footage, roof type/material from assessor records.
- **Roof-specific data:** Some assessor records include "roof type" (e.g., gable, hip) and "roof material" (shingle, metal) but NOT measurements.
- **Pricing:** Enterprise-only. Typically $10K+/year minimum contracts. Not suitable for a small company MVP.
- **NC Coverage:** Excellent.
- **Verdict:** Overkill and expensive for our use case. Skip for MVP.

### Zillow API (Bridge API)
- **What it provides:** Property details, Zestimate values, comparable sales. Building square footage and lot size.
- **Roof-specific data:** None. Building sq ft only.
- **Pricing:** Free for limited use but strict terms of service — data must be displayed alongside Zillow branding.
- **Verdict:** Not useful for roof measurements. Skip.

### Summary Table

| API | Roof Area | Pitch | Segments | Cost/Query | Free Tier | NC Coverage |
|-----|-----------|-------|----------|------------|-----------|-------------|
| **Google Solar** | ✅ Yes | ✅ Yes | ✅ Yes | ~$0.005-0.007 | $200/mo credit | ✅ Good |
| ATTOM | ❌ Building sqft only | ❌ | ❌ | ~$0.10-0.50 | Trial only | ✅ |
| Regrid | ⚠️ Footprint only | ❌ | ❌ | Custom | 30-day sandbox | ✅ |
| CoreLogic | ❌ | ❌ | ❌ | Enterprise | ❌ | ✅ |
| Zillow | ❌ | ❌ | ❌ | Free (restricted) | ✅ | ✅ |

---

## 2. Google Solar API (Deep Dive)

### Why This Is Our Primary Data Source

The Google Solar API was built for solar installers but returns **exactly the data roofers need**: roof area per segment, pitch (tilt angle), azimuth (direction), and building dimensions. It's the only affordable API that provides actual 3D roof geometry.

### Endpoints

#### `buildingInsights:findClosest`
```
GET https://solar.googleapis.com/v1/buildingInsights:findClosest
  ?location.latitude=35.7796
  &location.longitude=-78.6382
  &requiredQuality=HIGH
  &key=YOUR_API_KEY
```

**Response includes:**
```json
{
  "center": {"latitude": 35.7796, "longitude": -78.6382},
  "boundingBox": {"sw": {...}, "ne": {...}},
  "postalCode": "27601",
  "administrativeArea": "NC",
  "solarPotential": {
    "maxArrayAreaMeters2": 150.5,
    "roofSegmentStats": [
      {
        "pitchDegrees": 22.5,
        "azimuthDegrees": 180.0,
        "stats": {
          "areaMeters2": 85.3,
          "sunshineQuantiles": [...]
        },
        "center": {"latitude": ..., "longitude": ...},
        "boundingBox": {...},
        "planeHeightAtCenterMeters": 5.2
      },
      // ... more segments
    ],
    "wholeRoofStats": {
      "areaMeters2": 195.7,
      "sunshineQuantiles": [...]
    },
    "maxSunshineHoursPerYear": 1450,
    "buildingStats": {
      "areaMeters2": 195.7
    }
  },
  "imageryQuality": "HIGH"
}
```

**Key fields for roofing:**
- `roofSegmentStats[].stats.areaMeters2` — Area of each roof face in m² (convert to sq ft × 10.764)
- `roofSegmentStats[].pitchDegrees` — Pitch of each segment (needed for material calculation — steeper = more material)
- `roofSegmentStats[].azimuthDegrees` — Direction each face points
- `wholeRoofStats.areaMeters2` — Total roof area
- `maxArrayAreaMeters2` — Usable roof area (excludes obstructions)

#### `dataLayers`
Returns URLs for GeoTIFF rasters:
- **Digital Surface Model (DSM)** — 3D height map of the building
- **RGB aerial imagery** — Actual aerial photo
- **Annual/monthly flux maps** — Sunshine data
- **Hourly shade data**

The DSM could theoretically be processed to extract even more precise roof geometry.

#### `geoTiff`
Fetches the actual raster files from dataLayers URLs.

### Pricing Details
- **Building Insights:** Essentials tier — based on GMP pricing, approximately $5-7 per 1,000 requests
- **Data Layers:** Enterprise tier — more expensive, ~$10-15 per 1,000 requests  
- **$200/mo free credit** applies to both
- At ~$0.005/request, K&D could do **40,000 lookups/month for free**
- Rate limit: 600 queries/minute

### Coverage & Accuracy for NC
- US has broad coverage with ongoing expansion
- Quality levels: HIGH (0.1m/pixel), MEDIUM (0.25m/pixel), BASE (0.25m/pixel satellite)
- NC metro areas (Charlotte, Raleigh, Greensboro, Winston-Salem, Fayetteville) likely have HIGH quality
- Rural areas may have MEDIUM or BASE
- If `requiredQuality=HIGH` returns 404, fall back to `MEDIUM` then `BASE`

### Can It Replace Roofle?
**YES.** Google Solar API provides more granular data than what Roofle likely uses:
- Individual roof segment areas with pitch
- Total roof area (not just building footprint)
- 3D geometry data via dataLayers

Roofle charges ~$500/mo for their widget. Google Solar API would cost K&D essentially **$0/month** under the free credit tier for their volume.

---

## 3. Satellite/Aerial Imagery APIs

### Nearmap
- **What it provides:** High-resolution aerial imagery (5.5-7.5cm/pixel), captured multiple times per year. AI-powered roof attribute extraction: roof area, material type, condition, slope.
- **Roof data:** Nearmap AI can extract roof area, material, condition score, number of stories, solar panel presence. Their "Betterview" product (acquired) specifically targets insurance/roofing.
- **Pricing:** Enterprise-only. Typically $10K-50K+/year depending on coverage area. Not suitable for MVP.
- **NC Coverage:** Good coverage in metro areas; frequency varies.
- **Verdict:** Best aerial imagery provider but way too expensive for a small roofing company. Revisit at scale.

### Google Earth / Maps Static API
- **What it provides:** Satellite imagery at various zoom levels. Can get top-down view of any property.
- **Roof measurement:** Cannot directly calculate area from imagery alone — need to combine with building footprint data or manual measurement.
- **Pricing:** Static Maps: $2/1,000 requests (10K free/mo). Maps SDK: free.
- **Verdict:** Useful for displaying property image to customer, but not for measurement. Pair with Solar API data.

### Bing Maps / Microsoft
- **What it provides:** "Bird's eye" oblique aerial imagery from multiple angles. Higher resolution than Google in some areas.
- **Roof measurement:** No direct measurement API. Could theoretically use oblique views for visual reference.
- **Pricing:** Free tier available for development. 
- **Verdict:** Nice supplementary imagery but no measurement capability.

### Mapbox
- **What it provides:** Satellite tiles, building footprints (from OpenStreetMap), customizable maps.
- **Roof measurement:** Building footprint polygons available but no height/pitch data.
- **Pricing:** 200K free tile requests/mo. Generous free tier.
- **Verdict:** Good for map display in the app UI. Not for measurements.

### Summary: For Imagery Display
Use **Google Maps Static API** or **Mapbox** to show the customer an aerial view of their property alongside the quote. The actual measurements come from Google Solar API.

---

## 4. Apple ARKit + LiDAR for Outdoor Scanning

### Device Requirements
- **LiDAR Scanner:** iPhone 12 Pro and later (Pro models only), iPad Pro (2020+)
- **LiDAR Range:** Up to ~5 meters (16 feet) effectively. This is the key limitation for exterior scanning.

### Capabilities for Exterior House Scanning

#### What Works
- **Close-range facade scanning:** Walking around the house capturing walls, windows, doors at close range (<5m)
- **Ground-level dimensions:** Foundation width, wall heights up to ~16 feet
- **Detail capture:** Window sizes, door dimensions, siding patterns
- **Point cloud generation:** Dense 3D point cloud of scanned surfaces

#### Key Limitations ⚠️
- **5m range limit is the killer:** Cannot scan a roof from ground level — the LiDAR beam can't reach the peak of a 2-story house from the ground
- **No overhead scanning:** Would need to be directly under/near the roof to scan it. Impossible for most residential roofs.
- **Outdoor lighting:** Bright sunlight degrades LiDAR accuracy (infrared interference)
- **Large-scale tracking:** ARKit's world tracking can drift over large areas (walking around an entire house)
- **No GPS precision:** ARKit tracks relative position, not absolute coordinates

#### RoomPlan Framework
- Designed for **indoor** scanning only. Creates floor plans of rooms.
- NOT suitable for exterior scanning — it expects walls, floors, ceilings in a room context
- Cannot handle outdoor/open spaces

#### RealityKit + ARKit
- Better for outdoor use — provides raw point clouds and mesh
- `ARMeshClassification` can identify floors, walls, ceilings, but is indoor-optimized
- Can build mesh of house exterior surfaces within LiDAR range
- Would need custom processing to extract dimensions from mesh

#### Relevant Open-Source iOS Projects
- **3d-scanner-app** (by Laan Labs) — General-purpose LiDAR scanning, exports point clouds/meshes
- **ScanKit** — Open-source scanning framework
- **Polycam** (commercial but informative) — Room and object scanning, shows what's possible
- **Record3D** — Streams LiDAR data for processing on desktop
- **ARPointCloud** — Sample projects for point cloud capture

### Realistic Assessment for Roofing

**LiDAR alone CANNOT reliably measure a full roof from the ground.** The 5m range means you can capture:
- ✅ Wall heights and widths
- ✅ Eave/soffit areas
- ✅ Ground-level footprint
- ❌ Roof peak height (too far)
- ❌ Roof surface area (can't see/reach it)
- ❌ Individual roof segment dimensions

**Hybrid approach (recommended for Mode 2):**
1. Use LiDAR to capture the building footprint and wall heights
2. Use photogrammetry (multiple photos) to reconstruct the roof — this is what Hover does
3. Combine LiDAR ground truth with photo-derived roof geometry
4. OR: Use LiDAR for ground dimensions + Google Solar API for roof geometry = complete picture

---

## 5. How Hover Works

### Technology Overview
Hover uses **smartphone photogrammetry** (not LiDAR) to create 3D models of building exteriors.

### Process
1. **User takes 8-12 photos** of the house exterior from different angles using the Hover app
2. Photos are uploaded to Hover's cloud servers
3. **Computer vision + photogrammetry pipeline** reconstructs a 3D model:
   - Feature detection and matching across photos
   - Structure from Motion (SfM) to estimate camera positions
   - Multi-View Stereo (MVS) to create dense 3D reconstruction
   - AI-powered segmentation to identify building components (roof, walls, windows, etc.)
4. Automated measurement extraction from the 3D model
5. Results delivered within minutes to hours (depends on complexity)

### What They Deliver
- 3D model of the entire exterior
- Roof area (total and per face)
- Roof pitch per face
- Wall areas
- Window and door dimensions
- Eave lengths, rake lengths
- All measurements in a structured report

### Pricing
- **$70 per property report** for contractors
- Volume discounts available
- Enterprise pricing for large operations

### Key Patents & IP
- Hover holds patents around automated exterior measurement from photos
- Key innovation: their training data and ML models for building segmentation
- They've processed millions of homes, giving them a massive training advantage

### Why It's Expensive
- Cloud GPU processing for photogrammetry
- Human QA review on many reports
- Massive R&D investment in ML models
- Market positioning as premium solution

### What We Can Learn
- Photogrammetry from phone photos IS viable for exterior measurement
- The hard part is the ML pipeline, not the photo capture
- For our MVP, we don't need to replicate this — Google Solar API gives us roof data, and LiDAR gives us wall data

---

## 6. How Roofle Works

### Technology
Roofle provides "instant roof quotes" when a homeowner enters their address. Here's what's happening behind the scenes:

### Data Sources (Likely)
1. **Aerial/satellite imagery measurement databases** — Pre-computed roof measurements from aerial imagery analysis (likely from providers like EagleView, GAF QuickMeasure, or similar)
2. **County assessor/parcel data** — Building square footage, year built, stories
3. **Possibly Google Solar API or similar** — For roof geometry
4. **Pre-computed measurement databases** — Companies like EagleView have already measured millions of US roofs from aerial imagery and sell access to this data

### How the Instant Quote Works
1. Customer enters address on Roofle-powered widget on contractor's website
2. Address is geocoded to lat/lng
3. Roof measurement data is pulled from pre-computed database or API
4. Contractor's pricing (per sq ft, material costs, labor) is applied
5. Instant quote displayed with material options

### Roofle's Business Model
- SaaS subscription for roofing contractors: ~$300-600/month
- Widget embeds on contractor's website
- Handles measurement lookup + quote generation + lead capture
- Partners with manufacturers (GAF, Owens Corning) for material pricing

### What This Means for MeasureNow
We can replicate Roofle's core functionality with:
1. **Google Solar API** for roof measurements (free under $200/mo credit)
2. **Google Geocoding API** to convert address → lat/lng
3. **Simple pricing engine** with K&D's rates per square/material
4. **Web widget** embedded on K&D's website

**Total monthly cost: ~$0** vs Roofle's ~$500/mo subscription.

---

## 7. Proof of Concept Recommendation

### Phase 1: Instant Quote by Address (Mode 1) — 2-3 weeks

This replaces Roofle and is the fastest path to value.

#### Architecture
```
[K&D Website] → [MeasureNow Web App] → [Google Solar API]
                                      → [Google Geocoding API]
                                      → [Pricing Engine]
```

#### Stack
- **Frontend:** Next.js or simple React app (embed as widget on K&D site)
- **Backend:** Node.js API (can run on Railway alongside kd-comms)
- **APIs needed:**
  - Google Geocoding API (address → lat/lng) — free tier covers it
  - Google Solar API buildingInsights (lat/lng → roof data) — free tier covers it
  - Google Maps Static API (show aerial image) — free tier covers it

#### Flow
1. Customer enters address
2. Geocode address → lat/lng
3. Call Solar API `buildingInsights:findClosest` with lat/lng
4. Extract: total roof area, segment details, pitch per segment
5. Convert m² → sq ft (× 10.764)
6. Calculate roofing squares (÷ 100)
7. Apply K&D pricing per square by material type
8. Display: roof size, material options, price ranges
9. Capture lead (name, email, phone) → push to JobNimbus

#### Estimated Costs
- Google Cloud APIs: **$0/mo** (under $200 free credit)
- Hosting: **$0** (add to existing Railway deployment)
- Development: **2-3 weeks**

### Phase 2: LiDAR On-Site Scanning (Mode 2) — 6-8 weeks

This replaces Hover for on-site measurements.

#### Realistic Approach (Not Full Photogrammetry)
Building a full Hover clone is a multi-year, multi-million dollar effort. Instead:

**Option A: LiDAR + Solar API Hybrid (Recommended)**
1. iOS app captures building exterior with LiDAR
2. Extract: building footprint, wall heights, eave heights
3. Pull Google Solar API data for roof geometry (pitch, segments, area)
4. Combine LiDAR ground-truth with Solar API roof data
5. Generate measurement report

**Option B: Photo-based with Open Source**
1. Capture 8-12 photos of house
2. Use open-source photogrammetry (OpenCV, COLMAP) for 3D reconstruction
3. Extract measurements from point cloud
4. This is harder and less reliable without Hover's ML models

#### Recommended: Option A
- iOS app (Swift/SwiftUI) with ARKit LiDAR scanning
- Server-side processing to merge LiDAR + Solar API data
- Much simpler than building photogrammetry pipeline
- Accuracy: Solar API roof data is already quite good; LiDAR adds ground-level precision

### Phase 3: Accuracy Averaging — After Phase 1+2

Average Mode 1 (Solar API) and Mode 2 (LiDAR + Solar API) measurements:
- If both are within 5%, use Solar API (cheaper, faster)
- If >5% variance, flag for manual review
- Build accuracy tracking over time

### Priority & Timeline

| Phase | What | Replaces | Savings | Timeline | Effort |
|-------|------|----------|---------|----------|--------|
| **1** | Web quote widget | Roofle ($500/mo) | $6K/year | 2-3 weeks | Medium |
| **2** | iOS LiDAR app | Hover ($70/report × ~50/mo = $3,500/mo) | $42K/year | 6-8 weeks | High |
| **3** | Accuracy engine | Manual QA | Time savings | 2 weeks | Low |

### Immediate Next Steps
1. ✅ Set up Google Cloud project with Solar API enabled
2. ✅ Get API key, test `buildingInsights` with a K&D customer address in NC
3. ✅ Validate data quality — does it return good segment data for NC homes?
4. ✅ Build simple Node.js API that takes address → returns roof measurements + quote
5. ✅ Build minimal frontend widget
6. ✅ Embed on K&D website

### Key Risk: Google Solar API Coverage Gaps
- Some rural NC addresses may not have HIGH quality data
- **Mitigation:** Fall back to MEDIUM/BASE quality; supplement with building footprint × assumed pitch multiplier
- Test with 20-30 K&D customer addresses across their service area to validate coverage

---

## Appendix: API Quick Reference

### Google Solar API
```
Endpoint: https://solar.googleapis.com/v1/buildingInsights:findClosest
Auth: API key or OAuth
Params: location.latitude, location.longitude, requiredQuality (HIGH|MEDIUM|BASE)
Returns: Roof segments with area (m²), pitch (degrees), azimuth, building center/bounds
Pricing: ~$0.005/request, $200/mo free credit
Rate limit: 600 req/min
Docs: https://developers.google.com/maps/documentation/solar/overview
```

### Google Geocoding API
```
Endpoint: https://maps.googleapis.com/maps/api/geocode/json
Auth: API key
Params: address (string)
Returns: lat/lng, formatted address, place_id
Pricing: $5/1,000 requests, 10K free/mo (under $200 credit)
```

### Google Maps Static API
```
Endpoint: https://maps.googleapis.com/maps/api/staticmap
Auth: API key
Params: center, zoom, size, maptype=satellite
Returns: Satellite image of property
Pricing: $2/1,000 requests, 10K free/mo
```
