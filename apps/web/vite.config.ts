import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");

  // Source-map upload disabled until SENTRY_ORG/SENTRY_PROJECT are confirmed correct.
  // Re-enable by un-commenting the sentryVitePlugin block below.
  const sentryPlugin = null;

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
