import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  clearNeedsAttentionItems,
  checkCloudHealth,
  flushAllPendingSync,
  getLastSyncError,
  getNeedsAttentionItems,
  getPendingSyncCounts,
  getSupabaseProjectRef,
  SYNC_EVENT,
} from "@/lib/cloudSync";

const ERROR_CLASS_LABELS: Record<string, string> = {
  network: "Network error",
  auth: "Auth expired",
  permission: "Permission denied",
  schema_cache: "Schema cache",
  missing_table: "Missing table",
  project_mismatch: "Project mismatch",
  other: "Sync error",
};

const SyncBanner = () => {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState(getPendingSyncCounts(null));
  const [showDetails, setShowDetails] = useState(false);
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [showDevDetails, setShowDevDetails] = useState(false);

  const refreshPending = useCallback(
    () => setPending(getPendingSyncCounts(userId)),
    [userId]
  );

  const retrySync = useCallback(async () => {
    setSyncing(true);
    await flushAllPendingSync();
    setSyncing(false);
    refreshPending();
  }, [refreshPending]);

  const dismissNeedsAttention = useCallback(() => {
    clearNeedsAttentionItems(userId);
    setShowDetails(false);
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

    const onOnline = () => { setOnline(true); void retrySync(); };
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

  useEffect(() => { refreshPending(); }, [refreshPending]);

  useEffect(() => {
    if (!online || !userId) return;
    void checkCloudHealth(userId);
  }, [online, userId]);

  const syncError = getLastSyncError();
  const bannerMessage = !online
    ? "You're offline. Sync will resume when you reconnect."
    : pending.needsAttention > 0
    ? `Sync needs attention: ${pending.needsAttention} item(s) require manual review.`
    : pending.total > 0
    ? `Syncing ${pending.total} item(s)...`
    : syncError?.userMessage || null;

  if (!bannerMessage) return null;

  const attentionItems = getNeedsAttentionItems(userId);
  const projectRef = getSupabaseProjectRef();

  return (
    <div className="border-b border-border/50 bg-card/70 backdrop-blur">
      <div className="container mx-auto px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>{bannerMessage}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
              onClick={() => setShowLearnMore((v) => !v)}>
              {showLearnMore ? <><ChevronUp className="w-3 h-3 mr-1" />Less</> : <><ChevronDown className="w-3 h-3 mr-1" />Learn more</>}
            </Button>
            {import.meta.env.DEV && (
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={() => setShowDevDetails((v) => !v)}>
                {showDevDetails ? <><ChevronUp className="w-3 h-3 mr-1" />Details</> : <><ChevronDown className="w-3 h-3 mr-1" />Details</>}
              </Button>
            )}
            {pending.needsAttention > 0 && (
              <>
                <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setShowDetails((c) => !c)}>
                  {showDetails ? "Hide details" : "View details"}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={dismissNeedsAttention}>Dismiss issues</Button>
              </>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs px-2"
              onClick={() => void retrySync()}
              disabled={syncing || !online || pending.total === 0}>
              {syncing ? "Syncing..." : !online ? "Offline" : "Retry sync"}
            </Button>
          </div>
        </div>

        {showLearnMore && syncError && (
          <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-[11px]">
            <span className="font-medium">{ERROR_CLASS_LABELS[syncError.errorClass] || "Error"}:</span>{" "}
            <span>{/pgrst|reload schema|schema cache|postgrest|supabase.*project|VITE_/i.test(syncError.userMessage || syncError.message) ? "Something went wrong. Please refresh and try again." : (syncError.userMessage || syncError.message)}</span>
            <span className="text-muted-foreground/60 ml-2">({new Date(syncError.timestamp).toLocaleString()})</span>
          </div>
        )}
        {showLearnMore && !syncError && (
          <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-[11px]">
            No recent sync errors recorded.
          </div>
        )}

        {showDevDetails && import.meta.env.DEV && (
          <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-[11px] space-y-1">
            <div>Project ref: <span className="font-medium">{projectRef || "unknown"}</span></div>
            {syncError ? (
              <>
                <div>Operation: <span className="font-medium">{syncError.operation || "unknown"}</span></div>
                <div>Table: <span className="font-medium">{syncError.table || "unknown"}</span></div>
                <div>Error code: <span className="font-medium">{syncError.code || "unknown"}</span></div>
                <div>Message: <span className="font-medium">{syncError.message}</span></div>
                {syncError.details && <div>Details: <span className="font-medium">{syncError.details}</span></div>}
                {syncError.hint && <div>Hint: <span className="font-medium">{syncError.hint}</span></div>}
                <div>Status: <span className="font-medium">{syncError.status ?? "unknown"}</span></div>
                <div>Session: <span className="font-medium">{syncError.hasSession ? "yes" : "no"}</span></div>
                <div>User: <span className="font-medium">{syncError.userId || "none"}</span></div>
              </>
            ) : (
              <div>No error details available.</div>
            )}
          </div>
        )}

        {showDetails && attentionItems.length > 0 && (
          <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 space-y-1">
            {attentionItems.map((item) => (
              <div key={item.id} className="text-[11px]">
                <span className="font-medium">{item.operation}</span>{" - "}<span>{item.source}</span>{" - "}<span>{item.error}</span>{" (attempts: "}<span>{item.attempts}</span>{")"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SyncBanner;
