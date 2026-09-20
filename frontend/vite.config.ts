import { defineConfig } from "vite";
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [".."] },
    // One origin for SPA and API, as the contract requires; the backend runs separately.
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
});
