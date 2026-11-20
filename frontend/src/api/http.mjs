export class ApiRequestError extends Error {
  constructor(status, problem = {}) {
    super(problem.detail || `API request failed (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = problem.code || 'unknown_error';
    this.detail = problem.detail || 'The request could not be completed.';
    this.requestId = problem.request_id;
  }
}

export function isAuthenticationExpired(error) {
  return error instanceof ApiRequestError && error.status === 401;
}

export function allowsLocalDevelopmentAuth(isDevelopmentBuild, apiUrl) {
  if (!isDevelopmentBuild) return false;
  try {
    const parsed = new URL(apiUrl);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function requestJson(baseUrl, endpoint, token, options = {}) {
  const { fetchImpl: injectedFetch, csrfToken, ...requestOptions } = options;
  const fetchImpl = injectedFetch || globalThis.fetch;
  const headers = new Headers(requestOptions.headers || {});
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const method = (requestOptions.method || 'GET').toUpperCase();
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrfToken);

  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${endpoint}`, {
    ...requestOptions,
    headers,
    credentials: 'include',
  });
  if (response.status === 204) return undefined;

  const body = await response.text();
  let parsed = {};
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { detail: 'The API returned an unreadable response.' };
    }
  }
  if (!response.ok) throw new ApiRequestError(response.status, parsed);
  if (!body) return undefined;
  return parsed;
}

export function historyQuery({ limit = 50, cursor, startTime, endTime } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (startTime) params.set('start_time', startTime);
  if (endTime) params.set('end_time', endTime);
  return params.toString();
}

export function incidentEvidenceEndpoint(incidentId) {
  return `/api/v1/incidents/${encodeURIComponent(incidentId)}/evidence`;
}

export function startNonOverlappingPolling(callback, intervalMs, onError = () => undefined) {
  let running = false;
  let stopped = false;
  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      await callback();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
