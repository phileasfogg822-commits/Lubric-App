import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// `tauri build` / `tauri dev` set TAURI_ENV_PLATFORM for beforeBuildCommand
// and beforeDevCommand. A Tauri window is not a browser tab: a service
// worker would cache the app shell and serve stale builds after an update,
// so the PWA plugin is off for Tauri and stays on for the web build.
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(isTauriBuild
      ? []
      : [
          VitePWA({
            registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
      manifest: {
        name: "Lubric POS",
        short_name: "Lubric POS",
        description: "Lubricant Shop POS & Management System",
        theme_color: "#1e40af",
        background_color: "#ffffff",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
          }),
        ]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: process.env.API_PROXY_URL || "http://backend:3001",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
