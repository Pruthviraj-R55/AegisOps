import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ShieldCheck, Terminal } from 'lucide-react';
import { SanitizedEventLog, TelemetryDataPoint } from '../types/telemetry';

interface SecurityLogStreamPanelProps {
  history: TelemetryDataPoint[];
  logs: SanitizedEventLog[];
}

export const SecurityLogStreamPanel: React.FC<SecurityLogStreamPanelProps> = ({
  history,
  logs,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Security Spikes Bar Chart (5 cols) */}
      <div className="lg:col-span-5 rounded border border-border bg-surface p-4 transition-all hover:border-border-focus">
        <div className="flex items-center justify-between border-b border-border/70 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-accent-crimson/10 text-accent-crimson">
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Security Anomaly Signals (Failed Logins)
            </span>
          </div>
          <span className="text-[10px] font-mono text-text-muted">Brute-Force Detection</span>
        </div>

        <div className="h-44 w-full">
          {history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-text-muted font-mono">
              Monitoring security events...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#151B27" vertical={false} />
                <XAxis
                  dataKey="displayTime"
                  stroke="#4E5664"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="JetBrains Mono, monospace"
                />
                <YAxis
                  allowDecimals={false}
                  stroke="#4E5664"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="JetBrains Mono, monospace"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0C1017',
                    borderColor: '#1B2230',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                  itemStyle={{ padding: '1px 0' }}
                />
                <Bar
                  dataKey="failedLogins"
                  name="Failed Logins"
                  fill="#F2495C"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px] font-mono text-text-muted">
          <span>Threshold: &gt;3 attempts triggers investigation</span>
          <span className="text-health-excellent">Rate-Limiting Active</span>
        </div>
      </div>

      {/* Grafana-style Live Telemetry & Event Log Stream (7 cols) */}
      <div className="lg:col-span-7 rounded border border-border bg-surface p-4 transition-all hover:border-border-focus flex flex-col">
        <div className="flex items-center justify-between border-b border-border/70 pb-2.5 mb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-accent-emerald/10 text-accent-emerald">
              <Terminal className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Live Sanitized Event & Metadata Stream
            </span>
          </div>
          <span className="rounded bg-canvas border border-border px-2 py-0.5 text-[10px] font-mono text-accent-emerald">
            ALLOW-LISTED STREAM
          </span>
        </div>

        {/* Live Terminal Log Viewer */}
        <div className="flex-1 bg-canvas rounded border border-border p-2.5 font-mono text-xs overflow-y-auto max-h-48 space-y-1.5">
          {logs.length === 0 ? (
            <div className="py-8 text-center text-text-dim text-[11px]">
              Listening for inbound verified telemetry events...
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-2.5 text-[11px] leading-relaxed border-b border-border/30 pb-1 last:border-b-0 hover:bg-surface-elevated/40 px-1 rounded transition-colors"
              >
                <span className="text-text-muted tabular-nums shrink-0">{log.event_time}</span>
                <span
                  className={`px-1 rounded text-[9px] font-bold shrink-0 uppercase ${
                    log.status === 'anomalous'
                      ? 'bg-accent-crimson/20 text-accent-crimson border border-accent-crimson/40'
                      : log.status === 'stale'
                      ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/40'
                      : 'bg-accent-emerald/20 text-accent-emerald border border-accent-emerald/40'
                  }`}
                >
                  {log.health}
                </span>
                <span className="text-series-cpu font-semibold shrink-0">{log.service}</span>
                <span className="text-text-muted font-sans truncate">{log.summary}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
