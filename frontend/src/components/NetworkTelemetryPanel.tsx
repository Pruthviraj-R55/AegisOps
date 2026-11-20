import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Network } from 'lucide-react';
import { TelemetryDataPoint } from '../types/telemetry';

interface NetworkTelemetryPanelProps {
  serviceName: string;
  history: TelemetryDataPoint[];
}

export const NetworkTelemetryPanel: React.FC<NetworkTelemetryPanelProps> = ({
  serviceName,
  history,
}) => {
  return (
    <div className="rounded border border-border bg-surface p-4 transition-all hover:border-border-focus">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/70 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-series-latency/10 text-series-latency">
            <Network className="h-3.5 w-3.5" />
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Network Telemetry & Round-Trip SLA
            </span>
            <span className="ml-2 text-[11px] font-mono text-series-latency font-semibold">
              [{serviceName}]
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-series-latency">
            <span className="h-2 w-2 rounded-full bg-series-latency" /> Latency ms
          </span>
          <span className="flex items-center gap-1 text-series-packetLoss">
            <span className="h-2 w-2 rounded-full bg-series-packetLoss" /> Packet Loss %
          </span>
        </div>
      </div>

      {/* Recharts Area Chart for Latency + Line for Packet Loss */}
      <div className="h-52 w-full">
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-text-muted font-mono">
            Accumulating live network telemetry...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#151B27" vertical={false} />
              <XAxis
                dataKey="displayTime"
                stroke="#4E5664"
                fontSize={10}
                tickLine={false}
                fontFamily="JetBrains Mono, monospace"
              />
              <YAxis
                stroke="#4E5664"
                fontSize={10}
                tickLine={false}
                fontFamily="JetBrains Mono, monospace"
                unit="ms"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0C1017',
                  borderColor: '#1B2230',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono, monospace',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                }}
                itemStyle={{ padding: '1px 0' }}
              />
              <ReferenceLine
                y={500}
                stroke="#F2495C"
                strokeDasharray="4 4"
                label={{ value: 'Critical 500ms', fill: '#F2495C', fontSize: 9 }}
              />
              <ReferenceLine
                y={250}
                stroke="#F59E0B"
                strokeDasharray="4 4"
                label={{ value: 'Warn 250ms', fill: '#F59E0B', fontSize: 9 }}
              />
              <Area
                type="monotone"
                dataKey="latency"
                name="Latency (ms)"
                stroke="#F59E0B"
                fill="#F59E0B"
                fillOpacity={0.12}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="packetLoss"
                name="Packet Loss (%)"
                stroke="#F2495C"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] font-mono text-text-muted">
        <span>SLA Baseline: &lt;250ms Nominal Response</span>
        <span className="text-health-excellent">Zero Packet Drops Reported</span>
      </div>
    </div>
  );
};
