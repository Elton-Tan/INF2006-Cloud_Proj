import React from "react";
import { AppProviders, useAuth } from "./contexts";
import { doLogout } from "./utils";
import LiveFeed from "./views/LiveFeed";
import BatchAnalytics from "./views/BatchAnalytics";
import Snapshotter from "./views/Snapshotter";

const NAV = [
  { key: "live", label: "Live Feed" },
  { key: "batch", label: "Batch Analytics" },
  { key: "snapshot", label: "Snapshotter" },
] as const;
type NavKey = (typeof NAV)[number]["key"];

function DashboardShell() {
  const [nav, setNav] = React.useState<NavKey>("live");
  const { token } = useAuth();

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-white/80 px-4 backdrop-blur">
        <div className="flex-1 font-semibold">Spiruvita Intelligence</div>
        <div className="flex items-center gap-2">
          <div className="hidden text-xs text-gray-500 sm:block">
            Prototype • v2
          </div>
          {token && (
            <button
              onClick={doLogout}
              className="ml-2 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
              title="Sign out"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-4 px-4 py-4">
        <aside className="col-span-12 h-full rounded-2xl border bg-white p-2 shadow-sm md:col-span-3 lg:col-span-2">
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => setNav(n.key)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-gray-100 ${
                  nav === n.key ? "bg-gray-100 font-medium" : ""
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="mt-4 rounded-xl border bg-gray-50 p-3 text-xs text-gray-600">
            <div className="font-medium">Hint</div>
            <p>
              Replace mock arrays with API calls:{" "}
              <code className="rounded bg-gray-100 px-1">/api/alerts</code>,
              <code className="rounded bg-gray-100 px-1">/api/trends</code>,
              <code className="rounded bg-gray-100 px-1">/api/prices</code>,
              <code className="rounded bg-gray-100 px-1">/api/sentiment</code>,
              <code className="rounded bg-gray-100 px-1">/api/watchlist</code>.
            </p>
          </div>
        </aside>

        <main className="col-span-12 grid gap-4 md:col-span-9 lg:col-span-10">
          {nav === "live" && <LiveFeed />}
          {nav === "batch" && <BatchAnalytics />}
          {nav === "snapshot" && <Snapshotter />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProviders>
      <DashboardShell />
    </AppProviders>
  );
}
