"use client";
import React from "react";
import { CanvasShell } from "../components/CanvasShell";

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#f8fafc",
        color: "#0f172a",
      }}
    >
      <header style={{ padding: "24px 32px 16px" }}>
        <h1 style={{ margin: 0 }}>SliceX — Editor shell</h1>
        <p style={{ margin: "8px 0 0", color: "#475569" }}>
          Canvas engine wiring for the timeline workspace.
        </p>
      </header>
      <section
        id="editor-root"
        style={{ flex: 1, minHeight: 0, padding: "0 24px 24px" }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            border: "1px solid #cbd5e1",
            borderRadius: 16,
            background: "#ffffff",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
          }}
        >
          <CanvasShell />
        </div>
      </section>
    </main>
  );
}
