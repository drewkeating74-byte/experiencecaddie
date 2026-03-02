import { Router } from "express";
import { searchAll, searchEvents, searchGolf, searchHotels } from "../controllers/searchController.js";

const router = Router();

router.post("/", searchAll);
router.post("/events", searchEvents);
router.post("/golf", searchGolf);
router.post("/hotels", searchHotels);

export default router;
