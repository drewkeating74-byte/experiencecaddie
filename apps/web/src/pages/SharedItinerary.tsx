import { useParams, Navigate } from "react-router-dom";

export default function SharedItinerary() {
  const { slug } = useParams<{ slug: string }>();

  // Redirect to ItineraryResults using the share_slug as the id param
  if (slug) return <Navigate to={`/itinerary/${slug}`} replace />;
  return <div className="container mx-auto px-4 py-16 text-center">Itinerary not found</div>;
}
