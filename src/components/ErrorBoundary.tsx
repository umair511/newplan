import * as React from 'react';
import { AlertOctagon, RefreshCw, RotateCcw, Home } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  public override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error in React Component Tree:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetState = () => {
    try {
      localStorage.removeItem('gpak_jumbo_requirements');
      localStorage.removeItem('gpak_jumbo_rolls');
      localStorage.removeItem('gpak_metallizer_plans');
      localStorage.removeItem('gpak_metallizer_settings');
      localStorage.removeItem('gpak_active_orders');
    } catch (e) {
      console.error('Failed to clear localStorage:', e);
    }
    window.location.reload();
  };

  private handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 shrink-0">
                <AlertOctagon className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-rose-950 text-rose-300 border border-rose-800 rounded font-mono">
                  UI Protection Guard Active
                </span>
                <h1 className="text-xl font-bold text-white">
                  {this.props.fallbackTitle || 'Application State Recovery'}
                </h1>
                <p className="text-xs text-slate-400">
                  {this.props.fallbackMessage ||
                    'An unexpected rendering issue occurred during operation. The application prevented a crash and protected your session state.'}
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-48 space-y-1">
                <div className="text-rose-400 font-bold">
                  {this.state.error.name}: {this.state.error.message}
                </div>
                {this.state.error.stack && (
                  <pre className="text-[11px] text-slate-500 whitespace-pre-wrap">
                    {this.state.error.stack.split('\n').slice(0, 5).join('\n')}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={this.handleReload}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer shadow-md"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reload Application</span>
                </button>

                <button
                  onClick={this.handleDismiss}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>Dismiss & Continue</span>
                </button>
              </div>

              <button
                onClick={this.handleResetState}
                className="px-3.5 py-2 bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Clears cached session data and resets workspace to defaults"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Workspace State</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
