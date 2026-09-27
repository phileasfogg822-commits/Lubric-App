import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a failure shows a readable message with a Reload
 * button instead of leaving the user on a blank white page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught a render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: 24, maxWidth: 760, margin: "48px auto" }}>
        <div style={{ background: "white", border: "1px solid var(--color-border)", borderLeft: "4px solid var(--color-danger)", borderRadius: 8, padding: 20 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 6 }}>Something went wrong on this screen</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: 14 }}>
            Your data is safe. Reload to carry on — if it keeps happening, send the message below to your developer.
          </p>
          <pre style={{ background: "#f8fafc", border: "1px solid var(--color-border)", borderRadius: 6, padding: 12, fontSize: "0.72rem", whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", marginBottom: 14 }}>
            {error.message}
            {error.stack ? "\n\n" + error.stack : ""}
          </pre>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn btn-ghost btn-sm" onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </div>
      </div>
    );
  }
}