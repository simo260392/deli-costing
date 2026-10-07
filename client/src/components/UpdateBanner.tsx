import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

// Kitchen iPads keep the app open for days, so they'd otherwise keep running
// an old version after an update. This checks the server's version every few
// minutes (and whenever the app comes back into view):
//  • on the sign-in screen it reloads straight away (nothing to lose);
//  • otherwise it shows a banner so staff can refresh when it suits them
//    (never mid-way through a form).
const CHECK_EVERY_MS = 5 * 60 * 1000;

async function fetchVersion(): Promise<string | null> {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}

export function UpdateBanner({ signedIn }: { signedIn: boolean }) {
  const loaded = useRef<string | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const v = await fetchVersion();
      if (cancelled || !v) return;
      if (loaded.current === null) { loaded.current = v; return; }
      if (v !== loaded.current) setAvailable(true);
    };
    check();
    const id = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  useEffect(() => {
    if (available && !signedIn) window.location.reload();
  }, [available, signedIn]);

  if (!available || !signedIn) return null;
  return (
    <button
      onClick={() => window.location.reload()}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-[#256984] text-white text-sm font-medium px-4 py-2.5 shadow-lg hover:bg-[#1f5a71]"
      data-testid="button-update-available"
    >
      <RefreshCw size={14} />
      Update available — tap to refresh
    </button>
  );
}
