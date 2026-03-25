import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");

  // Only activate Sentry source-map upload in production CI builds.
  // Requires SENTRY_AUTH_TOKEN + VITE_SENTRY_DSN set in Vercel environment variables.
  const sentryPlugin =
    mode === "production" && env.SENTRY_AUTH_TOKEN && env.VITE_SENTRY_DSN
      ? sentryVitePlugin({
          org: env.SENTRY_ORG ?? "experiencecaddie",
          project: env.SENTRY_PROJECT ?? "experience-caddie-web",
          authToken: env.SENTRY_AUTH_TOKEN,
          sourcemaps: {
            filesToDeleteAfterUpload: ["./dist/**/*.map"],
          },
          telemetry: false,
        })
      : null;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      sentryPlugin,
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Generate source maps in production so Sentry can upload them.
    // The Sentry plugin deletes them from the bundle after upload.
    build: {
      sourcemap: mode === "production",
    },
  };
});
