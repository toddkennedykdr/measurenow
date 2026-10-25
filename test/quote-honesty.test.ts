import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AddressInfo } from 'node:net';
import express from 'express';
import session from 'express-session';
import { QuoteResult } from '../src/components/QuoteResult';
import { RoofDiagram } from '../src/components/RoofDiagram';
import { ThankYou } from '../src/components/ThankYou';
import type { FullQuoteData } from '../src/types';
import { JN_API_KEY_DUMMY } from './allowed-literals';
import { mountRoofRoutes } from '../server/mountRoof';
import { getBuildingInsights } from '../server/services/solar';
import {
  AI_ESTIMATE_LABEL,
  DIAGRAM_ESTIMATE_NOTE,
  FT_PER_DEG_LAT,
  HIGH_QUALITY_MISS_WARNING,
  MULTI_BUILDING_WARNING,
  PARCEL_AREA_WARNING,
  assessQuoteHonesty,
  honestyEmailFragment,
  imageryDateFromSolar,
  formatImageryDate,
  readSegmentBox,
  satelliteImageryCaption,
  type HonestyInput,
  type SegmentBox,
} from '../server/services/quoteHonesty';

const LAT = 35.78;
const LNG = -78.64;

function squareAt(lat: number, lng: number, halfFt: number): SegmentBox {
  const latDelta = halfFt / FT_PER_DEG_LAT;
  const lngDelta = halfFt / (FT_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return {
    sw: { lat: lat - latDelta, lng: lng - lngDelta },
    ne: { lat: lat + latDelta, lng: lng + lngDelta },
  };
}

function eastLng(lat: number, lng: number, eastFt: number): number {
  return lng + eastFt / (FT_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
}

function honesty(overrides: Partial<HonestyInput> = {}): HonestyInput {
  return {
    measuredRoofSqFt: 2000,
    imageryQuality: 'HIGH',
    imageryDate: null,
    segmentBoxes: [],
    wholeRoofAreaSqFt: 2000,
    wholeRoofGroundSqFt: 1800,
    buildingGroundSqFt: 1800,
    parcelBuildingSqFt: null,
    ...overrides,
  };
}

function solarBox(box: SegmentBox) {
  return {
    sw: { latitude: box.sw.lat, longitude: box.sw.lng },
    ne: { latitude: box.ne.lat, longitude: box.ne.lng },
  };
}

function quoteData(overrides: Partial<FullQuoteData['roofData']> = {}): FullQuoteData {
  return {
    address: '123 Main St, Raleigh, NC',
    lat: LAT,
    lng: LNG,
    roofData: {
      totalAreaSqFt: 2153,
      segments: 2,
      avgPitchDegrees: 22.5,
      imageryQuality: 'HIGH',
      estimatedLength: 40,
      estimatedWidth: 30,
      imageryDateLabel: null,
      warnings: [],
      ...overrides,
    },
    quote: {
      roofSquares: 24.8,
      totalAreaSqFt: 2153,
      wasteFactor: 1.15,
      lowEstimate: 11200,
      highEstimate: 13800,
      avgPitchDegrees: 22.5,
      pitchCategory: 'Standard',
      pitchOver12: 5,
      materialNote: 'Architectural shingles',
    },
  };
}

const savedFetch = globalThis.fetch;
const savedSolarKey = process.env.GOOGLE_SOLAR_API_KEY;
let solarPayload: unknown = { imageryQuality: 'HIGH', solarPotential: { roofSegmentStats: [] } };
const resendBodies: string[] = [];

function installFetchMock() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return savedFetch(input, init);
    }
    if (url.hostname === 'solar.googleapis.com' && url.pathname === '/v1/buildingInsights:findClosest') {
      return Response.json(solarPayload);
    }
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      resendBodies.push(typeof init?.body === 'string' ? init.body : '');
      return Response.json({ id: 'email_test' });
    }
    throw new Error(`blocked outbound ${url.hostname}${url.pathname}`);
  };
}

before(() => {
  process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
  installFetchMock();
});

after(() => {
  globalThis.fetch = savedFetch;
  if (savedSolarKey === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
  else process.env.GOOGLE_SOLAR_API_KEY = savedSolarKey;
});

describe('quote honesty', { concurrency: false }, () => {
  it('reads a solar imagery date and ignores a missing or impossible one', () => {
    assert.deepEqual(imageryDateFromSolar({ year: 2021, month: 4, day: 6 }), { year: 2021, month: 4, day: 6 });
    assert.equal(formatImageryDate(imageryDateFromSolar({ year: 2021, month: 4, day: 6 })), 'April 6, 2021');
    assert.equal(formatImageryDate(imageryDateFromSolar({ year: 2021, month: 4, day: 0 })), 'April 2021');
    assert.equal(formatImageryDate(imageryDateFromSolar({ year: 2021, month: 0, day: 0 })), '2021');
    assert.equal(imageryDateFromSolar({ year: 2021, month: 2, day: 31 }), null);
    assert.equal(imageryDateFromSolar({ year: 2021, month: 13, day: 1 }), null);
    assert.equal(imageryDateFromSolar({ year: 0, month: 4, day: 6 }), null);
    assert.equal(imageryDateFromSolar(null), null);
    assert.equal(formatImageryDate(null), null);
    assert.equal(satelliteImageryCaption(null), null);
    assert.equal(satelliteImageryCaption('   '), null);
    assert.equal(readSegmentBox({ sw: { latitude: 1, longitude: 2 } }), null);
  });

  it('warns for separated roof structures and stays quiet for one roof', () => {
    const house = squareAt(LAT, LNG, 20);
    const closeGarage = squareAt(LAT, eastLng(LAT, LNG, 50), 20);
    const farGarage = squareAt(LAT, eastLng(LAT, LNG, 80), 20);

    const oneRoof = assessQuoteHonesty(honesty({ segmentBoxes: [house, closeGarage] }));
    assert.equal(oneRoof.structureCount, 1);
    assert.deepEqual(oneRoof.warnings, []);

    const lot = assessQuoteHonesty(honesty({ segmentBoxes: [house, farGarage] }));
    assert.equal(lot.structureCount, 2);
    assert.deepEqual(lot.warnings.map((warning) => warning.code), ['multi_building']);
    assert.equal(lot.warnings[0].message, MULTI_BUILDING_WARNING);

    assert.equal(assessQuoteHonesty(honesty({ segmentBoxes: [house] })).structureCount, null);
    assert.equal(assessQuoteHonesty(honesty()).structureCount, null);
  });

  it('compares roof area only with numbers the caller already has', () => {
    const belowParcel = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 1000,
      parcelBuildingSqFt: 4000,
      imageryQuality: 'MEDIUM',
    }));
    assert.deepEqual(belowParcel.warnings.map((warning) => warning.code), ['roof_below_parcel']);
    assert.equal(belowParcel.warnings[0].message, PARCEL_AREA_WARNING);

    const halfParcel = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 2000,
      parcelBuildingSqFt: 4000,
      imageryQuality: 'MEDIUM',
    }));
    assert.deepEqual(halfParcel.warnings, []);

    const noParcelOnFile = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 100,
      imageryQuality: 'MEDIUM',
      wholeRoofAreaSqFt: 100,
      wholeRoofGroundSqFt: 100,
      buildingGroundSqFt: 5000,
      parcelBuildingSqFt: null,
    }));
    assert.deepEqual(noParcelOnFile.warnings, []);

    const highMiss = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 1000,
      wholeRoofAreaSqFt: 2000,
      wholeRoofGroundSqFt: null,
      buildingGroundSqFt: null,
    }));
    assert.deepEqual(highMiss.warnings.map((warning) => warning.code), ['high_quality_miss']);
    assert.equal(highMiss.warnings[0].message, HIGH_QUALITY_MISS_WARNING);

    const exactQuarter = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 75,
      wholeRoofAreaSqFt: 100,
      wholeRoofGroundSqFt: null,
      buildingGroundSqFt: null,
    }));
    assert.deepEqual(exactQuarter.warnings, []);

    const mediumMiss = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 1000,
      wholeRoofAreaSqFt: 2000,
      imageryQuality: 'MEDIUM',
      wholeRoofGroundSqFt: null,
      buildingGroundSqFt: null,
    }));
    assert.deepEqual(mediumMiss.warnings, []);

    const scaledMiss = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 1000,
      wholeRoofAreaSqFt: 1000,
      wholeRoofGroundSqFt: 900,
      buildingGroundSqFt: 3000,
    }));
    assert.deepEqual(scaledMiss.warnings.map((warning) => warning.code), ['high_quality_miss']);

    const noOtherSource = assessQuoteHonesty(honesty({
      measuredRoofSqFt: 1000,
      wholeRoofAreaSqFt: null,
      wholeRoofGroundSqFt: null,
      buildingGroundSqFt: null,
    }));
    assert.deepEqual(noOtherSource.warnings, []);
  });

  it('keeps the emailed report quiet when the solar date and warnings are absent', () => {
    assert.equal(honestyEmailFragment(null), '');
    assert.equal(honestyEmailFragment({ imageryDateLabel: null, warnings: [] }), '');
    const html = honestyEmailFragment({
      imageryDateLabel: 'April 6 <2021>',
      warnings: [{ code: 'multi_building', message: MULTI_BUILDING_WARNING }],
    });
    assert.match(html, /Satellite imagery: April 6 &lt;2021&gt;/);
    assert.equal(html.includes('<2021>'), false);
    assert.match(html, /more than one building/);
  });

  it('passes imagery date and warnings through the quote response and does not invent a date', async () => {
    const house = squareAt(LAT, LNG, 20);
    const far = squareAt(LAT, eastLng(LAT, LNG, 80), 20);
    solarPayload = {
      imageryDate: { year: 2021, month: 4, day: 6 },
      imageryProcessedDate: { year: 2024, month: 1, day: 2 },
      imageryQuality: 'HIGH',
      solarPotential: {
        wholeRoofStats: { areaMeters2: 200, groundAreaMeters2: 180 },
        buildingStats: { groundAreaMeters2: 180 },
        roofSegmentStats: [
          {
            pitchDegrees: 20,
            azimuthDegrees: 180,
            stats: { areaMeters2: 50 },
            boundingBox: solarBox(house),
          },
          {
            pitchDegrees: 18,
            azimuthDegrees: 90,
            stats: { areaMeters2: 50 },
            boundingBox: solarBox(far),
          },
        ],
      },
    };

    await withServer(async (base, cookie) => {
      const res = await fetch(`${base}/api/roof/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ lat: LAT, lng: LNG }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.equal(text.includes('January 2, 2024'), false);
      assert.equal(text.includes('imageryProcessedDate'), false);
      const body = JSON.parse(text) as {
        roofData: { imageryDateLabel: string | null; warnings: { code: string }[] };
      };
      assert.equal(body.roofData.imageryDateLabel, 'April 6, 2021');
      assert.deepEqual(body.roofData.warnings.map((warning) => warning.code).sort(), [
        'high_quality_miss',
        'multi_building',
      ]);
      assert.equal(body.roofData.warnings.some((warning) => warning.code === 'roof_below_parcel'), false);
    });

    solarPayload = {
      imageryProcessedDate: { year: 2024, month: 1, day: 2 },
      imageryQuality: 'HIGH',
      solarPotential: {
        wholeRoofStats: { areaMeters2: 100, groundAreaMeters2: 90 },
        buildingStats: { groundAreaMeters2: 90 },
        roofSegmentStats: [{
          pitchDegrees: 20,
          azimuthDegrees: 180,
          stats: { areaMeters2: 100 },
          boundingBox: solarBox(house),
        }],
      },
    };
    const building = await getBuildingInsights(LAT, LNG);
    assert.ok(building);
    assert.equal(building.imageryDate, null);
    assert.equal(building.segmentBoxes.length, 1);

    await withServer(async (base, cookie) => {
      const res = await fetch(`${base}/api/roof/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ lat: LAT, lng: LNG }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      const body = JSON.parse(text) as { roofData: { imageryDateLabel: string | null; warnings: unknown[] } };
      assert.equal(body.roofData.imageryDateLabel, null);
      assert.deepEqual(body.roofData.warnings, []);
      assert.equal(text.includes('2024'), false);
      assert.equal(text.includes('Satellite imagery'), false);
    });
  });

  it('labels model numbers in the emailed report and includes a date only when one was provided', async () => {
    await withServer(async (base, cookie) => {
      resendBodies.length = 0;
      const dated = await fetch(`${base}/api/roof/send-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          address: '123 Main St, Raleigh, NC',
          roofData: {
            totalAreaSqFt: 2153,
            segments: 2,
            imageryDateLabel: 'April 6, 2021',
            warnings: [{ code: 'multi_building', message: MULTI_BUILDING_WARNING }],
          },
          quote: { roofSquares: 24.8, pitchOver12: 5, lowEstimate: 1000, highEstimate: 2000 },
          analysis: { estimatedFacets: 4, complexity: { rating: 2 } },
        }),
      });
      assert.equal(dated.status, 200);
      assert.equal(resendBodies.length, 1);
      const html = JSON.parse(resendBodies[0]).html as string;
      assert.match(html, new RegExp(AI_ESTIMATE_LABEL));
      assert.match(html, /Satellite imagery: April 6, 2021/);
      assert.match(html, /more than one building/);

      const undated = await fetch(`${base}/api/roof/send-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          address: '123 Main St, Raleigh, NC',
          roofData: { totalAreaSqFt: 2153, segments: 1, imageryDateLabel: null, warnings: [] },
          quote: { roofSquares: 24.8, pitchOver12: 5, lowEstimate: 1000, highEstimate: 2000 },
        }),
      });
      assert.equal(undated.status, 200);
      const plain = JSON.parse(resendBodies[1]).html as string;
      assert.match(plain, new RegExp(AI_ESTIMATE_LABEL));
      assert.equal(plain.includes('Satellite imagery'), false);
      assert.equal(plain.includes('more than one building'), false);
    });
  });

  it('labels the quote and the roof diagram without inventing an imagery date', () => {
    const plain = renderToStaticMarkup(createElement(QuoteResult, {
      data: quoteData(),
      onLeadSubmitted() {},
    }));
    assert.match(plain, /Sq Ft/);
    assert.match(plain, /Squares/);
    assert.match(plain, /Pitch/);
    assert.match(plain, /Estimated roof replacement cost/);
    const quoteLabels = plain.match(new RegExp(AI_ESTIMATE_LABEL, 'g')) || [];
    assert.ok(quoteLabels.length >= 4);
    assert.equal(plain.includes('Satellite imagery'), false);
    assert.equal(/no pressure/i.test(plain), false);

    const warned = renderToStaticMarkup(createElement(QuoteResult, {
      data: quoteData({
        imageryDateLabel: 'April 6, 2021',
        warnings: [
          { code: 'multi_building', message: MULTI_BUILDING_WARNING },
          { code: 'high_quality_miss', message: HIGH_QUALITY_MISS_WARNING },
        ],
      }),
      onLeadSubmitted() {},
    }));
    assert.match(warned, /more than one building/);
    assert.match(warned, /does not line up/);
    assert.equal(warned.includes('Satellite imagery'), false);

    const diagram = renderToStaticMarkup(createElement(RoofDiagram, {
      roofData: {
        totalAreaSqFt: 2153,
        estimatedLength: 40,
        estimatedWidth: 30,
        avgPitchDegrees: 22,
        imageryDateLabel: 'April 6, 2021',
        warnings: [{ code: 'multi_building', message: MULTI_BUILDING_WARNING }],
      },
      analysis: null,
    }));
    assert.match(diagram, new RegExp(DIAGRAM_ESTIMATE_NOTE));
    assert.match(diagram, /Satellite imagery: April 6, 2021/);
    assert.match(diagram, /more than one building/);

    const noDate = renderToStaticMarkup(createElement(RoofDiagram, {
      roofData: { totalAreaSqFt: 2153, estimatedLength: 40, estimatedWidth: 30 },
      analysis: null,
    }));
    assert.match(noDate, new RegExp(DIAGRAM_ESTIMATE_NOTE));
    assert.equal(noDate.includes('Satellite imagery'), false);
    assert.equal(noDate.includes('more than one building'), false);

    const thanks = renderToStaticMarkup(createElement(ThankYou, {
      name: 'Ada',
      data: quoteData({ warnings: [{ code: 'roof_below_parcel', message: PARCEL_AREA_WARNING }] }),
      onStartOver() {},
    }));
    assert.match(thanks, new RegExp(AI_ESTIMATE_LABEL));
    assert.match(thanks, /building size on file/);
  });
});

async function withServer(fn: (base: string, cookie: string) => Promise<void>) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(session({
    secret: JN_API_KEY_DUMMY,
    resave: false,
    saveUninitialized: false,
  }));
  app.post('/login', (req, res) => {
    (req.session as { userId?: number }).userId = 3;
    res.json({ ok: true });
  });
  mountRoofRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/login`, { method: 'POST' });
    const cookies = login.headers.getSetCookie();
    assert.ok(cookies.length > 0);
    await fn(base, cookies.map((cookie) => cookie.split(';')[0]).join('; '));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
