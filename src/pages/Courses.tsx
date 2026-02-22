import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
const db = supabase as any;
import type { GolfCourse } from "@/types/database";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Search, ExternalLink } from "lucide-react";

export default function Courses() {
  const [courses, setCourses] = useState<GolfCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    db
      .from("golf_courses")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (data) setCourses(data as unknown as GolfCourse[]);
        setLoading(false);
      });
  }, []);

  const filtered = courses.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.name.toLowerCase().includes(s) || c.city?.toLowerCase().includes(s) || c.state?.toLowerCase().includes(s);
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl font-bold">Golf Courses</h1>
      <p className="mt-1 text-muted-foreground">Public-access courses near concert venues</p>

      <div className="relative mt-6 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by name or location..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="mt-12 text-center text-muted-foreground">Loading courses...</div>
      ) : filtered.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => (
            <Card key={course.id} className="group overflow-hidden border-border/50 transition-all hover:shadow-lg">
              <div className="relative aspect-[16/10] overflow-hidden">
                <img src={course.image_url || "/placeholder.svg"} alt={course.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                {course.public_access && <Badge className="absolute left-3 top-3 bg-primary text-primary-foreground">Public Access</Badge>}
              </div>
              <CardContent className="p-4">
                <h3 className="font-serif text-lg font-semibold">{course.name}</h3>
                {(course.city || course.state) && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />{[course.city, course.state].filter(Boolean).join(", ")}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {course.holes && <Badge variant="secondary">{course.holes} holes</Badge>}
                  {course.rating && <Badge variant="outline">Rating: {course.rating}</Badge>}
                  {course.slope && <Badge variant="outline">Slope: {course.slope}</Badge>}
                </div>
                {(course.green_fee_min || course.green_fee_max) && (
                  <p className="mt-2 font-semibold">${course.green_fee_min}{course.green_fee_max ? ` – $${course.green_fee_max}` : ""}</p>
                )}
                {course.booking_url && (
                  <a href={course.booking_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Book Tee Time <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-12 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <span className="mx-auto text-5xl">⛳</span>
          <h3 className="mt-4 font-serif text-xl font-semibold">No Courses Yet</h3>
          <p className="mt-2 text-muted-foreground">Golf course listings coming soon!</p>
        </div>
      )}
    </div>
  );
}
