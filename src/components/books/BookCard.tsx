import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type BookCardBook = {
  id?: string;
  title: string;
  author: string;
  genre?: string | null;
  series_name?: string | null;
  cover_url?: string | null;
  thumbnail?: string | null;
  cover_storage_path?: string | null;
};

type BookCardProps = {
  book: BookCardBook;
  coverSrc?: string | null;
  coverFailed?: boolean;
  onCoverError?: () => void;
  onRetryCover?: () => void;
  retrying?: boolean;
  statusNode?: ReactNode;
  actionsNode?: ReactNode;
  ratingNode?: ReactNode;
  badgesNode?: ReactNode;
};

const getStorageCoverUrl = (path: string | null | undefined) => {
  if (!path) return null;
  const { data } = supabase.storage.from("book-covers").getPublicUrl(path);
  return data?.publicUrl || null;
};

const BookCard = ({
  book,
  coverSrc,
  coverFailed,
  onCoverError,
  onRetryCover,
  retrying,
  statusNode,
  actionsNode,
  ratingNode,
  badgesNode,
}: BookCardProps) => {
  const storageCover = coverSrc ? null : getStorageCoverUrl(book.cover_storage_path);
  const resolvedCover = coverSrc || storageCover || book.cover_url || book.thumbnail || null;
  const showCoverFallback = !resolvedCover || coverFailed;

  return (
    <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
      <div className="flex gap-3">
        <div className="flex-shrink-0 w-16 aspect-[2/3] rounded-md overflow-hidden bg-secondary/40 flex items-center justify-center relative">
          {resolvedCover && !showCoverFallback ? (
            <img
              src={resolvedCover}
              alt={book.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={onCoverError}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1">
              <BookOpen className="w-5 h-5 text-muted-foreground/40" />
              <span className="text-[9px] text-muted-foreground">cover unavailable</span>
              {onRetryCover && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={retrying}
                  onClick={onRetryCover}
                >
                  {retrying ? "Retrying..." : "Retry cover"}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">{statusNode}</div>
            <div className="flex items-center gap-1">{actionsNode}</div>
          </div>
          <h3 className="font-display text-lg font-bold mt-1 truncate">{book.title}</h3>
          <p className="text-sm text-muted-foreground font-body truncate">{book.author}</p>
          {ratingNode && <div className="mt-2">{ratingNode}</div>}
          {badgesNode && (
            <div className="text-xs text-muted-foreground font-body mt-2 flex flex-wrap gap-1">
              {badgesNode}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookCard;
