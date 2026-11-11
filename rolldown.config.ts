import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  platform: "node",
  transform: { target: "node24" },
  output: { file: "dist/index.js", format: "esm", minify: true },
});
