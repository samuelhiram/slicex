import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx"],
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  logging: {
    browserToTerminal: "error",
    incomingRequests: {
      ignore: [
        /^\/_next\//,
        /^\/favicon\.ico$/,
        /^\/robots\.txt$/,
        /^\/manifest\.json$/,
      ],
    },
  },
};

export default config;
