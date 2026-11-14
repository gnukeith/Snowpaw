import { defineConfig } from "vite";

// A separate module graph keeps every renderer dependency under /frames/ and
// prevents the app entry from preloading Mermaid or sharing privileged code.
export default defineConfig({
  root: "src/frames",
  base: "./",
  build: {
    outDir: "../../dist/frames",
    emptyOutDir: true,
    rollupOptions: { input: "src/frames/diagram.html" },
  },
});
