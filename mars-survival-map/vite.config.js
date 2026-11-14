import { defineConfig } from "vite";

// base relativa: funciona en GitHub Pages (subcarpeta) y en Netlify sin cambios
export default defineConfig({
  base: "./",
  server: { port: 5173, host: "127.0.0.1" },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
