import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Menu, X, User, LogOut, Shield } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Navbar() {
  const { user, isAdmin, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <nav className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="font-serif text-xl font-bold text-primary">Experience</span>
          <span className="font-serif text-xl text-accent"> Caddie</span>
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-6 md:flex">
          <Link to="/experience" className="text-sm font-medium text-accent transition-colors hover:text-accent/80">
            Plan a Trip
          </Link>
          <Link to="/packages" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Packages
          </Link>
          <Link to="/events" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Concerts
          </Link>
          <Link to="/courses" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Golf Courses
          </Link>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate("/bookings")}>
                  My Bookings
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <Shield className="mr-2 h-4 w-4" />
                    Admin Panel
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => navigate("/auth")} size="sm">
              Sign In
            </Button>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-background p-4 md:hidden">
          <div className="flex flex-col gap-3">
            <Link to="/experience" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-accent">Plan a Trip</Link>
            <Link to="/packages" onClick={() => setMobileOpen(false)} className="text-sm font-medium">Packages</Link>
            <Link to="/events" onClick={() => setMobileOpen(false)} className="text-sm font-medium">Concerts</Link>
            <Link to="/courses" onClick={() => setMobileOpen(false)} className="text-sm font-medium">Golf Courses</Link>
            {user ? (
              <>
                <Link to="/bookings" onClick={() => setMobileOpen(false)} className="text-sm font-medium">My Bookings</Link>
                {isAdmin && <Link to="/admin" onClick={() => setMobileOpen(false)} className="text-sm font-medium">Admin Panel</Link>}
                <button onClick={() => { signOut(); setMobileOpen(false); }} className="text-left text-sm font-medium text-destructive">Sign Out</button>
              </>
            ) : (
              <Button onClick={() => { navigate("/auth"); setMobileOpen(false); }} size="sm" className="w-fit">Sign In</Button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
