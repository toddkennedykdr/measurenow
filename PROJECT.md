# MeasureNow — K&D Roofing Measurement & Instant Quote App

## Vision
A single app that replaces both Hover (~$2,100/mo) and Roofle (TBD/mo) subscriptions with an owned, in-house solution.

## Two Modes

### 1. Customer-Facing (Website Widget) — Replaces Roofle
- Homeowner enters their address on kanddroofingnc.com
- App instantly pulls property/roof data and generates a ballpark roof replacement quote
- Captures the lead (name, email, phone) with the quote
- ~97% accurate based on satellite/property data
- 24/7 lead generation — customer gets a quote at any hour

### 2. Rep-Facing (iPhone App) — Replaces Hover
- Rep arrives at house, enters the address → gets the instant satellite measurement (same engine as website)
- Rep walks around the house with iPhone → LiDAR + camera scan → gets precise 3D measurements
- App shows BOTH measurements side by side
- App calculates the AVERAGE between satellite and LiDAR for best accuracy
- If measurements are wildly different, app flags it for manual review
- Generates quote with K&D branding on the spot

### 3. Smart Averaging
- Satellite measurement: fast, available before the rep even arrives
- LiDAR scan: precise, done on-site
- Average of both: more accurate than either alone
- Discrepancy detection: if the two differ by more than X%, flag for review

## Data Sources to Research
- **County tax records** — Wake County, Durham County, etc. have property data (roof sqft, lot size, year built)
- **Property data APIs** — ATTOM, Zillow, CoreLogic, Regrid, Estated
- **Google Maps / satellite imagery** — for aerial roof measurement
- **Apple ARKit / LiDAR** — for on-device 3D scanning
- **Photogrammetry libraries** — OpenCV, COLMAP, Apple RealityKit

## Tech Stack (TBD based on research)
- **Website widget:** React/Next.js (integrate into existing K&D site)
- **iOS app:** Swift + ARKit + LiDAR
- **Backend:** Node.js/Express or similar
- **Database:** PostgreSQL

## Phase 1 — Research Sprint (NOW)
1. What property/roof data APIs exist? Cost, accuracy, coverage for NC?
2. What can ARKit + LiDAR do for outdoor house scanning? Limitations?
3. What open-source photogrammetry tools exist?
4. What satellite/aerial imagery APIs are available?
5. How does Hover actually work (public info, patents, etc.)?
6. How does Roofle pull instant measurements?
7. Build a proof-of-concept: address → roof measurement using best available API

## Business Case
- Hover: ~$70/roof report × ~30 reports/mo = ~$2,100/mo = ~$25,200/yr
- Roofle: TBD/mo subscription
- Total savings: $25K+/year minimum
- If productized and sold to other roofing companies: potential revenue stream

## Owner
Todd Kennedy — K&D Roofing
Built by: Stack (coding agent) under Jake Miller's direction
