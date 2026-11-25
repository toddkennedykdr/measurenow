import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { AiInspectionNotes, FeatureList, SidingDamageList } from '../src/components/PhotoAnalysisSections';
import { PartialAnalysisView } from '../src/components/PartialAnalysisView';
import { RoofDiagram } from '../src/components/RoofDiagram';
import { clampComplexityRating, safeInspection } from '../src/lib/safeInspection';

test('partial photo analysis renders without throwing', () => {
  const partial = { roofType: 'gable' };
  const view = safeInspection(partial);
  assert.equal(view.roofType, 'gable');
  assert.deepEqual(view.features, []);
  assert.deepEqual(view.damage, []);
  assert.deepEqual(view.sidingDamage, []);
  assert.deepEqual(view.accessIssues, []);
  assert.equal(view.materialType, '');
  assert.equal(view.overallRating, '');
  assert.equal(view.complexityExplanation, '');

  const html = renderToStaticMarkup(React.createElement(PartialAnalysisView, { analysis: partial }));
  assert.match(html, /gable/);
  assert.equal(html.includes('undefined'), false);
  assert.doesNotThrow(() => view.features.filter((feature) => feature.type.toLowerCase().includes('ridge')));
});

const FULL_ANALYSIS = {
  roofType: 'gable',
  material: { type: 'asphalt shingle', condition: 'fair' },
  features: [{ type: 'chimney', count: 1, location: 'north slope' }],
  complexity: { rating: 2, explanation: 'simple gable' },
  damage: [{ type: 'missing shingles', severity: 'major', location: 'ridge', description: 'tabs gone' }],
  accessIssues: ['steep slope'],
  overallCondition: { rating: 'fair', notes: 'wear along the ridge' },
  recommendations: ['Replace the ridge cap'],
  sidingMaterial: 'vinyl',
  sidingCondition: { rating: 'fair', notes: 'siding is intact' },
  sidingDamage: [{ type: 'fading', severity: 'minor', location: 'south wall', description: 'color fade' }],
  sidingRecommendations: ['Wash the siding'],
};

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

test('full photo analysis keeps labeled sections without duplicates', () => {
  const view = safeInspection(FULL_ANALYSIS);
  view.complexityRating = clampComplexityRating(view.complexityRating);
  const html = renderToStaticMarkup(
    React.createElement('div', null,
      React.createElement(SidingDamageList, { items: view.sidingDamage }),
      React.createElement(FeatureList, { features: view.features }),
      React.createElement(AiInspectionNotes, { view }),
    ),
  );
  for (const heading of [
    'Features Detected',
    'Roof Damage Findings',
    'Access Issues',
    'Siding Recommendations',
  ]) {
    assert.equal(count(html, heading), 1, heading);
  }
  assert.equal(count(html, '>Recommendations<'), 1);
  assert.equal(count(html, 'simple gable'), 1);
  assert.equal(count(html, 'wear along the ridge'), 1);
  assert.equal(count(html, 'siding is intact'), 0);
  assert.match(html, /hover-condition-badge hover-condition-badge--fair/);
  assert.match(html, /FAIR/);
  assert.match(html, /\(major\)/);
  assert.match(html, /\(minor\)/);
  assert.equal(count(html, 'Replace the ridge cap'), 1);
  assert.equal(count(html, 'Wash the siding'), 1);
  assert.equal(count(html, 'class="hover-recs"'), 2);
  assert.equal(html.includes('>gable<'), false);
  assert.equal(html.includes('>asphalt shingle<'), false);
});

test('complexity rating clamps into 1-5 instead of a silent 1.0x', () => {
  assert.equal(clampComplexityRating(0), 1);
  assert.equal(clampComplexityRating(2), 2);
  assert.equal(clampComplexityRating(2.6), 3);
  assert.equal(clampComplexityRating(9), 5);
  assert.equal(clampComplexityRating(undefined), 1);
  const multipliers: Record<number, number> = { 1: 1.0, 2: 1.05, 3: 1.1, 4: 1.15, 5: 1.3 };
  assert.equal(multipliers[clampComplexityRating(0)], 1);
  assert.equal(multipliers[clampComplexityRating(9)], 1.3);
});

test('address diagram labels only measured totals and says it is illustrative', () => {
  const html = renderToStaticMarkup(React.createElement(RoofDiagram, {
    analysis: null,
    roofData: {
      totalAreaSqFt: 1884,
      segments: 4,
      avgPitchDegrees: 25,
      estimatedLength: 41,
      estimatedWidth: 41,
    },
  }));
  assert.match(html, /Illustrative — not to scale/);
  assert.match(html, /1,884 sq ft/);
  assert.equal(html.includes('471'), false);
  assert.equal(html.includes(' sf'), false);
  assert.equal(html.includes("41'"), false);
  assert.equal(html.includes("18'"), false);
  assert.equal(html.includes('25°'), false);
});
