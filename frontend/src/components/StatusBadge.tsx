import React from 'react';

interface StatusBadgeProps { status: string; label?: string; isStale?: boolean; className?: string }

const variants: Record<string, { label: string; className: string; marker: string }> = {
  excellent: { label: 'EXCELLENT', className: 'border-[#77786F] bg-[#E8E6DE] text-ink', marker: 'bg-[#55564F]' },
  good: { label: 'GOOD', className: 'border-[#AAA99F] bg-[#F8F7F2] text-ink', marker: 'bg-ink' },
  fair: { label: 'FAIR', className: 'border-[#8D8E85] bg-[#E8E6DE] text-ink', marker: 'bg-[#62635D]' },
  poor: { label: 'POOR', className: 'border-signal bg-[#F3E4DF] text-[#8F2D27]', marker: 'bg-signal' },
  online: { label: 'ONLINE', className: 'border-[#77786F] bg-[#E8E6DE] text-ink', marker: 'bg-ink' },
  stale: { label: 'STALE', className: 'border-[#8D8E85] bg-[#E8E6DE] text-ink', marker: 'bg-[#62635D]' },
  offline: { label: 'OFFLINE', className: 'border-[#AAA99F] bg-[#E8E6DE] text-ink', marker: 'bg-[#8D8E85]' },
  active: { label: 'ACTIVE', className: 'border-signal bg-[#F3E4DF] text-[#8F2D27]', marker: 'bg-signal' },
  investigating: { label: 'INVESTIGATING', className: 'border-[#77786F] bg-[#E8E6DE] text-ink', marker: 'bg-ink' },
  resolved: { label: 'RESOLVED', className: 'border-[#AAA99F] bg-[#F8F7F2] text-ink', marker: 'bg-[#8D8E85]' },
  critical: { label: 'CRITICAL', className: 'border-signal bg-[#F3E4DF] text-[#8F2D27]', marker: 'bg-signal' },
  high: { label: 'HIGH', className: 'border-[#77786F] bg-[#E8E6DE] text-ink', marker: 'bg-ink' },
  medium: { label: 'MEDIUM', className: 'border-[#AAA99F] bg-[#F8F7F2] text-ink', marker: 'bg-[#62635D]' },
  low: { label: 'LOW', className: 'border-[#D8D5CB] bg-[#F8F7F2] text-[#65665E]', marker: 'bg-[#8D8E85]' },
  informational: { label: 'INFORMATIONAL', className: 'border-[#D8D5CB] bg-[#F8F7F2] text-[#65665E]', marker: 'bg-[#8D8E85]' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, isStale = false, className = '' }) => {
  const normalized = isStale ? 'stale' : (status || 'unavailable').toLowerCase();
  const variant = variants[normalized] || { label: normalized.toUpperCase(), className: 'border-[#D8D5CB] bg-[#F8F7F2] text-[#65665E]', marker: 'bg-[#8D8E85]' };
  return <span aria-label={label || variant.label} className={`inline-flex items-center gap-2 border px-2 py-1 text-[10px] font-mono font-semibold tracking-wide ${variant.className} ${className}`}><span aria-hidden="true" className={`h-1.5 w-1.5 ${variant.marker}`} />{label || variant.label}</span>;
};
