import { Router } from "express";
import healthRoutes from "./health.js";
import searchRoutes from "./search.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/search", searchRoutes);

export default router;
