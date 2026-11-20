import React from 'react';
import { AlertCircle, Info, Menu } from 'lucide-react';
import { SaasApiError, SaasClient } from './api/client';
import { CollectorClient } from './api/collector';
import { allowsLocalDevelopmentAuth, isAuthenticationExpired, startNonOverlappingPolling } from './api/http.mjs';
import { getDataState, toTelemetryHistory } from './api/telemetry-view.mjs';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TokenModal } from './components/TokenModal';
const OverviewView = React.lazy(() => import('./views/OverviewView').then((module) => ({ default: module.OverviewView })));
const InfrastructureView = React.lazy(() => import('./views/InfrastructureView').then((module) => ({ default: module.InfrastructureView })));
const PerformanceView = React.lazy(() => import('./views/PerformanceView').then((module) => ({ default: module.PerformanceView })));
const NetworkView = React.lazy(() => import('./views/NetworkView').then((module) => ({ default: module.NetworkView })));
const SecurityView = React.lazy(() => import('./views/SecurityView').then((module) => ({ default: module.SecurityView })));
const IncidentsView = React.lazy(() => import('./views/IncidentsView').then((module) => ({ default: module.IncidentsView })));
const AnomaliesView = React.lazy(() => import('./views/AnomaliesView').then((module) => ({ default: module.AnomaliesView })));
const CollectorsView = React.lazy(() => import('./views/CollectorsView').then((module) => ({ default: module.CollectorsView })));
const EgressProofView = React.lazy(() => import('./views/EgressProofView').then((module) => ({ default: module.EgressProofView })));
const SettingsView = React.lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })));
import type {
  CollectorItem,
  DashboardOverview,
  HistoryResponse,
  IncidentItem,
  ServiceItem,
} from './types/saas';
import type { ActiveNavView } from './types/telemetry';

const SAAS_URL = import.meta.env.VITE_SAAS_API_URL || 'http://127.0.0.1:8000';
const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_API_URL || 'http://127.0.0.1:8100';
const LOCAL_DEV_AUTH = allowsLocalDevelopmentAuth(import.meta.env.DEV, SAAS_URL);
const SESSION_AUTH_AVAILABLE = !import.meta.env.DEV && (() => {
  try {
    return new URL(SAAS_URL).protocol === 'https:' && window.location.protocol === 'https:';
  } catch {
    return false;
  }
})();
const POLL_INTERVAL_MS = 30_000;
const PageFallback = () => <div role="status" className="min-h-48 border border-border bg-surface p-6 text-xs text-text-muted">Loading selected dashboard view…</div>;

function errorText(error: unknown): string {
  if (error instanceof SaasApiError) {
    if (error.status === 401) return 'Dashboard credential is invalid or expired. Sign in again.';
    if (error.status === 403) return 'This credential is not authorized for the requested tenant data.';
    if (error.status === 404) return 'The requested SaaS resource is unavailable.';
    if (error.status === 429) return 'The SaaS API rate limit was reached. Refreshing will resume shortly.';
    if (error.status >= 500) return 'The SaaS API is temporarily unavailable. Previously loaded data is marked stale.';
    return error.detail;
  }
  return 'Unable to reach the SaaS API. Check its availability and configured URL.';
}

export const App: React.FC = () => {
  const [currentView, setCurrentView] = React.useState<ActiveNavView>('overview');
  const [currentToken, setCurrentToken] = React.useState('');
  const [csrfToken, setCsrfToken] = React.useState('');
  const [sessionAuthenticated, setSessionAuthenticated] = React.useState(false);
  const [sessionChecked, setSessionChecked] = React.useState(LOCAL_DEV_AUTH);
  const [loginEmail, setLoginEmail] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [loginBusy, setLoginBusy] = React.useState(false);
  const [isTokenModalOpen, setIsTokenModalOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [isPolling, setIsPolling] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [lastSyncTime, setLastSyncTime] = React.useState<string | null>(null);
  const [clock, setClock] = React.useState(Date.now());
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [overview, setOverview] = React.useState<DashboardOverview | null>(null);
  const [services, setServices] = React.useState<ServiceItem[]>([]);
  const [servicesAvailable, setServicesAvailable] = React.useState(false);
  const [incidents, setIncidents] = React.useState<IncidentItem[]>([]);
  const [incidentsAvailable, setIncidentsAvailable] = React.useState(false);
  const [collectors, setCollectors] = React.useState<CollectorItem[]>([]);
  const [collectorsAvailable, setCollectorsAvailable] = React.useState(false);
  const [telemetry, setTelemetry] = React.useState<HistoryResponse | null>(null);
  const [securityEvents, setSecurityEvents] = React.useState<HistoryResponse | null>(null);
  const [telemetryLoading, setTelemetryLoading] = React.useState(false);
  const [securityLoading, setSecurityLoading] = React.useState(false);
  const [selectedService, setSelectedService] = React.useState<string | null>(null);
  const [timeFilter, setTimeFilter] = React.useState({ startTime: '', endTime: '' });
  const requestInFlight = React.useRef(false);
  const requestController = React.useRef<AbortController | null>(null);
  const authMarker = LOCAL_DEV_AUTH ? currentToken : (SESSION_AUTH_AVAILABLE && sessionAuthenticated ? 'session' : '');
  const authRef = React.useRef(authMarker);
  const authExpired = React.useRef(false);
  authRef.current = authMarker;
  const fetchDashboardRef = React.useRef<() => Promise<void>>(async () => undefined);

  const saasClient = React.useMemo(() => new SaasClient(SAAS_URL, LOCAL_DEV_AUTH ? currentToken : '', csrfToken), [currentToken, csrfToken]);
  const collectorClient = React.useMemo(() => new CollectorClient(COLLECTOR_URL), []);

  React.useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (LOCAL_DEV_AUTH || !SESSION_AUTH_AVAILABLE) {
      setSessionChecked(true);
      return;
    }
    const authClient = new SaasClient(SAAS_URL);
    void authClient.getSession()
      .then((session) => {
        setSessionAuthenticated(true);
        setCsrfToken(session.csrf_token);
      })
      .catch((error) => {
        if (!isAuthenticationExpired(error)) setErrorMessage(errorText(error));
        setSessionAuthenticated(false);
      })
      .finally(() => setSessionChecked(true));
  }, []);

  const clearData = React.useCallback(() => {
    setOverview(null);
    setServices([]);
    setServicesAvailable(false);
    setIncidents([]);
    setIncidentsAvailable(false);
    setCollectors([]);
    setCollectorsAvailable(false);
    setTelemetry(null);
    setSecurityEvents(null);
    setLastSyncTime(null);
    setIsRefreshing(false);
    setTelemetryLoading(false);
    setSecurityLoading(false);
  }, []);

  const fetchDashboard = React.useCallback(async () => {
    if (!authMarker || requestInFlight.current) {
      if (!authMarker) clearData();
      setIsRefreshing(false);
      return;
    }

    requestInFlight.current = true;
    setIsRefreshing(true);
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    const requestAuth = authMarker;
    try {
      const results = await Promise.allSettled([
          saasClient.getOverview(controller.signal),
          saasClient.getServices(200, controller.signal),
          saasClient.getIncidents(100, controller.signal),
          saasClient.getCollectors(200, controller.signal),
          saasClient.getTelemetry({ limit: 100, ...timeFilter }, controller.signal),
          saasClient.getSecurityEvents({ limit: 100 }, controller.signal),
      ]);
      if (controller.signal.aborted || authRef.current !== requestAuth) return;
      const [overviewResult, servicesResult, incidentsResult, collectorsResult, telemetryResult, securityResult] = results;
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      const expired = rejected.find((result) => isAuthenticationExpired(result.reason));
      if (expired) throw expired.reason;
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
      if (servicesResult.status === 'fulfilled') {
        setServices(servicesResult.value.items);
        setServicesAvailable(true);
        setSelectedService((previous) => previous || servicesResult.value.items[0]?.service || null);
      }
      if (incidentsResult.status === 'fulfilled') {
        setIncidents(incidentsResult.value.items);
        setIncidentsAvailable(true);
      }
      if (collectorsResult.status === 'fulfilled') {
        setCollectors(collectorsResult.value.items);
        setCollectorsAvailable(true);
      }
      if (telemetryResult.status === 'fulfilled') setTelemetry(telemetryResult.value);
      if (securityResult.status === 'fulfilled') setSecurityEvents(securityResult.value);
      if (results.some((result) => result.status === 'fulfilled')) setLastSyncTime(new Date().toISOString());
      setErrorMessage(rejected.length ? errorText(rejected[0].reason) : null);
    } catch (error) {
      if (controller.signal.aborted || authRef.current !== requestAuth) return;
      setErrorMessage(errorText(error));
      if (isAuthenticationExpired(error)) {
        authExpired.current = true;
        if (LOCAL_DEV_AUTH) setCurrentToken('');
        else { setSessionAuthenticated(false); setCsrfToken(''); }
        clearData();
      }
    } finally {
      if (requestController.current === controller) {
        requestInFlight.current = false;
        requestController.current = null;
        setIsRefreshing(false);
      }
    }
  }, [authMarker, clearData, currentToken, saasClient, timeFilter]);

  fetchDashboardRef.current = fetchDashboard;

  React.useEffect(() => {
    requestController.current?.abort();
    requestController.current = null;
    requestInFlight.current = false;
    clearData();
    setErrorMessage(authExpired.current ? 'Dashboard credential is invalid or expired. Sign in again.' : null);
    authExpired.current = false;
    if (authMarker) void fetchDashboardRef.current();
    return () => requestController.current?.abort();
  }, [authMarker, clearData]);

  React.useEffect(() => {
    if (!isPolling || !authMarker) return;
    return startNonOverlappingPolling(fetchDashboard, POLL_INTERVAL_MS);
  }, [authMarker, fetchDashboard, isPolling]);

  const loadTelemetry = React.useCallback(async (cursor?: string, startTime = timeFilter.startTime, endTime = timeFilter.endTime) => {
    if (!authMarker) return;
    const requestAuth = authMarker;
    setTelemetryLoading(true);
    try {
      const filters = { startTime, endTime };
      const page = await saasClient.getTelemetry({ limit: 100, cursor, ...filters });
      if (authRef.current !== requestAuth) return;
      setTimeFilter(filters);
      setTelemetry(page);
      setErrorMessage(null);
    } catch (error) {
      if (authRef.current !== requestAuth) return;
      setErrorMessage(errorText(error));
      if (isAuthenticationExpired(error)) {
        authExpired.current = true;
        if (LOCAL_DEV_AUTH) setCurrentToken('');
        else { setSessionAuthenticated(false); setCsrfToken(''); }
      }
    } finally {
      if (authRef.current === requestAuth) setTelemetryLoading(false);
    }
  }, [authMarker, currentToken, saasClient, timeFilter]);

  const loadSecurityNextPage = React.useCallback(async () => {
    if (!securityEvents?.next_cursor) return;
    const requestAuth = authMarker;
    setSecurityLoading(true);
    try {
      const next = await saasClient.getSecurityEvents({ limit: 100, cursor: securityEvents.next_cursor });
      if (authRef.current !== requestAuth) return;
      setSecurityEvents((previous) => previous ? {
        ...next,
        items: [...previous.items, ...next.items],
      } : next);
    } catch (error) {
      if (authRef.current !== requestAuth) return;
      setErrorMessage(errorText(error));
      if (isAuthenticationExpired(error)) {
        authExpired.current = true;
        if (LOCAL_DEV_AUTH) setCurrentToken('');
        else { setSessionAuthenticated(false); setCsrfToken(''); }
      }
    } finally {
      if (authRef.current === requestAuth) setSecurityLoading(false);
    }
  }, [authMarker, currentToken, saasClient, securityEvents]);

  const saveToken = (token: string) => {
    authExpired.current = false;
    if (LOCAL_DEV_AUTH) setCurrentToken(token.trim());
    setErrorMessage(null);
    setIsTokenModalOpen(false);
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setErrorMessage(null);
    try {
      const session = await new SaasClient(SAAS_URL).login(loginEmail, loginPassword);
      setLoginPassword('');
      setCsrfToken(session.csrf_token);
      setSessionAuthenticated(true);
      authExpired.current = false;
    } catch (error) {
      setErrorMessage(errorText(error));
      setLoginPassword('');
    } finally {
      setLoginBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await saasClient.logout(csrfToken);
    } catch (error) {
      if (!isAuthenticationExpired(error)) setErrorMessage(errorText(error));
    } finally {
      setSessionAuthenticated(false);
      setCsrfToken('');
      clearData();
    }
  };

  const telemetryHistory = React.useMemo(() => toTelemetryHistory(telemetry?.items || []), [telemetry]);
  const collectorStatus = collectors.length === 0
    ? 'unavailable'
    : collectors.some((collector) => collector.status === 'online')
      ? 'online'
      : collectors.some((collector) => collector.status === 'stale')
        ? 'stale'
        : 'offline';
  const activeIncidentsCount = overview?.active_incident_count;
  const dashboardDataState = getDataState({
    hasData: Boolean(overview || lastSyncTime),
    loading: isRefreshing,
    error: Boolean(errorMessage) || Boolean(lastSyncTime && clock - Date.parse(lastSyncTime) > POLL_INTERVAL_MS * 2),
    empty: Boolean(overview && servicesAvailable && telemetry && services.length === 0 && telemetry.items.length === 0),
  });
  const isDataStale = dashboardDataState === 'stale';

  return (
    <div className="flex min-h-screen bg-app text-text-primary font-sans antialiased selection:bg-signal/20 selection:text-ink">
      <Sidebar currentView={currentView} onSelectView={(view) => { setCurrentView(view); setMobileNavOpen(false); }} activeIncidentCount={activeIncidentsCount || 0} collectorStatus={collectorStatus} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <button onClick={() => setMobileNavOpen(true)} aria-label="Open navigation" className="fixed bottom-4 left-4 z-30 grid h-11 w-11 place-items-center border border-ink bg-ink text-paper lg:hidden"><Menu className="h-5 w-5" /></button>
        <Header
          currentView={currentView}
          currentToken={LOCAL_DEV_AUTH ? currentToken : ''}
          localDevelopmentAuth={LOCAL_DEV_AUTH}
          isAuthenticated={Boolean(authMarker)}
          onSignOut={() => void signOut()}
          onOpenTokenModal={() => LOCAL_DEV_AUTH && setIsTokenModalOpen(true)}
          isPolling={isPolling}
          onTogglePolling={() => setIsPolling((value) => !value)}
          onManualRefresh={() => void fetchDashboard()}
          isRefreshing={isRefreshing}
          lastSyncTime={lastSyncTime}
          collectorStatus={collectorStatus}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8 max-w-[1600px] w-full mx-auto space-y-6">
          {!LOCAL_DEV_AUTH && !SESSION_AUTH_AVAILABLE && <p role="alert" className="rounded border border-[#B83A32]/30 bg-[#F3E4DF] p-4 text-sm text-[#B83A32]">Production dashboard login requires an HTTPS page and an HTTPS `VITE_SAAS_API_URL`.</p>}
          {!LOCAL_DEV_AUTH && SESSION_AUTH_AVAILABLE && !sessionChecked && <p className="text-sm text-text-secondary">Checking dashboard session…</p>}
          {!LOCAL_DEV_AUTH && SESSION_AUTH_AVAILABLE && sessionChecked && !sessionAuthenticated && (
            <section className="mx-auto max-w-md rounded-lg border border-border bg-surface p-6 shadow-card">
              <h2 className="mb-1 text-lg font-semibold text-text-primary">Sign in to AEGISOPS</h2>
              <p className="mb-5 text-xs text-text-secondary">Use the dashboard account provisioned for your organization.</p>
              <form onSubmit={(event) => void submitLogin(event)} className="space-y-4">
                <label className="block text-xs font-medium text-text-secondary">
                  Email
                  <input type="email" autoComplete="username" required maxLength={320} value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
                </label>
                <label className="block text-xs font-medium text-text-secondary">
                  Password
                  <input type="password" autoComplete="current-password" required maxLength={1024} value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
                </label>
                {errorMessage && <p role="alert" className="text-xs text-[#B83A32]">{errorMessage}</p>}
                <button disabled={loginBusy} type="submit" className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{loginBusy ? 'Signing in…' : 'Sign in'}</button>
              </form>
            </section>
          )}
          {LOCAL_DEV_AUTH && !currentToken && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-surface p-4 text-xs text-text-secondary">
              <Info className="h-4 w-4 text-accent shrink-0" />
              Connect using the separate <code>SAAS_DASHBOARD_DEV_TOKEN</code> configured for a local development SaaS API. It is distinct from collector delivery credentials, held in memory, and not persisted.
            </div>
          )}
          {!authMarker && (LOCAL_DEV_AUTH || sessionChecked || !SESSION_AUTH_AVAILABLE) && (
            <div className="flex flex-col gap-3 border-l-2 border-signal bg-surface px-4 py-3 text-xs text-text-secondary sm:flex-row sm:items-center sm:justify-between">
              <div><strong className="text-ink">Dashboard data is protected.</strong> Connect with the local dashboard credential or sign in to load tenant-scoped SaaS records.</div>
              {LOCAL_DEV_AUTH && <button onClick={() => setIsTokenModalOpen(true)} className="self-start border border-ink px-3 py-2 font-mono text-[11px] font-semibold text-ink hover:bg-ink hover:text-paper">Connect local API</button>}
            </div>
          )}
          {errorMessage && (
            <div className="flex items-center gap-2.5 rounded-lg border border-[#B83A32]/30 bg-[#F3E4DF] p-3 text-xs text-[#B83A32]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="flex-1"><strong>{isDataStale ? 'SaaS data may be stale: ' : 'SaaS API: '}</strong>{errorMessage}</div>
            </div>
          )}
          {dashboardDataState === 'empty' && <div className="rounded-lg border border-border bg-surface p-4 text-xs text-text-secondary">The API is reachable, but no service telemetry has been persisted for this tenant yet.</div>}
          <React.Suspense fallback={<PageFallback />}>
          {currentView === 'overview' && (
            <OverviewView
              overview={overview}
              services={services}
              servicesAvailable={servicesAvailable}
              incidents={incidents}
              incidentsAvailable={incidentsAvailable}
              collectors={collectors}
              collectorsAvailable={collectorsAvailable}
              telemetry={telemetry}
              securityEvents={securityEvents}
              telemetryHistory={telemetryHistory}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              onNavigateToIncidents={() => setCurrentView('incidents')}
              onLoadTelemetry={loadTelemetry}
              telemetryLoading={telemetryLoading}
              timeFilter={timeFilter}
              isStale={isDataStale}
              dataAvailable={Boolean(authMarker && overview)}
            />
          )}
          {currentView === 'infrastructure' && <InfrastructureView services={services} selectedService={selectedService} onSelectService={setSelectedService} telemetryHistory={telemetryHistory} isLoading={isRefreshing} />}
          {currentView === 'performance' && <PerformanceView services={services} selectedService={selectedService} onSelectService={setSelectedService} telemetryHistory={telemetryHistory} isLoading={isRefreshing} />}
          {currentView === 'network' && <NetworkView services={services} selectedService={selectedService} onSelectService={setSelectedService} telemetryHistory={telemetryHistory} isLoading={isRefreshing} />}
          {currentView === 'security' && <SecurityView history={securityEvents} isLoading={securityLoading || isRefreshing} onLoadMore={loadSecurityNextPage} />}
          {currentView === 'incidents' && <IncidentsView incidents={incidents} dataAvailable={incidentsAvailable} client={saasClient} isLoading={isRefreshing} isStale={isDataStale} />}
          {currentView === 'anomalies' && <AnomaliesView incidents={incidents} dataAvailable={incidentsAvailable} isLoading={isRefreshing} />}
          {currentView === 'collectors' && <CollectorsView collectors={collectors} dataAvailable={collectorsAvailable} collectorClient={collectorClient} isLoading={isRefreshing} />}
          {currentView === 'egress' && <EgressProofView collectorClient={collectorClient} />}
          {currentView === 'settings' && <SettingsView currentToken={currentToken} onSaveToken={saveToken} saasUrl={SAAS_URL} collectorUrl={COLLECTOR_URL} authEnabled={LOCAL_DEV_AUTH} isAuthenticated={Boolean(authMarker)} environmentLabel={LOCAL_DEV_AUTH ? 'Local development' : SESSION_AUTH_AVAILABLE ? 'HTTPS session' : 'Secure login unavailable'} />}
          </React.Suspense>
        </main>
      </div>
      <TokenModal isOpen={isTokenModalOpen && LOCAL_DEV_AUTH} onClose={() => setIsTokenModalOpen(false)} currentToken={currentToken} onSaveToken={saveToken} />
    </div>
  );
};
