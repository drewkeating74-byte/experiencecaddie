import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");
  console.log("[vite-build] VITE_SENTRY_DSN length:", env.VITE_SENTRY_DSN?.length ?? 0, "| VITE_APP_ENV:", env.VITE_APP_ENV ?? "(unset)");

  // Inline the Vercel env vars directly into monitoring.ts at build time.
  // Vite's define and import.meta.env both fail to pick up process.env vars
  // in this monorepo --prefix build setup, so we use a transform plugin instead.
  const ecEnvPlugin = {
    name: "ec-env-inject",
    transform(code: string, id: string) {
      if (!id.includes("monitoring")) return null;
      const dsnJson = JSON.stringify(env.VITE_SENTRY_DSN ?? "");
      const appEnvJson = JSON.stringify(env.VITE_APP_ENV ?? "");
      console.log("[ec-env-inject] id:", id);
      console.log("[ec-env-inject] dsn-json-len:", dsnJson.length, "| app-env-json:", appEnvJson);
      console.log("[ec-env-inject] placeholder-found:", code.includes('"__EC_SENTRY_DSN_PLACEHOLDER__"'));
      return code
        .replace(/"__EC_SENTRY_DSN_PLACEHOLDER__"/g, dsnJson)
        .replace(/"__EC_APP_ENV_PLACEHOLDER__"/g, appEnvJson);
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
