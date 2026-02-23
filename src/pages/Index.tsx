import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Music, MapPin, Calendar, ArrowRight, Star, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import type { Package } from "@/types/database";
import heroImage from "@/assets/hero-image.jpg";

const categories = [
  { icon: Music, label: "Golf + Concert", description: "Championship courses and live music nights", link: "/experience" },
  { icon: Trophy, label: "Golf + Sports Event", description: "Big games, tailgates, and World Cup", link: "/experience" },
  { icon: Calendar, label: "Browse Packages", description: "Pre-built weekend combos", link: "/packages" },
];

export default function Index() {
  const [featuredPackages, setFeaturedPackages] = useState<Package[]>([]);

  useEffect(() => {
    db
      .from("packages")
      .select("*, events(*, artists(*), venues(*)), golf_courses(*), destinations(*)")
      .eq("featured", true)
      .eq("active", true)
      .limit(6)
      .then(({ data }) => {
        if (data) setFeaturedPackages(data as unknown as Package[]);
      });
  }, []);

  return (
    <>
      {/* Hero */}
      <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden">
        <img
          src={heroImage}
          alt="Golf course and concert at sunset"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
        <div className="relative z-10 container mx-auto px-4 text-center">
          <h1 className="animate-fade-in font-serif text-4xl font-bold text-white md:text-6xl lg:text-7xl">
            Tee Off. Rock On.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80 opacity-0 animate-fade-in [animation-delay:200ms] md:text-xl">
            Curated golf + concert packages in the best destinations. One trip, two passions.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 opacity-0 animate-fade-in [animation-delay:400ms]">
            <Button asChild size="lg" className="rounded-full bg-accent px-8 text-accent-foreground hover:bg-accent/90">
              <Link to="/experience">Start Your Experience</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20">
              <Link to="/packages">Browse Packages</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-center font-serif text-3xl font-bold text-foreground">Your Perfect Trip Awaits</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-muted-foreground">
          Combine world-class golf with unforgettable live music
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {categories.map((cat) => (
            <Link key={cat.label} to={cat.link}>
              <Card className="group cursor-pointer border-border/50 bg-card transition-all hover:border-primary/30 hover:shadow-lg">
                <CardContent className="flex flex-col items-center p-6 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    {typeof cat.icon === "string" ? cat.icon : <cat.icon className="h-6 w-6" />}
                  </div>
                  <h3 className="font-serif text-lg font-semibold">{cat.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{cat.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Packages */}
      <section className="bg-muted/30 py-16">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-serif text-3xl font-bold">Featured Packages</h2>
              <p className="mt-1 text-muted-foreground">Hand-picked concert + golf combos</p>
            </div>
            <Button asChild variant="ghost" className="hidden sm:flex">
              <Link to="/packages">View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          </div>

          {featuredPackages.length > 0 ? (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featuredPackages.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} />
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-lg border border-dashed border-border bg-card p-12 text-center">
              <Music className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 font-serif text-xl font-semibold">Packages Coming Soon</h3>
              <p className="mt-2 text-muted-foreground">We're curating amazing concert + golf experiences. Check back soon!</p>
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-16 text-center">
        <h2 className="font-serif text-3xl font-bold">Plan Your Legendary Weekend</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
          Tell our AI what you're looking for and get 3 curated package tiers — with book-direct links.
        </p>
        <Button asChild size="lg" className="mt-6 rounded-full px-8">
          <Link to="/experience">Start Your Experience</Link>
        </Button>
      </section>
    </>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  const event = pkg.events;
  const course = pkg.golf_courses;
  const destination = pkg.destinations;

  return (
    <Link to={`/packages/${pkg.id}`}>
      <Card className="group overflow-hidden border-border/50 transition-all hover:shadow-xl">
        <div className="relative aspect-[16/10] overflow-hidden">
          <img
            src={pkg.image_url || event?.image_url || "/placeholder.svg"}
            alt={pkg.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {pkg.original_price && pkg.original_price > pkg.price && (
            <Badge className="absolute left-3 top-3 bg-accent text-accent-foreground">
              Save ${(pkg.original_price - pkg.price).toFixed(0)}
            </Badge>
          )}
        </div>
        <CardContent className="p-4">
          <h3 className="font-serif text-lg font-semibold leading-tight group-hover:text-primary">{pkg.name}</h3>
          {destination && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {destination.city || destination.name}
            </p>
          )}
          {event && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <Music className="h-3.5 w-3.5" /> {event.artists?.name || event.name}
            </p>
          )}
          {event?.event_date && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> {new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
          <div className="mt-3 flex items-end justify-between">
            <div>
              <span className="text-xl font-bold text-foreground">${pkg.price}</span>
              {pkg.original_price && pkg.original_price > pkg.price && (
                <span className="ml-2 text-sm text-muted-foreground line-through">${pkg.original_price}</span>
              )}
              <span className="ml-1 text-sm text-muted-foreground">/person</span>
            </div>
            <Badge variant="secondary" className="text-xs">{pkg.category}</Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
