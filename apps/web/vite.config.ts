import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");
  console.log("[vite-build] VITE_SENTRY_DSN length:", env.VITE_SENTRY_DSN?.length ?? 0, "| VITE_APP_ENV:", env.VITE_APP_ENV ?? "(unset)");

  // Virtual module approach: the most reliable way to inject build-time values into
  // Vite app code. monitoring.ts imports from "virtual:ec-env" which resolves to this
  // generated module containing the actual values baked in at build time.
  const VIRTUAL_ID = "virtual:ec-env";
  const RESOLVED_VIRTUAL_ID = "\0virtual:ec-env";
  const ecEnvPlugin = {
    name: "ec-env-inject",
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },
    load(id: string) {
      if (id !== RESOLVED_VIRTUAL_ID) return;
      const dsn = env.VITE_SENTRY_DSN ?? "";
      const appEnv = env.VITE_APP_ENV ?? "";
      console.log("[ec-env-inject] virtual module loaded | dsn-len:", dsn.length, "| app-env:", appEnv);
      return `export const SENTRY_DSN = ${JSON.stringify(dsn)};
export const APP_ENV = ${JSON.stringify(appEnv)};`;
    },
  };

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
      ecEnvPlugin,
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
