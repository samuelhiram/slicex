"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="app-error" role="alert">
      <div className="app-error__eyebrow">Route error</div>
      <h1 className="app-error__title">The editor crashed in this route.</h1>
      <p className="app-error__body">
        Next.js caught the failure. Check the terminal for browser logs and
        retry the route.
      </p>
      <button type="button" className="app-error__action" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
