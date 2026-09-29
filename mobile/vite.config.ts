import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base: Capacitor serves the bundle from the app's local web root,
  // so absolute "/assets/..." paths can 404 on device.
  base: "./",
  build: {
    outDir: "dist",
  },
});
