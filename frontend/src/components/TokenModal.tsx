import React from 'react';
import { KeyRound, Shield, X } from 'lucide-react';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentToken: string;
  onSaveToken: (token: string) => void;
}

export const TokenModal: React.FC<TokenModalProps> = ({
  isOpen,
  onClose,
  currentToken,
  onSaveToken,
}) => {
  const [tokenInput, setTokenInput] = React.useState(currentToken);

  React.useEffect(() => {
    setTokenInput(currentToken);
  }, [currentToken, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveToken(tokenInput.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface shadow-popover p-5 animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              Local Development SaaS Access
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
              Development Token
            </label>
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Enter a provisioned bearer token"
              required
              className="w-full px-3 py-1.5 rounded border border-border bg-surface text-xs text-text-primary font-mono focus:border-accent focus:outline-none"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Use only the separate <code>SAAS_DASHBOARD_DEV_TOKEN</code> configured on a local development API. Never enter a collector delivery credential.
            </p>
          </div>

          {/* Security note */}
          <div className="flex items-start gap-2 p-2.5 rounded bg-surface-secondary border border-border text-[11px] text-text-secondary">
            <Shield className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <span>
              The server derives tenant scope from the credential. This form cannot select or override a tenant. The token stays in page memory only.
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
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
