/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The API is reached at /api on the page's own origin. In development the
// dev server forwards it to API Gateway; when hosted, CloudFront does. Either
// way the browser makes same-origin calls, so the API needs no CORS policy.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true, // Cognito's callback URL names this port exactly
      proxy: env.ATRIA_API_ORIGIN
        ? {
            "/api": {
              target: env.ATRIA_API_ORIGIN,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, env.ATRIA_API_STAGE ?? "/dev"),
            },
          }
        : undefined,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["src/test/setup.ts"],
      // Typing a whole form with user-event is slow on a synced folder.
      testTimeout: 20000,
    },
  };
});
