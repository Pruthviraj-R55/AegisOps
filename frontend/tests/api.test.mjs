import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsLocalDevelopmentAuth, ApiRequestError, historyQuery, incidentEvidenceEndpoint, isAuthenticationExpired, requestJson, startNonOverlappingPolling } from '../src/api/http.mjs';
import { formatUtcTimestamp, getDataState, meanAvailable, toTelemetryHistory } from '../src/api/telemetry-view.mjs';

test('API client includes cookies while retaining the page-memory bearer token only for local development', async () => {
  let request;
  const payload = { items: [] };
  const result = await requestJson('https://api.example', '/api/v1/telemetry', 'dev-secret', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(result, payload);
  assert.equal(request.url, 'https://api.example/api/v1/telemetry');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.headers.get('Authorization'), 'Bearer dev-secret');
});

test('cookie-authenticated state changes include a CSRF header and no bearer token', async () => {
  let request;
  await requestJson('https://api.example', '/api/v1/auth/logout', '', {
    method: 'POST', csrfToken: 'csrf-memory-only',
    fetchImpl: async (_url, options) => {
      request = options;
      return new Response(JSON.stringify({ logged_out: true }), { status: 200 });
    },
  });
  assert.equal(request.credentials, 'include');
  assert.equal(request.headers.get('X-CSRF-Token'), 'csrf-memory-only');
  assert.equal(request.headers.has('Authorization'), false);
});

test('login request includes credentials without persisting or sending a bearer token', async () => {
  let request;
  await requestJson('https://api.example', '/api/v1/auth/login', '', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'test-only-password' }),
    fetchImpl: async (_url, options) => {
      request = options;
      return new Response(JSON.stringify({ authenticated: true, csrf_token: 'csrf' }), { status: 200 });
    },
  });
  assert.equal(request.credentials, 'include');
  assert.equal(request.headers.has('Authorization'), false);
  assert.equal(request.headers.has('X-CSRF-Token'), false);
});

test('API client keeps auth failures structured for 401, 403, 404, 429 and 5xx', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    await assert.rejects(
      requestJson('https://api.example', '/api/v1/services', 'token', {
        fetchImpl: async () => new Response(JSON.stringify({ code: 'problem', detail: 'safe detail' }), { status }),
      }),
      (error) => error instanceof ApiRequestError && error.status === status && error.detail === 'safe detail',
    );
  }
  const unauthorized = new ApiRequestError(401, { code: 'unauthenticated' });
  assert.equal(isAuthenticationExpired(unauthorized), true);
  assert.equal(isAuthenticationExpired(new ApiRequestError(403)), false);
});

test('history query supports cursor and UTC filters without a caller-selected tenant', () => {
  const params = new URLSearchParams(historyQuery({
    limit: 20,
    cursor: 'opaque-cursor',
    startTime: '2026-02-01T00:00:00.000Z',
    endTime: '2026-02-02T00:00:00.000Z',
  }));
  assert.equal(params.get('limit'), '20');
  assert.equal(params.get('cursor'), 'opaque-cursor');
  assert.equal(params.get('start_time'), '2026-02-01T00:00:00.000Z');
  assert.equal(params.get('end_time'), '2026-02-02T00:00:00.000Z');
  assert.equal(params.has('tenant_id'), false);
});

test('incident evidence requests use the encoded persisted evidence endpoint', () => {
  assert.equal(incidentEvidenceEndpoint('incident/with spaces'), '/api/v1/incidents/incident%2Fwith%20spaces/evidence');
});

test('incident analysis retry uses the tenant-scoped route with cookie credentials and CSRF', async () => {
  let request;
  const pending = { incident_id: 'incident-1', status: 'pending' };
  const result = await requestJson('https://api.example', '/api/v1/incidents/incident-1/analysis/retry', '', {
    method: 'POST', csrfToken: 'csrf-memory-only',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(pending), { status: 202 });
    },
  });
  assert.deepEqual(result, pending);
  assert.equal(request.url, 'https://api.example/api/v1/incidents/incident-1/analysis/retry');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.headers.get('X-CSRF-Token'), 'csrf-memory-only');
  assert.equal(request.options.headers.has('Authorization'), false);
});

test('browser bearer-token dashboard access is restricted to local development builds', () => {
  assert.equal(allowsLocalDevelopmentAuth(true, 'http://127.0.0.1:8000'), true);
  assert.equal(allowsLocalDevelopmentAuth(true, 'http://localhost:8000'), true);
  assert.equal(allowsLocalDevelopmentAuth(true, 'https://saas.example.com'), false);
  assert.equal(allowsLocalDevelopmentAuth(false, 'http://127.0.0.1:8000'), false);
});

test('telemetry view model preserves absent metrics instead of inventing zeroes', () => {
  const history = toTelemetryHistory([{
    service: 'service-a', event_time: '2026-02-01T00:00:00.000Z',
    metrics: { cpu_percent: 0, latency_ms: 42 }, security: {},
  }]);
  assert.equal(history['service-a'][0].cpu, 0);
  assert.equal(history['service-a'][0].latency, 42);
  assert.equal(history['service-a'][0].memory, undefined);
  assert.equal(history['service-a'][0].packetLoss, undefined);
  assert.match(history['service-a'][0].displayTime, /UTC$/);
  assert.equal(meanAvailable([undefined, 10, 20, Number.NaN]), 15);
  assert.equal(meanAvailable([undefined, Number.NaN]), null);
  assert.match(formatUtcTimestamp('not-a-time'), /Invalid/);
});

test('empty, loading, stale and unavailable API states are distinguished', () => {
  assert.equal(getDataState({ hasData: false, loading: true, error: false }), 'loading');
  assert.equal(getDataState({ hasData: false, loading: false, error: false, empty: true }), 'empty');
  assert.equal(getDataState({ hasData: true, loading: false, error: true }), 'stale');
  assert.equal(getDataState({ hasData: false, loading: false, error: true }), 'unavailable');
});

test('polling suppresses overlaps and stops after cleanup', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick;
  let cleared = false;
  globalThis.setInterval = (callback) => { tick = callback; return 17; };
  globalThis.clearInterval = (id) => { assert.equal(id, 17); cleared = true; };
  try {
    let finish;
    let calls = 0;
    const stop = startNonOverlappingPolling(() => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    }, 1000);
    const first = tick();
    const overlapping = tick();
    assert.equal(calls, 1);
    finish();
    await Promise.all([first, overlapping]);
    stop();
    assert.equal(cleared, true);
    await tick();
    assert.equal(calls, 1);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('polling reports a failed request and permits a later retry', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick;
  globalThis.setInterval = (callback) => { tick = callback; return 23; };
  globalThis.clearInterval = () => undefined;
  try {
    const errors = [];
    let attempts = 0;
    const stop = startNonOverlappingPolling(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('unavailable');
    }, 1000, (error) => errors.push(error.message));
    await tick();
    await tick();
    stop();
    assert.equal(attempts, 2);
    assert.deepEqual(errors, ['unavailable']);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
