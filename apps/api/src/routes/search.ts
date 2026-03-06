import { Router } from "express";
import { searchAll } from "../controllers/searchController.js";

const router = Router();
router.get("/", searchAll);
router.post("/", searchAll);
export default router;
