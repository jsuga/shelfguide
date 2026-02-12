import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { flushAllPendingSync, getPendingSyncCounts, SYNC_EVENT } from "@/lib/cloudSync";

const SyncBanner = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(getPendingSyncCounts());
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshPending = () => setPending(getPendingSyncCounts());

  const retrySync = useCallback(async () => {
    setSyncing(true);
    const result = await flushAllPendingSync();
    setSyncing(false);
    refreshPending();
    if (result.failed > 0) {
      setLastError(result.errorMessages[0] || "Sync failed.");
      return;
    }
    setLastError(null);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void retrySync();
    };
    const onOffline = () => setOnline(false);
    const onSyncUpdate = () => refreshPending();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(SYNC_EVENT, onSyncUpdate);
    const interval = window.setInterval(() => {
      if (!navigator.onLine) return;
      void retrySync();
    }, 30000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(SYNC_EVENT, onSyncUpdate);
      window.clearInterval(interval);
    };
  }, [retrySync]);

  if (online && pending.total === 0 && !lastError) return null;

  return (
    <div className="border-b border-border/50 bg-card/70 backdrop-blur">
      <div className="container mx-auto px-4 py-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {!online
            ? "Offline: changes are saved locally and will sync when online."
            : pending.total > 0
            ? `Sync pending: ${pending.library} library, ${pending.feedback} feedback.`
            : lastError || "Sync issue detected."}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => void retrySync()}
          disabled={syncing || !online}
        >
          {syncing ? "Syncing..." : "Retry sync"}
        </Button>
      </div>
    </div>
  );
};

export default SyncBanner;
