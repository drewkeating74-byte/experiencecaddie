import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";

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
          // Upload source maps so Sentry shows readable stack traces, then delete them
          // from the final bundle so they're not publicly accessible.
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
        "@": path.resolve(__dirname, "apps/web/src"),
        "src": path.resolve(__dirname, "apps/web/src"),
      },
    },
    publicDir: path.resolve(__dirname, "apps/web/public"),
    css: {
      postcss: path.resolve(__dirname, "apps/web"),
    },
    // Generate source maps in production so Sentry can read them.
    // They are uploaded then deleted by the Sentry plugin above.
    build: {
      sourcemap: mode === "production",
    },
  };
});
