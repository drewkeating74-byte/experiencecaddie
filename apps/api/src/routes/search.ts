import { Router } from "express";
import { searchAll, searchEvents, searchGolf, searchHotels } from "../controllers/searchController.js";

const router = Router();

router.get("/", searchAll);
router.post("/", searchAll);
router.get("/events", searchEvents);
router.post("/events", searchEvents);
router.get("/golf", searchGolf);
router.post("/golf", searchGolf);
router.get("/hotels", searchHotels);
router.post("/hotels", searchHotels);

export default router;
