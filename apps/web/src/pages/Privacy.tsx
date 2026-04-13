import { Link } from "react-router-dom";

const CONTACT_EMAIL = "privacy@experiencecaddie.com";
const LAST_UPDATED = "April 2026";

export default function Privacy() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Draft notice */}
      <div className="mb-8 rounded-lg border border-amber-400 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">⚠ DRAFT — PENDING LEGAL REVIEW</p>
        <p className="mt-1">
          This document has not been reviewed or approved by legal counsel. It is published as a
          working draft only and should not be relied upon as a final, legally binding privacy
          policy. A reviewed version will replace this draft before full public launch.
        </p>
      </div>

      <h1 className="font-serif text-3xl font-bold text-primary">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Who we are</h2>
          <p>
            Experience Caddie is a travel planning service operated by Fairway & Encore. We help
            people plan golf and concert weekends by combining publicly available event data with
            an AI-generated itinerary. This policy explains what information we collect when you
            use the site, how we use it, and your rights around that data.
          </p>
          <p className="mt-3">
            If you have questions about this policy, email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">What we collect and why</h2>

          <h3 className="mb-2 font-semibold">Search queries and trip details</h3>
          <p>
            When you use the Experience Builder to plan a trip, we receive the destination, travel
            dates, golf preferences, and any artist or event preferences you enter. We use this to
            generate your itinerary and to improve search relevance over time. We do not sell this
            data.
          </p>

          <h3 className="mb-2 mt-4 font-semibold">Click events</h3>
          <p>
            When you click an outbound link (a ticket link, tee time booking, or hotel link), we
            log that a click occurred along with the link type, provider, and the package tier you
            were viewing. We use this to understand which results are most useful and to measure
            whether affiliate links are working. We do not track what happens after you leave the
            site.
          </p>

          <h3 className="mb-2 mt-4 font-semibold">Itinerary generation logs</h3>
          <p>
            Every time an itinerary is generated, we log the destination, date range, which data
            providers were called (e.g. Ticketmaster, Google Places), and how many results were
            returned. This helps us monitor data quality and fix issues. Itineraries you generate
            are stored in our database and can be accessed via a shareable link.
          </p>

          <h3 className="mb-2 mt-4 font-semibold">Account information</h3>
          <p>
            If you create an account, we store your email address and use it to authenticate you.
            We use Supabase for authentication and database storage. We do not store passwords
            directly — authentication is handled via Google OAuth or email magic link.
          </p>

          <h3 className="mb-2 mt-4 font-semibold">Performance and error monitoring</h3>
          <p>
            We use Vercel Speed Insights to measure page performance (load times, layout stability,
            and interaction responsiveness). This collects anonymised performance data from real
            page visits. We may also log JavaScript errors to help diagnose and fix bugs.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Third-party services we use</h2>
          <p>
            Experience Caddie pulls live data from third-party APIs to power search results. Using
            the site means your search inputs may be passed to these services as part of generating
            your itinerary:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium">Ticketmaster</span> — we use the Ticketmaster Discovery
              API to find concerts and live events near your destination. Ticketmaster's own privacy
              policy governs data shared with them.
            </li>
            <li>
              <span className="font-medium">Google Places</span> — we use the Google Places API to
              find golf courses near your destination. Google's privacy policy governs data shared
              with them.
            </li>
            <li>
              <span className="font-medium">Booking.com / AWIN</span> — we may link to hotels via
              Booking.com through the AWIN affiliate network. If you click a hotel link and make a
              booking, we may earn a commission. Booking.com's and AWIN's privacy policies govern
              data collected on their platforms.
            </li>
            <li>
              <span className="font-medium">Perplexity AI</span> — we use an AI language model to
              generate itinerary narrative and package descriptions. Your destination and date range
              are passed to this service as part of generation. No personally identifying
              information is included in these prompts.
            </li>
            <li>
              <span className="font-medium">Supabase</span> — our database and authentication
              provider. Data is stored in the United States.
            </li>
            <li>
              <span className="font-medium">Vercel</span> — our hosting provider. Page performance
              data is collected by Vercel Speed Insights.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Affiliate links</h2>
          <p>
            Some outbound links on Experience Caddie are affiliate links. This means that if you
            click a link and make a purchase or booking, we may earn a commission from the
            provider. This commission comes from the provider, not from you — you pay the same
            price whether you arrive through an affiliate link or not.
          </p>
          <p className="mt-3">
            Affiliate relationships do not influence which results are shown or how they are
            ranked. Results are ordered by relevance and proximity to your destination, not by
            commission rate. See our <Link to="/terms" className="text-primary underline">affiliate disclosure</Link> for full details.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">How long we keep your data</h2>
          <p>
            Itineraries are stored indefinitely while your account is active so you can return to
            them via a shareable link. Click event logs are retained for analytical purposes. If
            you would like your data deleted, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
              {CONTACT_EMAIL}
            </a>{" "}
            and we will remove your account and associated data within 30 days.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Cookies and local storage</h2>
          <p>
            We use browser local storage and session storage to maintain your session and
            temporarily store your in-progress itinerary preferences. We do not use advertising
            cookies or cross-site tracking.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Your rights</h2>
          <p>
            You have the right to access the personal data we hold about you, to request
            corrections, and to request deletion. To exercise any of these rights, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Changes to this policy</h2>
          <p>
            We may update this policy as the product evolves. If we make material changes, we will
            update the "last updated" date at the top of this page. Continued use of Experience
            Caddie after a policy update constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold">Contact</h2>
          <p>
            Questions or concerns about this policy? Email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-12 rounded-lg border border-amber-400 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">⚠ DRAFT — PENDING LEGAL REVIEW</p>
        <p className="mt-1">
          This document requires review by qualified legal counsel before it is treated as a
          finalised privacy policy.
        </p>
      </div>
    </div>
  );
}
