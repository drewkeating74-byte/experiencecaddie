import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");
  console.log("[vite-build] VITE_SENTRY_DSN length:", env.VITE_SENTRY_DSN?.length ?? 0, "| VITE_APP_ENV:", env.VITE_APP_ENV ?? "(unset)");

  const dsn = env.VITE_SENTRY_DSN ?? "";
  const appEnv = env.VITE_APP_ENV ?? "";
  const callId = Math.random().toString(36).slice(2, 6);
  console.log(`[ec-env-inject][${callId}] config called | dsn-len:`, dsn.length, "| app-env:", appEnv);

  // Inject DSN into HTML as meta tags — bypasses Rollup entirely.
  const ecEnvPlugin = {
    name: "ec-env-inject",
    transformIndexHtml(html: string) {
      console.log(`[ec-env-inject][${callId}] transformIndexHtml | dsn-len:`, dsn.length);
      return html.replace(
        "</head>",
        `<meta name="ec-sentry-dsn" content="${dsn}"><meta name="ec-app-env" content="${appEnv}"></head>`
      );
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
