import { useState, useEffect, useRef } from "react";
import { Eye, Globe, Lock, MessageSquare, Check, Loader2, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type CommentVisibility = "private" | "friends" | "community";

type BookNotesProps = {
  bookId: string;
  initialComment: string | null;
  initialVisibility?: CommentVisibility;
  userId: string | null;
  readOnly?: boolean;
};

const VISIBILITY_OPTIONS: { value: CommentVisibility; label: string; icon: React.ReactNode }[] = [
  { value: "private", label: "Private", icon: <Lock className="w-3 h-3" /> },
  { value: "friends", label: "Friends", icon: <Users className="w-3 h-3" /> },
  { value: "community", label: "Community", icon: <Globe className="w-3 h-3" /> },
];

const BookNotes = ({ bookId, initialComment, initialVisibility = "private", userId, readOnly }: BookNotesProps) => {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState(initialComment || "");
  const [visibility, setVisibility] = useState<CommentVisibility>(initialVisibility);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSaved = useRef(initialComment || "");
  const lastVisibility = useRef(initialVisibility);

  useEffect(() => {
    setComment(initialComment || "");
    setVisibility(initialVisibility);
    lastSaved.current = initialComment || "";
    lastVisibility.current = initialVisibility;
  }, [initialComment, initialVisibility, bookId]);

  const hasChanges = comment !== lastSaved.current || visibility !== lastVisibility.current;

  const save = async () => {
    if (!userId || !bookId || readOnly) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("books")
      .update({
        user_comment: comment.trim() || null,
        comment_visibility: visibility,
      })
      .eq("id", bookId);
    setSaving(false);
    if (error) {
      toast.error("Could not save note.");
      return;
    }
    lastSaved.current = comment;
    lastVisibility.current = visibility;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (readOnly) {
    if (!initialComment) return null;
    return (
      <div className="mt-2 rounded-lg border border-border/40 bg-secondary/20 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <MessageSquare className="w-3 h-3" /> Community Note
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{initialComment}</p>
      </div>
    );
  }

  const visibilityIcon = VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.icon || <Lock className="w-3 h-3" />;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="w-3 h-3" />
        {initialComment ? "My Notes" : "Add Notes"}
        {initialComment && (
          <span className="flex items-center gap-0.5 text-[10px] opacity-70">
            {visibilityIcon}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-2 grid gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Your thoughts on this book..."
            className="min-h-[60px] text-sm"
            disabled={saving}
          />
          <div className="flex items-center gap-2 justify-between">
            <Select value={visibility} onValueChange={(v) => setVisibility(v as CommentVisibility)}>
              <SelectTrigger className="h-7 text-[11px] w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-1.5">
                      {opt.icon} {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              {saved && (
                <span className="text-xs text-primary flex items-center gap-1">
                  <Check className="w-3 h-3" /> Saved
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={save}
                disabled={saving || !hasChanges}
                className="h-7 text-xs"
              >
                {saving ? (
                  <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Saving</>
                ) : (
                  "Save Note"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookNotes;
