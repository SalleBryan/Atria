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
      // Placeholders, so no test reads a real pool and a run without
      // web/.env.local (as in CI) behaves exactly like one with it.
      env: {
        VITE_REGION: "us-east-1",
        VITE_USER_POOL_ID: "us-east-1_TESTPOOL",
        VITE_PATIENT_CLIENT_ID: "test-patient-client",
        VITE_STAFF_CLIENT_ID: "test-staff-client",
        VITE_AUTH_DOMAIN: "atria-test.auth.us-east-1.amazoncognito.com",
      },
      // Typing a whole form with user-event is slow on a synced folder.
      testTimeout: 20000,
    },
  };
});
