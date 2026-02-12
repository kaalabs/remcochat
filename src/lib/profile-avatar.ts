import type { Profile } from "@/lib/types";

export function getProfileAvatarSrc(profile: Pick<Profile, "id" | "avatar">) {
  if (!profile.avatar) return null;
  const profileId = encodeURIComponent(profile.id);
  const v = encodeURIComponent(profile.avatar.updatedAt);
  return `/api/profiles/${profileId}/avatar?v=${v}`;
}

