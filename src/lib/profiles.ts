import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type ProfileRow = {
  user_id: string;
  username: string;
  display_name: string | null;
  is_public: boolean;
  created_at: string | null;
};

export const normalizeUsername = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export const isValidUsername = (value: string) =>
  /^[a-z0-9_]{3,24}$/.test(value);

const buildDefaultUsername = (user: User) => {
  const metadataUsername = String(
    (user.user_metadata as { username?: string } | null)?.username || ""
  );
  const emailLocal = String(user.email || "").split("@")[0] || "";
  const base = normalizeUsername(metadataUsername || emailLocal || "reader");
  const safeBase = base.length >= 3 ? base.slice(0, 16) : "reader";
  return `${safeBase}_${user.id.slice(0, 8)}`;
};

export const ensureProfileForUser = async (user: User) => {
  const { data: existing } = await (supabase as any)
    .from("profiles")
    .select("user_id,username,display_name,is_public,created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return existing as ProfileRow;
  }

  const username = buildDefaultUsername(user);
  const displayName = ((user.user_metadata as { username?: string } | null)?.username ||
    String(user.email || "").split("@")[0] ||
    null) as string | null;

  const { data: inserted, error } = await (supabase as any)
    .from("profiles")
    .insert({
      user_id: user.id,
      username,
      display_name: displayName,
      is_public: false,
    })
    .select("user_id,username,display_name,is_public,created_at")
    .maybeSingle();

  if (error) {
    throw error;
  }
  return inserted as ProfileRow;
};
