import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: './vite.config.ts',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => vite.close());

test('overview renders unavailable states instead of fabricated health or zero-valued metrics', async () => {
  const { OverviewView } = await vite.ssrLoadModule('/src/views/OverviewView.tsx');
  const markup = renderToStaticMarkup(React.createElement(OverviewView, {
    overview: null,
    services: [],
    servicesAvailable: false,
    incidents: [],
    incidentsAvailable: false,
    collectors: [],
    collectorsAvailable: false,
    telemetry: null,
    telemetryHistory: {},
    selectedService: null,
    onSelectService: () => undefined,
    onNavigateToIncidents: () => undefined,
    onLoadTelemetry: async () => undefined,
    telemetryLoading: false,
    timeFilter: { startTime: '', endTime: '' },
    isStale: false,
    dataAvailable: false,
  }));
  assert.match(markup, /Live overview data is unavailable/);
  assert.match(markup, /Fleet health/);
  assert.match(markup, /Unavailable/);
  assert.doesNotMatch(markup, /Overall Fleet Health.{0,80}excellent/);
});

test('incident evidence view renders detector observations, baselines and UTC evidence time', async () => {
  const { IncidentEvidenceRow } = await vite.ssrLoadModule('/src/views/IncidentsView.tsx');
  const markup = renderToStaticMarkup(React.createElement(IncidentEvidenceRow, {
    row: {
      payload_id: 'payload-test',
      event_time: '2026-02-01T00:00:00.000Z',
      ingested_at: '2026-02-01T00:00:01.000Z',
      service: 'synthetic-service',
      collector_id: 'collector-test',
      environment: 'test',
      region: null,
      metrics: { cpu_percent: 91.5 },
      security: {},
      signals: [{
        metric: 'cpu_percent',
        observed_value: 91.5,
        baseline: 20.5,
        sample_count: 4,
        threshold: 90,
        deviation_score: 3.1,
        method: 'rolling_z_score',
        severity: 'critical',
        event_time: '2026-02-01T00:00:00.000Z',
        description: 'Observed value exceeded the persisted threshold.',
      }],
    },
  }));
  assert.match(markup, /Observed 91\.5; baseline 20\.5; samples 4; threshold 90/);
  assert.match(markup, /UTC/);
  assert.match(markup, /Observed value exceeded the persisted threshold/);
});

test('security view shows persisted counters and leaves absent counters unreported', async () => {
  const { SecurityView } = await vite.ssrLoadModule('/src/views/SecurityView.tsx');
  const markup = renderToStaticMarkup(React.createElement(SecurityView, {
    history: {
      items: [{
        payload_id: 'security-record', collector_id: 'collector-test', schema_version: '1.0.0',
        event_time: '2026-02-01T00:00:00.000Z', ingested_at: '2026-02-01T00:00:01.000Z',
        service: 'synthetic-service', environment: 'test', region: null, health: 'good',
        metrics: {}, security: { failed_login_count: 2 },
      }],
      limit: 100, has_more: false, next_cursor: null,
    },
    isLoading: false,
    onLoadMore: () => undefined,
  }));
  assert.match(markup, /Failed logins summed from reported counters/);
  assert.match(markup, />2</);
  assert.match(markup, /Not reported/);
});
