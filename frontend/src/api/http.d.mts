export class ApiRequestError extends Error {
  status: number;
  code: string;
  detail: string;
  requestId?: string;
  constructor(status: number, problem?: Record<string, unknown>);
}
export function isAuthenticationExpired(error: unknown): boolean;
export function allowsLocalDevelopmentAuth(isDevelopmentBuild: boolean, apiUrl: string): boolean;
export function requestJson<T>(baseUrl: string, endpoint: string, token: string, options?: RequestInit & { fetchImpl?: typeof fetch; csrfToken?: string }): Promise<T>;
export function historyQuery(options?: { limit?: number; cursor?: string; startTime?: string; endTime?: string }): string;
export function incidentEvidenceEndpoint(incidentId: string): string;
export function startNonOverlappingPolling(callback: () => Promise<unknown>, intervalMs: number, onError?: (error: unknown) => void): () => void;
