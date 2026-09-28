import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Next's recommended rules (React, hooks, accessibility, Core Web Vitals) plus TypeScript. */
const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", ".test-build/**", ".demo-data/**", "node_modules/**", "next-env.d.ts"] },
];

export default config;
