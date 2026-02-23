import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type FriendshipRow = {
  id: string;
  requester_user_id: string;
  addressee_user_id: string;
  status: "pending" | "accepted" | "declined" | "blocked";
  created_at: string;
  updated_at: string;
  responded_at: string | null;
};

export type FriendshipWithProfile = FriendshipRow & {
  friend_user_id: string;
  friend_username: string;
  friend_display_name: string | null;
};

/**
 * Get friendship status between current user and target.
 * Returns null if no relationship exists.
 */
export const getFriendshipStatus = async (
  currentUserId: string,
  targetUserId: string
): Promise<FriendshipRow | null> => {
  // Check both directions
  const { data } = await db
    .from("friendships")
    .select("*")
    .or(
      `and(requester_user_id.eq.${currentUserId},addressee_user_id.eq.${targetUserId}),and(requester_user_id.eq.${targetUserId},addressee_user_id.eq.${currentUserId})`
    )
    .in("status", ["pending", "accepted"])
    .limit(1)
    .maybeSingle();
  return data as FriendshipRow | null;
};

/** Send a friend request. Handles crossed requests by auto-accepting. */
export const sendFriendRequest = async (
  currentUserId: string,
  targetUserId: string
): Promise<{ success: boolean; message: string }> => {
  if (currentUserId === targetUserId) {
    return { success: false, message: "You cannot friend yourself." };
  }

  // Check for existing relationship
  const existing = await getFriendshipStatus(currentUserId, targetUserId);

  if (existing) {
    if (existing.status === "accepted") {
      return { success: false, message: "You are already friends." };
    }
    if (existing.status === "pending") {
      // If the OTHER user already sent us a request, auto-accept it
      if (existing.requester_user_id === targetUserId) {
        const { error } = await db
          .from("friendships")
          .update({ status: "accepted", responded_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) return { success: false, message: error.message };
        return { success: true, message: "Friend request accepted!" };
      }
      return { success: false, message: "Friend request already sent." };
    }
  }

  const { error } = await db.from("friendships").insert({
    requester_user_id: currentUserId,
    addressee_user_id: targetUserId,
    status: "pending",
  });
  if (error) {
    if (error.code === "23505") return { success: false, message: "Friend request already exists." };
    return { success: false, message: error.message };
  }
  return { success: true, message: "Friend request sent!" };
};

/** Accept a pending friend request */
export const acceptFriendRequest = async (friendshipId: string) => {
  const { error } = await db
    .from("friendships")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", friendshipId);
  return { success: !error, message: error?.message || "Friend request accepted!" };
};

/** Decline a pending friend request */
export const declineFriendRequest = async (friendshipId: string) => {
  const { error } = await db
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  return { success: !error, message: error?.message || "Request declined." };
};

/** Remove an accepted friendship */
export const removeFriend = async (friendshipId: string) => {
  const { error } = await db
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  return { success: !error, message: error?.message || "Friend removed." };
};

/** Cancel a sent pending request */
export const cancelFriendRequest = async (friendshipId: string) => {
  const { error } = await db
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  return { success: !error, message: error?.message || "Request cancelled." };
};

/** List accepted friends with profile data */
export const listAcceptedFriends = async (
  currentUserId: string
): Promise<FriendshipWithProfile[]> => {
  const { data: rows } = await db
    .from("friendships")
    .select("*")
    .eq("status", "accepted")
    .or(`requester_user_id.eq.${currentUserId},addressee_user_id.eq.${currentUserId}`)
    .order("updated_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const friendIds = (rows as FriendshipRow[]).map((r) =>
    r.requester_user_id === currentUserId ? r.addressee_user_id : r.requester_user_id
  );

  const { data: profiles } = await db
    .from("profiles")
    .select("user_id,username,display_name")
    .in("user_id", friendIds);

  const profileMap = new Map(
    ((profiles || []) as { user_id: string; username: string; display_name: string | null }[]).map((p) => [p.user_id, p])
  );

  return (rows as FriendshipRow[]).map((r) => {
    const friendId = r.requester_user_id === currentUserId ? r.addressee_user_id : r.requester_user_id;
    const profile = profileMap.get(friendId);
    return {
      ...r,
      friend_user_id: friendId,
      friend_username: profile?.username || "unknown",
      friend_display_name: profile?.display_name || null,
    };
  });
};

/** List pending received requests with profile data */
export const listPendingReceivedRequests = async (
  currentUserId: string
): Promise<FriendshipWithProfile[]> => {
  const { data: rows } = await db
    .from("friendships")
    .select("*")
    .eq("status", "pending")
    .eq("addressee_user_id", currentUserId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const requesterIds = (rows as FriendshipRow[]).map((r) => r.requester_user_id);
  const { data: profiles } = await db
    .from("profiles")
    .select("user_id,username,display_name")
    .in("user_id", requesterIds);

  const profileMap = new Map(
    ((profiles || []) as { user_id: string; username: string; display_name: string | null }[]).map((p) => [p.user_id, p])
  );

  return (rows as FriendshipRow[]).map((r) => {
    const profile = profileMap.get(r.requester_user_id);
    return {
      ...r,
      friend_user_id: r.requester_user_id,
      friend_username: profile?.username || "unknown",
      friend_display_name: profile?.display_name || null,
    };
  });
};

/** List pending sent requests with profile data */
export const listPendingSentRequests = async (
  currentUserId: string
): Promise<FriendshipWithProfile[]> => {
  const { data: rows } = await db
    .from("friendships")
    .select("*")
    .eq("status", "pending")
    .eq("requester_user_id", currentUserId)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) return [];

  const addresseeIds = (rows as FriendshipRow[]).map((r) => r.addressee_user_id);
  const { data: profiles } = await db
    .from("profiles")
    .select("user_id,username,display_name")
    .in("user_id", addresseeIds);

  const profileMap = new Map(
    ((profiles || []) as { user_id: string; username: string; display_name: string | null }[]).map((p) => [p.user_id, p])
  );

  return (rows as FriendshipRow[]).map((r) => {
    const profile = profileMap.get(r.addressee_user_id);
    return {
      ...r,
      friend_user_id: r.addressee_user_id,
      friend_username: profile?.username || "unknown",
      friend_display_name: profile?.display_name || null,
    };
  });
};
