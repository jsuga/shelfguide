import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  clearNeedsAttentionItems,
  flushAllPendingSync,
  getNeedsAttentionItems,
  getPendingSyncCounts,
  SYNC_EVENT,
} from "@/lib/cloudSync";

const SyncBanner = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState(getPendingSyncCounts(null));
  const [showDetails, setShowDetails] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshPending = useCallback(
    () => setPending(getPendingSyncCounts(userId)),
    [userId]
  );

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
  }, [refreshPending]);

  const dismissNeedsAttention = useCallback(() => {
    clearNeedsAttentionItems(userId);
    setShowDetails(false);
    setLastError(null);
    refreshPending();
  }, [refreshPending, userId]);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setUserId(data.session?.user?.id ?? null);
    };
    void init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

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
      listener.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(SYNC_EVENT, onSyncUpdate);
      window.clearInterval(interval);
    };
  }, [refreshPending, retrySync]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  if (online && pending.total === 0 && pending.needsAttention === 0 && !lastError) return null;
  const attentionItems = getNeedsAttentionItems(userId);

  return (
    <div className="border-b border-border/50 bg-card/70 backdrop-blur">
      <div className="container mx-auto px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>
            {!online
              ? "Offline: changes are saved locally and will sync when online."
              : pending.needsAttention > 0
              ? `Sync needs attention: ${pending.needsAttention} item(s) require manual review.`
              : pending.total > 0
              ? `Sync pending: ${pending.library} library, ${pending.feedback} feedback.`
              : lastError || "Sync issue detected."}
          </span>
          <div className="flex items-center gap-2">
            {pending.needsAttention > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setShowDetails((current) => !current)}
                >
                  {showDetails ? "Hide details" : "View details"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={dismissNeedsAttention}
                >
                  Dismiss issues
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => void retrySync()}
              disabled={syncing || !online || pending.total === 0}
            >
              {syncing ? "Syncing..." : "Retry sync"}
            </Button>
          </div>
        </div>
        {showDetails && attentionItems.length > 0 && (
          <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 space-y-1">
            {attentionItems.map((item) => (
              <div key={item.id} className="text-[11px]">
                <span className="font-medium">{item.operation}</span>
                {" - "}
                <span>{item.source}</span>
                {" - "}
                <span>{item.error}</span>
                {" (attempts: "}
                <span>{item.attempts}</span>
                {")"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SyncBanner;
