import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCaptureTargetDate } from './resolve-capture-target-date.mjs';

test('keeps the current Taipei weekday after the close-ready hour', () => {
  assert.equal(resolveCaptureTargetDate({ now: new Date('2026-09-28T10:15:00Z') }), '2026-09-28');
});

test('uses the preceding weekday when a scheduled run is delayed past midnight', () => {
  assert.equal(resolveCaptureTargetDate({ now: new Date('2026-09-28T18:08:00Z') }), '2026-09-28');
});

test('rolls a pre-close Monday execution back to Friday', () => {
  assert.equal(resolveCaptureTargetDate({ now: new Date('2026-09-28T01:00:00Z') }), '2026-09-25');
});

test('rolls weekend executions back to Friday', () => {
  assert.equal(resolveCaptureTargetDate({ now: new Date('2026-10-03T11:00:00Z') }), '2026-10-02');
});
