import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Scrolls to top of page on route change (e.g. when clicking logo to go home). */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
