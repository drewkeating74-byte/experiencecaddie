import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env so we can read SENTRY_AUTH_TOKEN and VITE_SENTRY_DSN at build time.
  const env = loadEnv(mode, process.cwd(), "");
  const dsn = env.VITE_SENTRY_DSN ?? "";
  const appEnv = env.VITE_APP_ENV ?? "";

  // Inject DSN into HTML as meta tags — bypasses Rollup entirely.
  // See scripts/inject-config.cjs for the post-build step that writes the real values.
  const ecEnvPlugin = {
    name: "ec-env-inject",
    transformIndexHtml(html: string) {
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
