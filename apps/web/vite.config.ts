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

  // Explicitly forward VITE_* env vars into the client bundle via define.
  // Required because npm --prefix changes cwd in a way that breaks Vite's
  // automatic process.env injection for non-.env-file variables.
  const defineEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (key.startsWith("VITE_")) {
      defineEnv[`import.meta.env.${key}`] = JSON.stringify(val);
    }
  }

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: defineEnv,
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
