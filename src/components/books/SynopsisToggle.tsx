import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type SynopsisToggleProps = {
  bookTitle: string;
  bookAuthor: string;
  initialSynopsis?: string | null;
};

const fetchSynopsis = async (title: string, author: string): Promise<string | null> => {
  const query = `intitle:${title} inauthor:${author}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1&printType=books`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const desc = data?.items?.[0]?.volumeInfo?.description;
    return typeof desc === "string" && desc.length > 10 ? desc : null;
  } catch {
    return null;
  }
};

// Module-level cache
const synopsisCache = new Map<string, string | null>();

const SynopsisToggle = ({ bookTitle, bookAuthor, initialSynopsis }: SynopsisToggleProps) => {
  const [expanded, setExpanded] = useState(false);
  const [synopsis, setSynopsis] = useState<string | null>(initialSynopsis ?? null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(!!initialSynopsis);

  const cacheKey = `${bookTitle}::${bookAuthor}`.toLowerCase();

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (fetched) return;

    const cached = synopsisCache.get(cacheKey);
    if (cached !== undefined) {
      setSynopsis(cached);
      setFetched(true);
      return;
    }

    setLoading(true);
    const result = await fetchSynopsis(bookTitle, bookAuthor);
    synopsisCache.set(cacheKey, result);
    setSynopsis(result);
    setFetched(true);
    setLoading(false);
  };

  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs gap-1.5 px-2"
        onClick={toggle}
      >
        <BookOpen className="w-3 h-3" />
        {expanded ? "Hide Synopsis" : "View Synopsis"}
      </Button>
      {expanded && (
        <div className="mt-2 rounded-lg border border-border/40 bg-secondary/20 p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading synopsis...
            </div>
          ) : synopsis ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{synopsis}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">Synopsis unavailable for this title.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default SynopsisToggle;
