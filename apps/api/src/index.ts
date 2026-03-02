import "dotenv/config";
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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
