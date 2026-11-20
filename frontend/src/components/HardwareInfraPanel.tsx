import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Cpu, HardDrive } from 'lucide-react';
import { TelemetryDataPoint } from '../types/telemetry';

interface HardwareInfraPanelProps {
  serviceName: string;
  history: TelemetryDataPoint[];
  currentDisk: number;
}

export const HardwareInfraPanel: React.FC<HardwareInfraPanelProps> = ({
  serviceName,
  history,
  currentDisk,
}) => {
  return (
    <div className="rounded border border-border bg-surface p-4 transition-all hover:border-border-focus">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/70 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-series-cpu/10 text-series-cpu">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Hardware & Infrastructure
            </span>
            <span className="ml-2 text-[11px] font-mono text-series-cpu font-semibold">
              [{serviceName}]
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-series-cpu">
            <span className="h-2 w-2 rounded-full bg-series-cpu" /> CPU %
          </span>
          <span className="flex items-center gap-1 text-series-memory">
            <span className="h-2 w-2 rounded-full bg-series-memory" /> Mem %
          </span>
          <span className="flex items-center gap-1 text-series-disk">
            <span className="h-2 w-2 rounded-full bg-series-disk" /> Disk % ({currentDisk}%)
          </span>
        </div>
      </div>

      {/* Recharts Dual-Line Chart */}
      <div className="h-52 w-full">
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-text-muted font-mono">
            Accumulating live infrastructure telemetry...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#151B27" vertical={false} />
              <XAxis
                dataKey="displayTime"
                stroke="#4E5664"
                fontSize={10}
                tickLine={false}
                fontFamily="JetBrains Mono, monospace"
              />
              <YAxis
                domain={[0, 100]}
                stroke="#4E5664"
                fontSize={10}
                tickLine={false}
                fontFamily="JetBrains Mono, monospace"
                unit="%"
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
                y={90}
                stroke="#F2495C"
                strokeDasharray="4 4"
                label={{ value: 'Critical 90%', fill: '#F2495C', fontSize: 9 }}
              />
              <ReferenceLine
                y={75}
                stroke="#F59E0B"
                strokeDasharray="4 4"
                label={{ value: 'Warn 75%', fill: '#F59E0B', fontSize: 9 }}
              />
              <Line
                type="monotone"
                dataKey="cpu"
                name="CPU"
                stroke="#38BDF8"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="memory"
                name="Memory"
                stroke="#A78BFA"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Disk utilization progress bar */}
      <div className="mt-2.5 flex items-center gap-3 border-t border-border/40 pt-2 text-[11px] font-mono">
        <span className="text-text-muted flex items-center gap-1">
          <HardDrive className="h-3 w-3 text-series-disk" /> Disk Volume:
        </span>
        <div className="flex-1 bg-canvas h-1.5 rounded-full overflow-hidden border border-border">
          <div
            className="bg-series-disk h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, currentDisk))}%` }}
          />
        </div>
        <span className="text-text-primary font-bold">{currentDisk.toFixed(1)}%</span>
      </div>
    </div>
  );
};
