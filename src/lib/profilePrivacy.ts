import type { ProfileRow } from "@/lib/profiles";

export const canAccessPublicLibrary = (
  viewerUserId: string | null,
  profile: Pick<ProfileRow, "user_id" | "is_public">
) => profile.is_public || (viewerUserId !== null && viewerUserId === profile.user_id);

export const isProfileDiscoverable = (profile: Pick<ProfileRow, "is_public">) =>
  profile.is_public;

