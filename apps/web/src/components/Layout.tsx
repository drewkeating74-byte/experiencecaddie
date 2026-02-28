import { Outlet } from "react-router-dom";
import Navbar from "@/components/Navbar";

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border bg-muted/30 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="font-serif text-lg font-semibold text-primary">Experience Caddie</p>
          <p className="mt-1 text-sm text-muted-foreground">Legendary Weekends. Zero Planning.</p>
          <p className="mt-4 text-xs text-muted-foreground">© {new Date().getFullYear()} Fairway & Encore. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
