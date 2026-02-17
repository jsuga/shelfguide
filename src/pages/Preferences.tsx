import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import type { GenreTheme } from "@/contexts/theme-types";
import { themeOptions } from "@/contexts/theme-types";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  clearNeedsAttentionItems,
  flushAllPendingSync,
  getAuthenticatedUserId,
  getPendingSyncCounts,
  SYNC_EVENT,
} from "@/lib/cloudSync";
import {
  ensureProfileForUser,
  isValidUsername,
  normalizeUsername,
} from "@/lib/profiles";

const db = supabase as any;

const themeCards: {
  id: GenreTheme; name: string; description: string;
  colors: { bg: string; primary: string; accent: string };
  images: string[]; detail: string;
}[] = [
  { id: "fantasy", name: "Fantasy", description: "Enchanted forests & golden candlelight", colors: { bg: "hsl(140,25%,8%)", primary: "hsl(42,80%,52%)", accent: "hsl(150,30%,16%)" }, images: ["/images/themes/fantasy1.jpg", "/images/themes/fantasy2.jpg", "/images/themes/fantasy3.jpg", "/images/themes/fantasy4.jpg", "/images/themes/fantasy6.jpg"], detail: "Mossy glades, runes, and torchlit stonework." },
  { id: "scifi", name: "Science Fiction", description: "Deep space & electric cyan light", colors: { bg: "hsl(225,50%,6%)", primary: "hsl(195,90%,50%)", accent: "hsl(225,35%,15%)" }, images: ["/images/themes/scifi1.jpg", "/images/themes/scifi2.jpg", "/images/themes/scifi3.jpg"], detail: "Neon corridors, holograms, and orbital glow." },
  { id: "history", name: "History", description: "Antique maps & aged parchment", colors: { bg: "hsl(35,35%,92%)", primary: "hsl(30,55%,38%)", accent: "hsl(30,25%,82%)" }, images: ["/images/themes/history1.jpg", "/images/themes/history3.png", "/images/themes/history1.jpg"], detail: "Cartography lines, vellum texture, and inked edges." },
  { id: "romance", name: "Romance", description: "Soft blush & Parisian elegance", colors: { bg: "hsl(20,35%,96%)", primary: "hsl(345,50%,52%)", accent: "hsl(345,25%,88%)" }, images: ["/images/themes/romance1.jpg", "/images/themes/romance2.jpg", "/images/themes/romance3.jpg", "/images/themes/romance4.jpg", "/images/themes/romance6.jpg"], detail: "Petals, handwritten notes, and golden hour light." },
  { id: "thriller", name: "Thriller", description: "Dark rooms & blood red accents", colors: { bg: "hsl(0,0%,5%)", primary: "hsl(0,75%,48%)", accent: "hsl(0,0%,14%)" }, images: ["/images/themes/thriller1.jpg", "/images/themes/thriller3.jpg", "/images/themes/thriller1.jpg"], detail: "Hard shadows, gritty tape, and cold evidence boards." },
];

const fadeInUp = { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" as const }, transition: { duration: 0.6 } };

const Preferences = () => {
  const { theme, setTheme } = useTheme();
  const showDiagnostics = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SYNC_DIAGNOSTICS === "true";
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [syncUserId, setSyncUserId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isPublicProfile, setIsPublicProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSync, setPendingSync] = useState(getPendingSyncCounts(null));
  const [syncingNow, setSyncingNow] = useState(false);
  // Delete library state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ checkedAt: string | null; dedupeKeyColumn: boolean | null; upsertConflictPath: boolean | null; rlsLikely: boolean | null; note: string | null }>({ checkedAt: null, dedupeKeyColumn: null, upsertConflictPath: null, rlsLikely: null, note: null });

  const getThemeFallback = (_themeId: GenreTheme) => "/images/themes/shelf1.jpg";
  const getImageSrc = (themeId: GenreTheme, src: string) => failedImages[src] ? getThemeFallback(themeId) : src;
  const onImageError = (src: string) => { setFailedImages((prev) => (prev[src] ? prev : { ...prev, [src]: true })); };

  const refreshPendingSync = useCallback(() => { setPendingSync(getPendingSyncCounts(syncUserId)); }, [syncUserId]);

  const handleRetrySync = async () => {
    setSyncingNow(true);
    const result = await flushAllPendingSync();
    setSyncingNow(false);
    refreshPendingSync();
    if (result.failed > 0) { toast.error(`Sync retry failed: ${result.errorMessages[0] || "Unknown error"}`); return; }
    toast.success("Sync retry completed.");
  };

  const runDiagnostics = async () => {
    const userId = await getAuthenticatedUserId();
    if (!userId) { setDiagnostics({ checkedAt: new Date().toISOString(), dedupeKeyColumn: null, upsertConflictPath: null, rlsLikely: null, note: "Sign in to run diagnostics." }); return; }
    const result = { checkedAt: new Date().toISOString(), dedupeKeyColumn: false, upsertConflictPath: null as boolean | null, rlsLikely: false, note: null as string | null };
    const { data, error } = await db.from("books").select("id,title,author,isbn13,dedupe_key").eq("user_id", userId).limit(1);
    if (!error) { result.dedupeKeyColumn = true; result.rlsLikely = true; } else { result.note = `Books select failed: ${error.message}`; setDiagnostics(result); return; }
    const sample = data?.[0];
    if (!sample) { result.note = "No book rows available; upsert conflict path not executed."; setDiagnostics(result); return; }
    const { error: upsertError } = await db.from("books").upsert([{ id: sample.id, user_id: userId, title: sample.title, author: sample.author, isbn13: sample.isbn13 }], { onConflict: "user_id,dedupe_key", ignoreDuplicates: false });
    result.upsertConflictPath = !upsertError;
    if (upsertError) result.note = `Upsert conflict check failed: ${upsertError.message}`;
    setDiagnostics(result);
  };

  const handleDeleteLibrary = async () => {
    if (deleteConfirmText !== "DELETE") { toast.error("Type DELETE to confirm."); return; }
    const userId = await getAuthenticatedUserId();
    if (!userId) { toast.error("Sign in to delete your library."); return; }
    setDeleting(true);
    await db.from("books").delete().eq("user_id", userId);
    await db.from("copilot_feedback").delete().eq("user_id", userId);
    await db.from("copilot_recommendations").delete().eq("user_id", userId);
    await db.from("import_logs").delete().eq("user_id", userId);
    localStorage.removeItem("reading-copilot-library");
    localStorage.removeItem("reading-copilot-feedback");
    localStorage.removeItem("shelfguide-pending-library-sync");
    localStorage.removeItem("shelfguide-pending-feedback-sync");
    localStorage.removeItem("shelfguide-cover-cache");
    clearNeedsAttentionItems(userId);
    setDeleting(false);
    setDeleteDialogOpen(false);
    setDeleteConfirmText("");
    toast.success("Your library has been deleted.");
  };

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserEmail(user?.email ?? null);
      setSyncUserId(user?.id ?? null);
      if (user) {
        try { const profile = await ensureProfileForUser(user); setUsername(profile.username); setDisplayName(profile.display_name || ""); setIsPublicProfile(profile.is_public); } catch { setUsername(""); setDisplayName(""); setIsPublicProfile(false); }
      } else { setUsername(""); setDisplayName(""); setIsPublicProfile(false); }
      if (user?.id) {
        const { data: prefs } = await db.from("copilot_preferences").select("*").eq("user_id", user.id).maybeSingle();
        if (prefs) {
          if (prefs.ui_theme) setTheme(prefs.ui_theme as GenreTheme);
        }
      }
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserEmail(user?.email ?? null);
      setSyncUserId(user?.id ?? null);
      if (user) { void ensureProfileForUser(user).then((profile) => { setUsername(profile.username); setDisplayName(profile.display_name || ""); setIsPublicProfile(profile.is_public); }).catch(() => { setUsername(""); setDisplayName(""); setIsPublicProfile(false); }); }
      else { setUsername(""); setDisplayName(""); setIsPublicProfile(false); }
      if (user?.id) {
        (async () => {
          const { data: prefs } = await db.from("copilot_preferences").select("*").eq("user_id", user.id).maybeSingle();
          if (prefs) {
            if (prefs.ui_theme) setTheme(prefs.ui_theme as GenreTheme);
          }
        })();
      }
    });
    return () => { listener.subscription.unsubscribe(); };
  }, [setTheme]);

  useEffect(() => { const onSyncUpdate = () => refreshPendingSync(); window.addEventListener(SYNC_EVENT, onSyncUpdate); return () => { window.removeEventListener(SYNC_EVENT, onSyncUpdate); }; }, [refreshPendingSync]);
  useEffect(() => { refreshPendingSync(); }, [refreshPendingSync]);

  const handleSave = async () => {
    if (!userEmail) { toast.error("Sign in to save profile settings."); return; }
    const normalized = normalizeUsername(username);
    if (!isValidUsername(normalized)) { toast.error("Username must be 3-24 chars (letters, numbers, underscores)."); return; }
    setUsername(normalized);
    setSaving(true);
    const userId = await getAuthenticatedUserId();
    if (!userId) { setSaving(false); toast.error("Sign in to save profile settings."); return; }
    const { error } = await db.from("profiles").upsert({ user_id: userId, username: normalized, display_name: displayName.trim() || null, is_public: isPublicProfile });
    if (error) {
      setSaving(false);
      if (error.code === "23505") {
        toast.error("That username is already taken.");
      } else {
        if (import.meta.env.DEV) console.warn("[ShelfGuide] Profile save failed:", error);
        toast.error("Profile service is temporarily unavailable. Please try again shortly.");
      }
      return;
    }
    const { error: authError } = await supabase.auth.updateUser({ data: { username: normalized } });
    setSaving(false);
    if (authError) { toast.error(authError.message); return; }
    toast.success("Profile updated.");
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2 font-body">Customize your reading experience</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-border/60 bg-card/70 p-6 lg:col-span-2">
          <h2 className="font-display text-2xl font-bold mb-2">Sync Status</h2>
          <p className="text-sm text-muted-foreground font-body mb-4">Pending library sync: {pendingSync.library} | pending feedback sync: {pendingSync.feedback} | needs attention: {pendingSync.needsAttention}</p>
          <Button variant="outline" onClick={handleRetrySync} disabled={syncingNow}>{syncingNow ? "Retrying..." : "Retry sync"}</Button>
        </section>

        {showDiagnostics && (
          <section className="rounded-xl border border-border/60 bg-card/70 p-6 lg:col-span-2">
            <h2 className="font-display text-2xl font-bold mb-2">Diagnostics</h2>
            <p className="text-sm text-muted-foreground font-body mb-4">Dev-only checks for sync/dedupe readiness.</p>
            <div className="text-sm text-muted-foreground space-y-1 mb-4">
              <div>dedupe_key column: {diagnostics.dedupeKeyColumn === null ? "Not checked" : diagnostics.dedupeKeyColumn ? "OK" : "Failed"}</div>
              <div>Upsert conflict path: {diagnostics.upsertConflictPath === null ? "Not checked" : diagnostics.upsertConflictPath ? "OK" : "Failed"}</div>
              <div>RLS likely active: {diagnostics.rlsLikely === null ? "Not checked" : diagnostics.rlsLikely ? "Likely" : "Failed"}</div>
              <div>Last check: {diagnostics.checkedAt || "Never"}</div>
              {diagnostics.note && <div>Note: {diagnostics.note}</div>}
            </div>
            <Button variant="outline" onClick={() => void runDiagnostics()}>Run diagnostics</Button>
          </section>
        )}

        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <h2 className="font-display text-2xl font-bold mb-2">Profile</h2>
          <p className="text-sm text-muted-foreground font-body mb-6">Manage your account details and how you appear in the library.</p>
          {userEmail ? (
            <div className="grid gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input value={userEmail} disabled /></div>
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <p className="text-xs text-muted-foreground">
                  Pick a username to complete your profile setup and enable a public link to connect with friends
                </p>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="chapterSeeker" />
              </div>
              <div className="grid gap-2"><Label htmlFor="display-name">Display name (optional)</Label><Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Chapter Seeker" /></div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 p-3">
                <div><div className="text-sm font-medium">Profile Privacy</div><p className="text-xs text-muted-foreground">Public profile: allow others to find your profile and view your library.</p></div>
                <Switch checked={isPublicProfile} onCheckedChange={setIsPublicProfile} />
              </div>
              {isPublicProfile && isValidUsername(normalizeUsername(username)) && (
                <div className="text-xs text-muted-foreground">Public link: <Link className="underline" to={`/u/${normalizeUsername(username)}`}>/u/{normalizeUsername(username)}</Link></div>
              )}
              <div className="flex items-center justify-end"><Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground font-body">Sign in to manage your username.</p>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <motion.div {...fadeInUp} className="text-center mb-6">
            <h2 className="font-display text-3xl font-bold mb-2">Choose Your Atmosphere</h2>
            <p className="text-muted-foreground text-sm font-body">
              Each genre transforms the entire reading experience
            </p>
          </motion.div>
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <Label className="text-sm text-muted-foreground">Theme</Label>
              <p className="font-body text-sm text-muted-foreground">
                Saved to your account and synced across devices.
              </p>
            </div>
            <Select value={theme} onValueChange={(v) => setTheme(v as GenreTheme)}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                {themeOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-[560px] overflow-y-auto pr-1 space-y-4">
            {themeCards.map((t, i) => (
              <motion.div key={t.id} {...fadeInUp} transition={{ duration: 0.5, delay: i * 0.05 }}>
                <button
                  onClick={() => { setTheme(t.id); toast.success(`${t.name} theme applied!`); }}
                  className={`w-full text-left rounded-xl overflow-hidden border-2 transition-all ${
                    theme === t.id ? "border-primary shadow-lg ring-2 ring-primary/30" : "border-transparent hover:border-border"
                  }`}
                >
                  <div className="h-32 relative overflow-hidden">
                    <img
                      src={getImageSrc(t.id, t.images[0] || getThemeFallback(t.id))}
                      onError={() => onImageError(t.images[0] || "")}
                      alt={`${t.name} theme preview`}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="absolute inset-0" style={{ background: `linear-gradient(145deg, ${t.colors.bg}cc, ${t.colors.accent}99)` }} />
                    <div className="absolute inset-x-3 top-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/80 font-body">
                      <span className="w-2 h-2 rounded-full" style={{ background: t.colors.primary }} />
                      {t.name}
                    </div>
                  </div>
                  <div className="p-4 bg-card">
                    <h3 className="font-display font-bold text-sm">{t.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 font-body">{t.description}</p>
                    <p className="text-[11px] text-muted-foreground/80 mt-2 font-body">{t.detail}</p>
                  </div>
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      </div>

      {/* Danger Zone - Delete Library */}
      {userEmail && (
        <section className="mt-10 rounded-xl border-2 border-destructive/40 bg-card/70 p-6">
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <h2 className="font-display text-2xl font-bold text-destructive">Danger Zone</h2>
          </div>
          <p className="text-sm text-muted-foreground font-body mb-4">
            Permanently delete your entire library, feedback, recommendations, and import history from both local storage and the cloud.
          </p>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>Delete My Library</Button>
        </section>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive font-display text-xl">Delete Your Library</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete all your books, feedback, and recommendations from both local storage and the cloud. <strong>This cannot be undone.</strong>
          </p>
          <div className="grid gap-2 mt-4">
            <Label>Type <strong>DELETE</strong> to confirm</Label>
            <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setDeleteConfirmText(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteLibrary} disabled={deleteConfirmText !== "DELETE" || deleting}>{deleting ? "Deleting..." : "Confirm Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      
    </main>
  );
};

export default Preferences;
