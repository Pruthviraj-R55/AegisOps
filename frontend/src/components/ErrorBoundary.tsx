import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep diagnostics local; render errors may contain tenant response data.
    console.error('Dashboard rendering failed', error.name, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <main role="alert" className="grid min-h-screen place-items-center bg-app p-6 text-ink"><section className="max-w-lg border border-border bg-surface p-6"><AlertTriangle className="mb-4 h-6 w-6 text-signal" /><h1 className="text-xl font-semibold">This view could not be rendered</h1><p className="mt-2 text-sm text-text-secondary">The dashboard caught a rendering error. Reload this view to try again.</p><button className="mt-5 flex items-center gap-2 bg-ink px-4 py-2 text-sm text-paper" onClick={() => this.setState({ error: null })}><RotateCcw className="h-4 w-4" />Try again</button></section></main>;
    }
    return this.props.children;
  }
}
