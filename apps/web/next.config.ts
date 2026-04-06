import { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Use loose ESM externals handling so CommonJS/ESM interop for dependencies
  // (like `react`) behaves predictably in the dev server/bundler.
  experimental: {
    // Disable ESM externalization so the bundler treats dependencies like React
    // as CommonJS for compatibility with the dev server/runtime.
    esmExternals: false,
  },
};

export default config;
