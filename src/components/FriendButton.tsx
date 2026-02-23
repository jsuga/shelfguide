import { useEffect, useState } from "react";
import { Check, Clock, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getFriendshipStatus,
  sendFriendRequest,
  removeFriend,
  cancelFriendRequest,
  acceptFriendRequest,
  type FriendshipRow,
} from "@/lib/friendships";

type FriendButtonProps = {
  currentUserId: string | null;
  targetUserId: string;
  className?: string;
};

const FriendButton = ({ currentUserId, targetUserId, className }: FriendButtonProps) => {
  const [friendship, setFriendship] = useState<FriendshipRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!currentUserId || currentUserId === targetUserId) {
      setChecking(false);
      return;
    }
    setChecking(true);
    void getFriendshipStatus(currentUserId, targetUserId).then((f) => {
      setFriendship(f);
      setChecking(false);
    });
  }, [currentUserId, targetUserId]);

  if (!currentUserId || currentUserId === targetUserId || checking) return null;

  const handleClick = async () => {
    setLoading(true);
    if (!friendship) {
      const result = await sendFriendRequest(currentUserId, targetUserId);
      if (result.success) {
        toast.success(result.message);
        const updated = await getFriendshipStatus(currentUserId, targetUserId);
        setFriendship(updated);
      } else {
        toast.error(result.message);
      }
    } else if (friendship.status === "pending") {
      if (friendship.requester_user_id === currentUserId) {
        const result = await cancelFriendRequest(friendship.id);
        if (result.success) { toast.success("Request cancelled."); setFriendship(null); }
        else toast.error(result.message);
      } else {
        const result = await acceptFriendRequest(friendship.id);
        if (result.success) {
          toast.success("Friend request accepted!");
          const updated = await getFriendshipStatus(currentUserId, targetUserId);
          setFriendship(updated);
        } else toast.error(result.message);
      }
    } else if (friendship.status === "accepted") {
      const result = await removeFriend(friendship.id);
      if (result.success) { toast.success("Friend removed."); setFriendship(null); }
      else toast.error(result.message);
    }
    setLoading(false);
  };

  let label = "Add Friend";
  let icon = <UserPlus className="w-3.5 h-3.5 mr-1" />;
  let variant: "default" | "outline" | "ghost" = "default";

  if (friendship?.status === "pending") {
    if (friendship.requester_user_id === currentUserId) {
      label = "Request Sent";
      icon = <Clock className="w-3.5 h-3.5 mr-1" />;
      variant = "outline";
    } else {
      label = "Accept";
      icon = <Check className="w-3.5 h-3.5 mr-1" />;
      variant = "default";
    }
  } else if (friendship?.status === "accepted") {
    label = "Friends";
    icon = <UserMinus className="w-3.5 h-3.5 mr-1" />;
    variant = "ghost";
  }

  return (
    <Button
      variant={variant}
      size="sm"
      className={`h-8 text-xs ${className || ""}`}
      disabled={loading}
      onClick={() => void handleClick()}
    >
      {icon}
      {loading ? "..." : label}
    </Button>
  );
};

export default FriendButton;
