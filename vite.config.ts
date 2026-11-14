import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Tauri prints its own logs to the same terminal; keep them visible.
  clearScreen: false,
  // Tauri's devUrl points at this exact port, so fail instead of picking another.
  server: { port: 1420, strictPort: true },
});
