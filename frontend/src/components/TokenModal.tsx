import React from 'react';
import { KeyRound, Shield, X } from 'lucide-react';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTenant: string;
  currentToken: string;
  onSaveToken: (tenant: string, token: string) => void;
}

export const TokenModal: React.FC<TokenModalProps> = ({
  isOpen,
  onClose,
  currentTenant,
  currentToken,
  onSaveToken,
}) => {
  const [tenantInput, setTenantInput] = React.useState(currentTenant);
  const [tokenInput, setTokenInput] = React.useState(currentToken);

  React.useEffect(() => {
    setTenantInput(currentTenant);
    setTokenInput(currentToken);
  }, [currentTenant, currentToken, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveToken(tenantInput.trim(), tokenInput.trim());
    onClose();
  };

  const setPresetDevelopment = () => {
    setTenantInput('development-tenant');
    setTokenInput('dev-secret-token-12345');
  };

  const setPresetAlpha = () => {
    setTenantInput('tenant-alpha');
    setTokenInput('token-alpha-test');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface shadow-popover p-5 animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              Tenant Authentication & Scope
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Tenant Identifier
            </label>
            <input
              type="text"
              value={tenantInput}
              onChange={(e) => setTenantInput(e.target.value)}
              placeholder="e.g. development-tenant"
              required
              className="w-full px-3 py-1.5 rounded border border-border bg-surface text-xs text-text-primary font-mono focus:border-accent focus:outline-none"
            />
            <p className="text-[11px] text-text-muted mt-1">
              SaaS verifies this tenant matches the authenticated collector credential.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Bearer Token
            </label>
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="e.g. dev-secret-token-12345"
              required
              className="w-full px-3 py-1.5 rounded border border-border bg-surface text-xs text-text-primary font-mono focus:border-accent focus:outline-none"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Default is <code className="font-mono text-accent">dev-secret-token-12345</code> from <code className="font-mono">.env</code>.
            </p>
          </div>

          {/* Quick Presets */}
          <div className="pt-1">
            <span className="text-[11px] font-medium text-text-muted block mb-1.5">
              Quick Presets:
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={setPresetDevelopment}
                className="px-2.5 py-1 rounded border border-border bg-surface-secondary hover:bg-surface-hover text-xs font-mono text-text-primary transition-colors"
              >
                development-tenant
              </button>
              <button
                type="button"
                onClick={setPresetAlpha}
                className="px-2.5 py-1 rounded border border-border bg-surface-secondary hover:bg-surface-hover text-xs font-mono text-text-primary transition-colors"
              >
                tenant-alpha
              </button>
            </div>
          </div>

          {/* Security note */}
          <div className="flex items-start gap-2 p-2.5 rounded bg-surface-secondary border border-border text-[11px] text-text-secondary">
            <Shield className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <span>
              All dashboard queries are tenant-scoped. Cross-tenant reads return RFC 7807 403 Forbidden.
            </span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-xs font-medium text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
            >
              Apply Token
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
