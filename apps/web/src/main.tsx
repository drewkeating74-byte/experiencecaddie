import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initMonitoring } from "./lib/monitoring";

// Start error monitoring before React renders so no early errors are missed.
initMonitoring();

createRoot(document.getElementById("root")!).render(<App />);
