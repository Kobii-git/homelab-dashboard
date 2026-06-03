import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const gitSha = (process.env.APP_GIT_SHA ?? "dev").slice(0, 7);

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  publicDir: "../../public",
  define: {
    __APP_GIT_SHA__: JSON.stringify(gitSha)
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4173",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
