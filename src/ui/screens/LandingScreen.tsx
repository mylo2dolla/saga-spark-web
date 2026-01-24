import { Link } from "react-router-dom";

const features = [
  {
    title: "Guided storytelling",
    description:
      "Run campaigns with structured prompts, AI helpers, and shared world state.",
  },
  {
    title: "Session-ready dashboard",
    description:
      "Pick up where you left off with quick access to campaigns and characters.",
  },
  {
    title: "Collaborative play",
    description:
      "Invite players and build stories together with realtime session tools.",
  },
];

const stats = [
  { label: "Active worlds", value: "120+" },
  { label: "Characters created", value: "3.4k" },
  { label: "Sessions hosted", value: "980+" },
];

export default function LandingScreen() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 pb-20 pt-10">
        <header className="flex items-center justify-between">
          <div className="text-xl font-semibold tracking-wide">SagaSpark</div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              className="rounded-full border border-white/30 px-4 py-2 transition hover:border-white/60"
              to="/login"
            >
              Log in
            </Link>
            <Link
              className="rounded-full bg-emerald-400 px-4 py-2 font-medium text-slate-900 transition hover:bg-emerald-300"
              to="/signup"
            >
              Start free
            </Link>
          </div>
        </header>

        <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">
              Tabletop campaigns, supercharged
            </p>
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
              Your next adventure starts with a single spark.
            </h1>
            <p className="text-lg text-slate-200">
              SagaSpark keeps your party organized with AI-assisted storytelling,
              campaign dashboards, and player tools designed for modern tabletop
              play.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                className="rounded-full bg-emerald-400 px-6 py-3 font-medium text-slate-900 transition hover:bg-emerald-300"
                to="/signup"
              >
                Create your campaign
              </Link>
              <Link
                className="rounded-full border border-white/30 px-6 py-3 font-medium text-white transition hover:border-white/60"
                to="/login"
              >
                I already have an account
              </Link>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
            <div className="grid gap-6">
              <div>
                <p className="text-sm text-slate-400">Session status</p>
                <p className="text-2xl font-semibold">The Emberwild Arc</p>
                <p className="text-sm text-slate-300">Next session · Friday 8PM</p>
              </div>
              <div className="space-y-3">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"
                  >
                    <span className="text-sm text-slate-300">{stat.label}</span>
                    <span className="text-lg font-semibold">{stat.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-3xl border border-white/10 bg-white/5 p-6"
            >
              <h2 className="text-lg font-semibold">{feature.title}</h2>
              <p className="mt-3 text-sm text-slate-300">
                {feature.description}
              </p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
