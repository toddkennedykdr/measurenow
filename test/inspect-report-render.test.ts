import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { PartialAnalysisView } from '../src/components/PartialAnalysisView';
import { RoofDiagram } from '../src/components/RoofDiagram';
import { safeInspection } from '../src/lib/safeInspection';

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
