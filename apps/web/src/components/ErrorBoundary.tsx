import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-error" role="alert">
        <div className="app-error__eyebrow">Application error</div>
        <h1 className="app-error__title">SliceX hit a fatal error.</h1>
        <p className="app-error__body">
          The editor crashed. Reload the page or try again after fixing the
          underlying issue.
        </p>
        <button
          type="button"
          className="app-error__action"
          onClick={this.reset}
        >
          Try again
        </button>
      </main>
    );
  }
}
