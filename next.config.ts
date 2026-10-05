import type { NextConfig } from "next";
const config: NextConfig = {
  // Preserve the read-only project instructions supplied by the workspace.
  agentRules: false,
  devIndicators: false,
};
export default config;
