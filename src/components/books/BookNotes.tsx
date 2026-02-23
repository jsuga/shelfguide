import { useState, useEffect, useRef } from "react";
import { MessageSquare, Check, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type BookNotesProps = {
  bookId: string;
  initialComment: string | null;
  userId: string | null;
  readOnly?: boolean;
};

const BookNotes = ({ bookId, initialComment, userId, readOnly }: BookNotesProps) => {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState(initialComment || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSaved = useRef(initialComment || "");

  useEffect(() => {
    setComment(initialComment || "");
    lastSaved.current = initialComment || "";
  }, [initialComment, bookId]);

  const hasChanges = comment !== lastSaved.current;

  const save = async () => {
    if (!userId || !bookId || readOnly) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("books")
      .update({ user_comment: comment.trim() || null })
      .eq("id", bookId);
    setSaving(false);
    if (error) {
      toast.error("Could not save note.");
      return;
    }
    lastSaved.current = comment;
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

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="w-3 h-3" />
        {initialComment ? "My Notes" : "Add Notes"}
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
          <div className="flex items-center gap-2 justify-end">
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
      )}
    </div>
  );
};

export default BookNotes;
