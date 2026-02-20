import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import SearchInput from "@/components/SearchInput";
import { supabase } from "@/integrations/supabase/client";
import type { ProfileRow } from "@/lib/profiles";
import { isProfileDiscoverable } from "@/lib/profilePrivacy";

const Community = () => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
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
  }, [debouncedQuery]);

  const handleQueryChange = useCallback((val: string) => setQuery(val), []);

  const emptyMessage = useMemo(() => {
    if (loading) return "Searching public profiles...";
    if (debouncedQuery) return "No public profiles matched your search.";
    return "No public profiles available yet.";
  }, [loading, debouncedQuery]);

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">Community</h1>
        <p className="text-muted-foreground mt-2 font-body">
          Search public reader profiles and view their shared libraries.
        </p>
      </div>

      <div className="max-w-3xl">
        <SearchInput
          value={query}
          onChange={handleQueryChange}
          placeholder="Search by username…"
        />
      </div>

      <div className="mt-6 grid gap-3 max-w-4xl">
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
                <Button asChild variant="outline" size="sm" className="shrink-0 text-xs sm:text-sm h-8 sm:h-9">
                  <Link to={`/u/${profile.username}`}>View library</Link>
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  );
};

export default Community;
