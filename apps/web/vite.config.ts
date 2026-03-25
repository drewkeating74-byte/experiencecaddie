import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");
  console.log("[vite-build] VITE_SENTRY_DSN length:", env.VITE_SENTRY_DSN?.length ?? 0, "| VITE_APP_ENV:", env.VITE_APP_ENV ?? "(unset)");

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
    define: {
      __EC_SENTRY_DSN__: JSON.stringify(env.VITE_SENTRY_DSN ?? ""),
      __EC_APP_ENV__: JSON.stringify(env.VITE_APP_ENV ?? ""),
      __EC_TEST__: JSON.stringify("define-is-working"),
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
    build: {
      sourcemap: false,
    },
  };
});
