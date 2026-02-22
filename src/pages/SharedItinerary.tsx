import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const db = supabase as any;

export default function SharedItinerary() {
  const { slug } = useParams<{ slug: string }>();
  const [itineraryId, setItineraryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    db.from("itineraries")
      .select("id")
      .eq("share_slug", slug)
      .single()
      .then(({ data, error }: any) => {
        if (data) setItineraryId(data.id);
        else setNotFound(true);
        setLoading(false);
      });
  }, [slug]);

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (notFound) return <div className="container mx-auto px-4 py-16 text-center">Itinerary not found</div>;
  if (itineraryId) return <Navigate to={`/itinerary/${itineraryId}`} replace />;
  return null;
}
