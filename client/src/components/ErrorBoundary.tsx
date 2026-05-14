import { Component, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error("[ErrorBoundary] Caught error:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full bg-white border border-red-200 rounded-xl shadow-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2L2 16h16L10 2z" stroke="#DC2626" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M10 8v4M10 13.5v.5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900">Something went wrong</p>
                <p className="text-sm text-gray-500">The app encountered an unexpected error.</p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <p className="text-xs font-mono text-red-700 break-all">{this.state.error.message}</p>
            </div>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="w-full py-2 px-4 bg-[#256984] text-white text-sm font-medium rounded-lg hover:bg-[#1d5470] transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
