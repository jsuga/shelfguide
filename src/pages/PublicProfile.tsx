import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
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
};

const PublicProfile = () => {
  const { username = "" } = useParams();
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [books, setBooks] = useState<PublicBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPage = async () => {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const viewerId = sessionData.session?.user?.id ?? null;
      setViewerUserId(viewerId);

      const { data: foundProfile } = await supabase
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
      if (!canAccessPublicLibrary(viewerId, castProfile)) {
        setProfile(null);
        setBooks([]);
        setLoading(false);
        return;
      }

      setProfile(castProfile);
      const { data: profileBooks } = await supabase
        .from("books")
        .select("id,title,author,genre,status,series_name")
        .eq("user_id", castProfile.user_id)
        .order("created_at", { ascending: false })
        .limit(200);
      setBooks((profileBooks || []) as PublicBook[]);
      setLoading(false);
    };

    void loadPage();
  }, [username]);

  const title = useMemo(() => {
    if (!profile) return "Public Library";
    return `${profile.display_name || profile.username}'s Library`;
  }, [profile]);

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
            <h1 className="font-display text-3xl font-bold">This profile is private.</h1>
            <p className="text-sm text-muted-foreground mt-2">
              You can only view public libraries.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-2 font-body">
          @{profile.username}
          {viewerUserId === profile.user_id && " (you)"}
        </p>
      </div>

      <div className="grid gap-3 max-w-4xl">
        {books.length === 0 ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No books shared yet.
            </CardContent>
          </Card>
        ) : (
          books.map((book) => (
            <Card key={book.id} className="border-border/60 bg-card/70">
              <CardContent className="p-4">
                <div className="font-medium">{book.title}</div>
                <div className="text-sm text-muted-foreground">{book.author}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {book.genre || "General"} | {book.status || "unknown"}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  );
};

export default PublicProfile;

