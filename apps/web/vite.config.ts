import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { writeFileSync } from "fs";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");
  console.log("[vite-build] VITE_SENTRY_DSN length:", env.VITE_SENTRY_DSN?.length ?? 0, "| VITE_APP_ENV:", env.VITE_APP_ENV ?? "(unset)");

  // Write a real TypeScript file at build time containing the env values.
  // This is more reliable than virtual modules or define in this monorepo setup.
  const configFilePath = path.resolve(__dirname, "src/lib/ec-build-config.ts");
  const dsn = env.VITE_SENTRY_DSN ?? "";
  const appEnv = env.VITE_APP_ENV ?? "";
  console.log("[ec-env-inject] writing config | dsn-len:", dsn.length, "| app-env:", appEnv);
  writeFileSync(
    configFilePath,
    `// Auto-generated at build time by vite.config.ts — do not edit\nexport const EC_DSN = ${JSON.stringify(dsn)};\nexport const EC_APP_ENV = ${JSON.stringify(appEnv)};\n`
  );
  const ecEnvPlugin = null;

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
