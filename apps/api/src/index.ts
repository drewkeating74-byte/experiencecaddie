import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
];

let loaded = false;
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    config({ path: p });
    if (process.env.TICKETMASTER_CONSUMER_KEY || process.env.TICKETMASTER_API_KEY) {
      console.log(`[env] Loaded from ${p}`);
      loaded = true;
      break;
    }
  }
}
if (!loaded && !process.env.TICKETMASTER_CONSUMER_KEY && !process.env.TICKETMASTER_API_KEY) {
  console.warn("[env] TICKETMASTER key not found. Tried:", envPaths);
}
import express from "express";
import cors from "cors";
import routes from "./routes/index.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", routes);

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "experiencecaddie-api" });
});

function startServer(port: number) {
  const server = app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port === 4000) {
      console.warn(`Port 4000 in use, trying 4001...`);
      startServer(4001);
    } else {
      throw err;
    }
  });
}
startServer(port);
