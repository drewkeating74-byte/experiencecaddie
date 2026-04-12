import { createRoot } from "react-dom/client";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App.tsx";
import "./index.css";
import { initMonitoring } from "./lib/monitoring";

// Start error monitoring before React renders so no early errors are missed.
initMonitoring();

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <SpeedInsights />
  </>
);
