import { Helmet } from "react-helmet-async";
import heroImage from "@/assets/hero-image.jpg";

export default function Closed() {
  return (
    <>
      <Helmet>
        <title>Experience Caddie is closed</title>
        <meta
          name="description"
          content="The trip still works. This site doesn’t. Golf plus a show is still a good weekend — ask your AI agent."
        />
        <meta name="robots" content="noindex, nofollow" />
        <meta property="og:title" content="Experience Caddie is closed" />
        <meta
          property="og:description"
          content="The trip still works. This site doesn’t. Ask your AI agent to plan the weekend."
        />
        <meta property="og:url" content="https://experiencecaddie.com/" />
        <link rel="canonical" href="https://experiencecaddie.com/" />
      </Helmet>
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
        <img
          src={heroImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/55 to-black/80" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="font-serif text-sm uppercase tracking-[0.28em] text-white/70">
            Experience Caddie
          </p>
          <h1 className="mt-6 font-serif text-4xl font-bold leading-tight text-white md:text-6xl">
            The trip still works.
            <span className="mt-2 block">This site doesn’t.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-white/85 md:text-xl">
            Golf plus a show is still a good weekend. You don’t need us in the middle — ask your AI agent.
          </p>
          <p className="mt-10 text-sm uppercase tracking-[0.22em] text-white/60">
            Experience Caddie is closed
          </p>
        </div>
      </section>
    </>
  );
}
