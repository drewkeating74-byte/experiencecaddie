export const buildHealth = () => ({
  status: "ok",
  service: "experiencecaddie-api",
  timestamp: new Date().toISOString(),
  ticketmaster_configured: Boolean(process.env.TICKETMASTER_CONSUMER_KEY || process.env.TICKETMASTER_API_KEY),
});
