import React from 'react';

export type StatusBadgeVariant =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'online'
  | 'stale'
  | 'offline'
  | 'active'
  | 'investigating'
  | 'resolved'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

interface StatusBadgeProps {
  status: string;
  label?: string;
  isStale?: boolean;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  isStale,
  className = '',
}) => {
  const norm = (status || '').toLowerCase();

  if (isStale) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border border-[#C2414B]/30 bg-[#FDF2F2] text-[#C2414B] ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#C2414B]" />
        {label || 'POOR (STALE)'}
      </span>
    );
  }

  // Styles per status
  const styleMap: Record<string, { bg: string; text: string; border: string; dot: string; textLabel: string }> = {
    excellent: {
      bg: 'bg-[#EAF5F0]',
      text: 'text-[#23865B]',
      border: 'border-[#23865B]/30',
      dot: 'bg-[#23865B]',
      textLabel: 'EXCELLENT',
    },
    good: {
      bg: 'bg-[#EFF4FC]',
      text: 'text-[#3267C8]',
      border: 'border-[#3267C8]/30',
      dot: 'bg-[#3267C8]',
      textLabel: 'GOOD',
    },
    fair: {
      bg: 'bg-[#FEF7EC]',
      text: 'text-[#B7791F]',
      border: 'border-[#B7791F]/30',
      dot: 'bg-[#B7791F]',
      textLabel: 'FAIR',
    },
    poor: {
      bg: 'bg-[#FDF2F2]',
      text: 'text-[#C2414B]',
      border: 'border-[#C2414B]/30',
      dot: 'bg-[#C2414B]',
      textLabel: 'POOR',
    },
    online: {
      bg: 'bg-[#EAF5F0]',
      text: 'text-[#23865B]',
      border: 'border-[#23865B]/30',
      dot: 'bg-[#23865B]',
      textLabel: 'ONLINE',
    },
    stale: {
      bg: 'bg-[#FEF7EC]',
      text: 'text-[#B7791F]',
      border: 'border-[#B7791F]/30',
      dot: 'bg-[#B7791F]',
      textLabel: 'STALE',
    },
    offline: {
      bg: 'bg-[#F1F5F9]',
      text: 'text-[#64748B]',
      border: 'border-[#CBD5E1]',
      dot: 'bg-[#94A3B8]',
      textLabel: 'OFFLINE',
    },
    critical: {
      bg: 'bg-[#FDF2F2]',
      text: 'text-[#C2414B]',
      border: 'border-[#C2414B]/30',
      dot: 'bg-[#C2414B]',
      textLabel: 'CRITICAL',
    },
    high: {
      bg: 'bg-[#FEF7EC]',
      text: 'text-[#B7791F]',
      border: 'border-[#B7791F]/30',
      dot: 'bg-[#B7791F]',
      textLabel: 'HIGH',
    },
    medium: {
      bg: 'bg-[#EFF4FC]',
      text: 'text-[#3267C8]',
      border: 'border-[#3267C8]/30',
      dot: 'bg-[#3267C8]',
      textLabel: 'MEDIUM',
    },
    low: {
      bg: 'bg-[#F8FAFC]',
      text: 'text-[#64748B]',
      border: 'border-[#E2E8F0]',
      dot: 'bg-[#94A3B8]',
      textLabel: 'LOW',
    },
    active: {
      bg: 'bg-[#FDF2F2]',
      text: 'text-[#C2414B]',
      border: 'border-[#C2414B]/30',
      dot: 'bg-[#C2414B]',
      textLabel: 'ACTIVE',
    },
    investigating: {
      bg: 'bg-[#FEF7EC]',
      text: 'text-[#B7791F]',
      border: 'border-[#B7791F]/30',
      dot: 'bg-[#B7791F]',
      textLabel: 'INVESTIGATING',
    },
    resolved: {
      bg: 'bg-[#EAF5F0]',
      text: 'text-[#23865B]',
      border: 'border-[#23865B]/30',
      dot: 'bg-[#23865B]',
      textLabel: 'RESOLVED',
    },
  };

  const style = styleMap[norm] || {
    bg: 'bg-[#F8FAFC]',
    text: 'text-[#64748B]',
    border: 'border-[#E2E8F0]',
    dot: 'bg-[#94A3B8]',
    textLabel: status.toUpperCase(),
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border ${style.border} ${style.bg} ${style.text} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {label || style.textLabel}
    </span>
  );
};
