import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SearchInput from "@/components/SearchInput";
import FriendButton from "@/components/FriendButton";
import { supabase } from "@/integrations/supabase/client";
import type { ProfileRow } from "@/lib/profiles";
import { isProfileDiscoverable } from "@/lib/profilePrivacy";
import { listAcceptedFriends, type FriendshipWithProfile } from "@/lib/friendships";

type FriendBook = {
  id: string;
  title: string;
  author: string;
  user_comment: string | null;
  comment_visibility: string;
  user_id: string;
};

const Community = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"community" | "friends">("community");
  const [friends, setFriends] = useState<FriendshipWithProfile[]>([]);
  const [friendNotes, setFriendNotes] = useState<(FriendBook & { friend_username: string; friend_display_name: string | null })[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        const f = await listAcceptedFriends(uid);
        setFriends(f);
      }
    };
    void init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) void listAcceptedFriends(uid).then(setFriends);
      else setFriends([]);
    });
    return () => { listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Community profiles search
  useEffect(() => {
    if (scope !== "community") return;
    const runSearch = async () => {
      setLoading(true);
      let request = (supabase as any)
        .from("profiles")
        .select("user_id,username,display_name,is_public,created_at")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(20);

      if (debouncedQuery) {
        request = request.or(
          `username.ilike.%${debouncedQuery}%,display_name.ilike.%${debouncedQuery}%`
        );
      }

      const { data } = await request;
      setLoading(false);
      setProfiles(((data || []) as ProfileRow[]).filter(isProfileDiscoverable));
    };
    void runSearch();
  }, [debouncedQuery, scope]);

  // Friends feed: load friend-visible + community-visible notes from friends
  useEffect(() => {
    if (scope !== "friends" || !userId || friends.length === 0) {
      setFriendNotes([]);
      return;
    }
    const loadFriendNotes = async () => {
      setLoadingFriends(true);
      const friendIds = friends.map((f) => f.friend_user_id);
      const { data } = await (supabase as any)
        .from("books")
        .select("id,title,author,user_comment,comment_visibility,user_id")
        .in("user_id", friendIds)
        .not("user_comment", "is", null)
        .in("comment_visibility", ["friends", "community"])
        .order("updated_at", { ascending: false })
        .limit(50);

      const notes = ((data || []) as FriendBook[]).map((book) => {
        const friend = friends.find((f) => f.friend_user_id === book.user_id);
        return {
          ...book,
          friend_username: friend?.friend_username || "unknown",
          friend_display_name: friend?.friend_display_name || null,
        };
      });
      setFriendNotes(notes);
      setLoadingFriends(false);
    };
    void loadFriendNotes();
  }, [scope, userId, friends]);

  const handleQueryChange = useCallback((val: string) => setQuery(val), []);

  const emptyMessage = useMemo(() => {
    if (scope === "friends") {
      if (loadingFriends) return "Loading friend activity...";
      if (friends.length === 0) return "No friends yet. Find readers in the Community tab!";
      return "No shared notes from friends yet.";
    }
    if (loading) return "Searching public profiles...";
    if (debouncedQuery) return "No public profiles matched your search.";
    return "No public profiles available yet.";
  }, [loading, loadingFriends, debouncedQuery, scope, friends.length]);

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold">Community</h1>
          <p className="text-muted-foreground mt-2 font-body">
            Discover readers and browse shared content.
          </p>
        </div>
        {userId && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to="/friends">
              <Users className="w-4 h-4 mr-1.5" />
              My Friends
            </Link>
          </Button>
        )}
      </div>

      <Tabs value={scope} onValueChange={(v) => setScope(v as "community" | "friends")} className="max-w-4xl">
        <TabsList>
          <TabsTrigger value="community">Community</TabsTrigger>
          {userId && <TabsTrigger value="friends">Friends Feed</TabsTrigger>}
        </TabsList>

        <TabsContent value="community" className="mt-4">
          <div className="max-w-3xl mb-4">
            <SearchInput
              value={query}
              onChange={handleQueryChange}
              placeholder="Search by username…"
            />
          </div>
          <div className="grid gap-3 max-w-4xl">
            {profiles.length === 0 ? (
              <Card className="border-border/60 bg-card/70">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  {emptyMessage}
                </CardContent>
              </Card>
            ) : (
              profiles.map((profile) => (
                <Card key={profile.user_id} className="border-border/60 bg-card/70">
                  <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-8 w-8 sm:h-10 sm:w-10 shrink-0">
                        <AvatarFallback className="text-xs sm:text-sm">
                          {(profile.display_name || profile.username).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-medium truncate text-sm sm:text-base leading-tight">
                          {profile.display_name || profile.username}
                        </div>
                        <div className="text-[11px] sm:text-xs text-muted-foreground truncate">
                          @{profile.username}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <FriendButton currentUserId={userId} targetUserId={profile.user_id} />
                      <Button asChild variant="outline" size="sm" className="text-xs h-8">
                        <Link to={`/u/${profile.username}`}>View library</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="friends" className="mt-4">
          <div className="grid gap-3 max-w-4xl">
            {friendNotes.length === 0 ? (
              <Card className="border-border/60 bg-card/70">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  {emptyMessage}
                </CardContent>
              </Card>
            ) : (
              friendNotes.map((note) => (
                <Card key={note.id} className="border-border/60 bg-card/70">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarFallback className="text-[10px]">
                          {(note.friend_display_name || note.friend_username).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Link
                        to={`/u/${note.friend_username}`}
                        className="text-xs font-medium hover:underline"
                      >
                        {note.friend_display_name || note.friend_username}
                      </Link>
                      <span className="text-[10px] text-muted-foreground">
                        on <strong>{note.title}</strong> by {note.author}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap pl-8">
                      {note.user_comment}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
};

export default Community;
