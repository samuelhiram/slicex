import { ErrorBoundary } from "./components/ErrorBoundary";
import { PlaylistShell } from "./components/PlaylistShell";

export function App() {
  return (
    <ErrorBoundary>
      <main className="playlist-page">
        <PlaylistShell />
      </main>
    </ErrorBoundary>
  );
}
