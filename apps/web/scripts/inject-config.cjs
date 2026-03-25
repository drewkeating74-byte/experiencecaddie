// Post-build script: injects Vercel env vars into dist/index.html as meta tags.
// Runs after `vite build` so nothing in Vite's pipeline can interfere.
const fs = require("fs");
const path = require("path");

const dsn = process.env.VITE_SENTRY_DSN || "";
const appEnv = process.env.VITE_APP_ENV || "";

console.log("[inject-config] dsn-len:", dsn.length, "| app-env:", appEnv);

const htmlPath = path.resolve(__dirname, "../dist/index.html");
let html = fs.readFileSync(htmlPath, "utf8");

// Remove any empty placeholder meta tags added by the Vite plugin
html = html.replace(/<meta name="ec-sentry-dsn"[^>]*>/g, "");
html = html.replace(/<meta name="ec-app-env"[^>]*>/g, "");

// Inject with real values
html = html.replace(
  "</head>",
  `<meta name="ec-sentry-dsn" content="${dsn}"><meta name="ec-app-env" content="${appEnv}"></head>`
);

fs.writeFileSync(htmlPath, html);
console.log("[inject-config] done. meta tags written to dist/index.html");
