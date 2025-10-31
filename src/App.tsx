// src/App.tsx
import React from "react";
import { AppProviders, useAuth } from "./contexts";
import { onAuthExpired, login } from "./cognitoAuth";
import { COGNITO } from "./config";
import LiveFeed from "./views/LiveFeed";
import BatchAnalytics from "./views/BatchAnalytics";
import Snapshotter from "./views/Snapshotter";
import { doLogout } from "./utils";
import WordsOfInterest from "./views/WordsOfInterest";
import SocialListening from "./views/SocialListening";
import SocialMediaRecommendation from "./views/SocialMediaRecommendation";
import TopProductsDashboard from "./views/TopProductsDashboard"; // Add this import
import AgentMonitoring from "./components/AgentMonitoring";

/** Discriminated union so we can render a divider item cleanly */
type NavLink = { type: "link"; key: string; label: string };
type NavDivider = { type: "divider"; label: string };
type NavItem = NavLink | NavDivider;

const NAV: readonly NavItem[] = [
  // New top divider for the live/interactive area
  { type: "divider", label: "Live Data & Settings" },

  { type: "link", key: "live", label: "Alerts & Trends" },
  { type: "link", key: "listening", label: "Social Listening" },
  { type: "link", key: "words", label: "Words of Interest" },
  { type: "link", key: "snapshot", label: "Product Watchlist" },

  { type: "divider", label: "Historical & Offline Analysis" },

  { type: "link", key: "batch", label: "Keywords Analysis" },
  { type: "link", key: "social", label: "Social Media Analysis" },
  { type: "link", key: "topProducts", label: "Top Products Dashboard" },
] as const;

type NavKey = Extract<NavItem, { type: "link" }>["key"];

function SessionExpiredModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-2 text-lg font-semibold">Session Expired</div>
        <p className="mb-4 text-sm text-gray-600">
          For security reasons, the session token expires and require a login
          every 4 hours. This helps to keep the site secure.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() =>
              login(
                {
                  domain: COGNITO.domain,
                  clientId: COGNITO.clientId,
                  redirectUri: COGNITO.redirectUri,
                  scopes: COGNITO.scopes,
                },
                true // persist
              )
            }
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Refresh Token
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardShell() {
  const [nav, setNav] = React.useState<NavKey>("live");
  const { token } = useAuth();
  const [expiredOpen, setExpiredOpen] = React.useState(false);

  // Open modal when the auth lib emits "expired"
  React.useEffect(() => {
    const off = onAuthExpired(() => setExpiredOpen(true));
    return off;
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      <SessionExpiredModal
        open={expiredOpen}
        onClose={() => setExpiredOpen(false)}
      />

      <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-white/80 px-4 backdrop-blur">
        <div className="flex-1 font-semibold">Spiruvita Intelligence</div>
        <div className="flex items-center gap-2">
          <div className="hidden text-xs text-gray-500 sm:block">
            Prototype • v2
          </div>
          {token && <AgentMonitoring />}
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
            {NAV.map((item, idx) =>
              item.type === "divider" ? (
                <div
                  key={`divider-${idx}`}
                  className="mt-3 mb-2 rounded-lg px-3 py-1.5 bg-primary/10 text-primary
                 text-[11px] font-semibold uppercase tracking-wider"
                >
                  {item.label}
                </div>
              ) : (
                <button
                  key={item.key}
                  onClick={() => setNav(item.key)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-gray-100 ${
                    nav === item.key ? "bg-gray-100 font-medium" : ""
                  }`}
                >
                  {item.label}
                </button>
              )
            )}
          </nav>
        </aside>

        <main className="col-span-12 grid gap-4 md:col-span-9 lg:col-span-10">
          {nav === "live" && <LiveFeed />}
          {nav === "listening" && <SocialListening />}
          {nav === "batch" && <BatchAnalytics />}
          {nav === "snapshot" && <Snapshotter />}
          {nav === "words" && <WordsOfInterest />}

          {/* Social Media Analysis section */}
          {nav === "social" && <SocialMediaRecommendation />}

          {/* Top Products Dashboard - Add this section */}
          {nav === "topProducts" && <TopProductsDashboard />}
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
