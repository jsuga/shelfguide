import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, UserMinus, UserPlus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listAcceptedFriends,
  listPendingReceivedRequests,
  listPendingSentRequests,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  cancelFriendRequest,
  type FriendshipWithProfile,
} from "@/lib/friendships";

const Friends = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendshipWithProfile[]>([]);
  const [received, setReceived] = useState<FriendshipWithProfile[]>([]);
  const [sent, setSent] = useState<FriendshipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async (uid: string) => {
    setLoading(true);
    const [f, r, s] = await Promise.all([
      listAcceptedFriends(uid),
      listPendingReceivedRequests(uid),
      listPendingSentRequests(uid),
    ]);
    setFriends(f);
    setReceived(r);
    setSent(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) await refresh(uid);
      else setLoading(false);
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) void refresh(uid);
      else { setFriends([]); setReceived([]); setSent([]); setLoading(false); }
    });
    return () => { listener.subscription.unsubscribe(); };
  }, [refresh]);

  const withAction = async (id: string, fn: () => Promise<{ success: boolean; message: string }>) => {
    setActionLoading((p) => ({ ...p, [id]: true }));
    const result = await fn();
    setActionLoading((p) => ({ ...p, [id]: false }));
    if (result.success) {
      toast.success(result.message);
      if (userId) await refresh(userId);
    } else {
      toast.error(result.message);
    }
  };

  if (!userId) {
    return (
      <main className="container mx-auto px-4 pt-24 pb-16">
        <h1 className="font-display text-4xl font-bold">Friends</h1>
        <p className="text-muted-foreground mt-2 font-body">Sign in to manage your friends.</p>
      </main>
    );
  }

  const renderFriendCard = (item: FriendshipWithProfile, actions: React.ReactNode) => (
    <Card key={item.id} className="border-border/60 bg-card/70">
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="h-8 w-8 sm:h-10 sm:w-10 shrink-0">
            <AvatarFallback className="text-xs sm:text-sm">
              {(item.friend_display_name || item.friend_username).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <Link
              to={`/u/${item.friend_username}`}
              className="font-medium truncate text-sm sm:text-base leading-tight hover:underline block"
            >
              {item.friend_display_name || item.friend_username}
            </Link>
            <div className="text-[11px] sm:text-xs text-muted-foreground truncate">
              @{item.friend_username}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
      </CardContent>
    </Card>
  );

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">Friends</h1>
        <p className="text-muted-foreground mt-2 font-body">
          Manage your connections and friend requests.
        </p>
      </div>

      <Tabs defaultValue="friends" className="max-w-3xl">
        <TabsList>
          <TabsTrigger value="friends">
            Friends{friends.length > 0 && ` (${friends.length})`}
          </TabsTrigger>
          <TabsTrigger value="received">
            Received{received.length > 0 && ` (${received.length})`}
          </TabsTrigger>
          <TabsTrigger value="sent">
            Sent{sent.length > 0 && ` (${sent.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="friends" className="mt-4 grid gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : friends.length === 0 ? (
            <Card className="border-border/60 bg-card/70">
              <CardContent className="p-6 text-sm text-muted-foreground">
                No friends yet.{" "}
                <Link to="/community" className="underline text-primary">
                  Find readers
                </Link>{" "}
                to connect with!
              </CardContent>
            </Card>
          ) : (
            friends.map((f) =>
              renderFriendCard(
                f,
                <>
                  <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                    <Link to={`/u/${f.friend_username}`}>View</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive"
                    disabled={!!actionLoading[f.id]}
                    onClick={() => void withAction(f.id, () => removeFriend(f.id))}
                  >
                    <UserMinus className="w-3.5 h-3.5 mr-1" />
                    Remove
                  </Button>
                </>
              )
            )
          )}
        </TabsContent>

        <TabsContent value="received" className="mt-4 grid gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : received.length === 0 ? (
            <Card className="border-border/60 bg-card/70">
              <CardContent className="p-6 text-sm text-muted-foreground">
                No pending requests.
              </CardContent>
            </Card>
          ) : (
            received.map((r) =>
              renderFriendCard(
                r,
                <>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!!actionLoading[r.id]}
                    onClick={() => void withAction(r.id, () => acceptFriendRequest(r.id))}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" />
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!!actionLoading[r.id]}
                    onClick={() => void withAction(r.id, () => declineFriendRequest(r.id))}
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Decline
                  </Button>
                </>
              )
            )
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4 grid gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : sent.length === 0 ? (
            <Card className="border-border/60 bg-card/70">
              <CardContent className="p-6 text-sm text-muted-foreground">
                No pending sent requests.
              </CardContent>
            </Card>
          ) : (
            sent.map((s) =>
              renderFriendCard(
                s,
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!!actionLoading[s.id]}
                  onClick={() => void withAction(s.id, () => cancelFriendRequest(s.id))}
                >
                  <Clock className="w-3.5 h-3.5 mr-1" />
                  Cancel
                </Button>
              )
            )
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
};

export default Friends;
