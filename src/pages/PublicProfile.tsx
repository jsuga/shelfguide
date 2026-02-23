import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import BookCard from "@/components/books/BookCard";
import BookGrid from "@/components/books/BookGrid";
import BookNotes from "@/components/books/BookNotes";
import FriendButton from "@/components/FriendButton";
import SearchInput from "@/components/SearchInput";
import { supabase } from "@/integrations/supabase/client";
import type { ProfileRow } from "@/lib/profiles";
import { canAccessPublicLibrary } from "@/lib/profilePrivacy";

type PublicBook = {
  id: string;
  title: string;
  author: string;
  genre: string | null;
  status: string | null;
  series_name: string | null;
  cover_url: string | null;
  thumbnail: string | null;
  cover_storage_path: string | null;
  user_comment: string | null;
  comment_visibility: string | null;
};

const PublicProfile = () => {
  const { username = "" } = useParams();
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [books, setBooks] = useState<PublicBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [privateMessage, setPrivateMessage] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFriend, setIsFriend] = useState(false);

  useEffect(() => {
    const loadPage = async () => {
      setLoading(true);
      setPrivateMessage(null);
      setFetchError(null);
      const { data: sessionData } = await supabase.auth.getSession();
      const viewerId = sessionData.session?.user?.id ?? null;
      setViewerUserId(viewerId);

      const { data: foundProfile } = await (supabase as any)
        .from("profiles")
        .select("user_id,username,display_name,is_public,created_at")
        .eq("username", username.toLowerCase())
        .maybeSingle();

      if (!foundProfile) {
        setProfile(null);
        setBooks([]);
        setLoading(false);
        return;
      }

      const castProfile = foundProfile as ProfileRow;

      // Check friendship status for friend-visible content
      let friendStatus = false;
      if (viewerId && viewerId !== castProfile.user_id) {
        const { data: fRow } = await (supabase as any)
          .from("friendships")
          .select("id")
          .eq("status", "accepted")
          .or(
            `and(requester_user_id.eq.${viewerId},addressee_user_id.eq.${castProfile.user_id}),and(requester_user_id.eq.${castProfile.user_id},addressee_user_id.eq.${viewerId})`
          )
          .limit(1)
          .maybeSingle();
        friendStatus = !!fRow;
      }
      setIsFriend(friendStatus);

      // Allow access if public, own profile, or friend
      const canAccess = canAccessPublicLibrary(viewerId, castProfile) || friendStatus;
      if (!canAccess) {
        setProfile(null);
        setPrivateMessage("This library is private.");
        setBooks([]);
        setLoading(false);
        return;
      }

      setProfile(castProfile);
      const { data: profileBooks, error: booksError } = await (supabase as any)
        .from("books")
        .select("id,title,author,genre,status,series_name,cover_url,thumbnail,cover_storage_path,user_comment,comment_visibility")
        .eq("user_id", castProfile.user_id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (booksError) {
        if (import.meta.env.DEV) {
          console.warn("[Community] PublicProfile books fetch failed:", booksError);
        }
        setFetchError(booksError.message || "Could not load library.");
        setPrivateMessage("This library is private.");
        setBooks([]);
        setLoading(false);
        return;
      }
      setBooks((profileBooks || []) as PublicBook[]);
      setLoading(false);
    };

    void loadPage();
  }, [username]);

  const title = useMemo(() => {
    if (!profile) return "Public Library";
    return `${profile.display_name || profile.username}'s Library`;
  }, [profile]);

  const handleSearchChange = useCallback((val: string) => setSearchQuery(val), []);

  const filteredBooks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q)
    );
  }, [books, searchQuery]);

  /** Determine if a comment should be shown to this viewer */
  const shouldShowComment = (book: PublicBook): boolean => {
    if (!book.user_comment) return false;
    const vis = book.comment_visibility || "private";
    if (viewerUserId === profile?.user_id) return true; // own profile
    if (vis === "community") return true;
    if (vis === "friends" && isFriend) return true;
    return false;
  };

  if (loading) {
    return (
      <main className="container mx-auto px-4 pt-24 pb-16">
        <p className="text-muted-foreground">Loading profile...</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="container mx-auto px-4 pt-24 pb-16">
        <Card className="border-border/60 bg-card/70 max-w-2xl">
          <CardContent className="p-6">
            <h1 className="font-display text-3xl font-bold">
              {privateMessage || "This library is private."}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              You can only view public libraries or libraries of your friends.
            </p>
            {fetchError && (
              <p className="text-xs text-muted-foreground mt-3">
                {import.meta.env.DEV ? `Debug: ${fetchError}` : ""}
              </p>
            )}
            <div className="mt-4">
              <Button asChild variant="outline">
                <Link to="/community">Back to Community</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold">{title}</h1>
          <p className="text-muted-foreground mt-2 font-body">
            @{profile.username}
            {viewerUserId === profile.user_id && " (you)"}
          </p>
        </div>
        {viewerUserId && viewerUserId !== profile.user_id && (
          <FriendButton currentUserId={viewerUserId} targetUserId={profile.user_id} />
        )}
      </div>

      <div className="max-w-6xl">
        {books.length > 0 && (
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <SearchInput
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search this library by title or author…"
              className="flex-1 max-w-md"
            />
            <span className="text-xs text-muted-foreground shrink-0">
              Showing {filteredBooks.length} of {books.length}
            </span>
          </div>
        )}

        {filteredBooks.length === 0 ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-6 text-sm text-muted-foreground">
              {searchQuery ? "No books match your search." : "No books shared yet."}
            </CardContent>
          </Card>
        ) : (
          <BookGrid>
            {filteredBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                statusNode={
                  <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {book.status || "unknown"}
                  </span>
                }
                badgesNode={
                  <>
                    <span className="rounded-full bg-secondary/70 px-2 py-0.5">
                      {book.genre || "General"}
                    </span>
                    {book.series_name && (
                      <span className="rounded-full bg-secondary/70 px-2 py-0.5">
                        {book.series_name}
                      </span>
                    )}
                    {shouldShowComment(book) && (
                      <BookNotes
                        bookId={book.id}
                        initialComment={book.user_comment}
                        userId={null}
                        readOnly
                      />
                    )}
                  </>
                }
              />
            ))}
          </BookGrid>
        )}
      </div>
    </main>
  );
};

export default PublicProfile;
