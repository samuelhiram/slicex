"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main className="global-error" role="alert">
          <div className="global-error__eyebrow">Global error</div>
          <h1 className="global-error__title">
            SliceX hit a fatal application error.
          </h1>
          <p className="global-error__body">
            The root layout failed. Inspect the Next.js terminal output and
            reload after fixing the issue.
          </p>
          <button
            type="button"
            className="global-error__action"
            onClick={reset}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
