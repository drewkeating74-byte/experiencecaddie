import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Menu, X, User, LogOut, Shield } from "lucide-react";
import { useState } from "react";
import ecLogo from "@/assets/ec-logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function authRedirectPath(location: ReturnType<typeof useLocation>): string {
  if (location.pathname !== "/auth") {
    return `${location.pathname}${location.search}`;
  }
  const fromQuery = new URLSearchParams(location.search).get("redirect");
  return fromQuery && fromQuery.startsWith("/") ? fromQuery : "/";
}

export default function Navbar() {
  const { user, isAdmin, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const goSignIn = () => {
    const ret = authRedirectPath(location);
    navigate(`/auth?redirect=${encodeURIComponent(ret)}`);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <nav className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <img src={ecLogo} alt="Experience Caddie logo" className="h-10 w-auto" />
          <span className="font-serif text-xl font-bold text-[#2D472C]">Experience</span>
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
            <Button onClick={goSignIn} size="sm">
              Sign In
            </Button>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-background px-4 py-2 md:hidden">
          <div className="flex flex-col">
            <Link to="/experience" onClick={() => setMobileOpen(false)} className="flex min-h-[44px] items-center text-base font-medium text-accent">Plan a Trip</Link>
            <Link to="/packages" onClick={() => setMobileOpen(false)} className="flex min-h-[44px] items-center text-base font-medium">Packages</Link>
            {user ? (
              <>
                <Link to="/bookings" onClick={() => setMobileOpen(false)} className="flex min-h-[44px] items-center text-base font-medium">My Bookings</Link>
                {isAdmin && <Link to="/admin" onClick={() => setMobileOpen(false)} className="flex min-h-[44px] items-center text-base font-medium">Admin Panel</Link>}
                <button onClick={() => { signOut(); setMobileOpen(false); }} className="flex min-h-[44px] items-center text-left text-base font-medium text-destructive">Sign Out</button>
              </>
            ) : (
              <div className="py-2">
                <Button onClick={() => { goSignIn(); setMobileOpen(false); }} className="w-full">Sign In</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
