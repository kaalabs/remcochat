"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Profile } from "@/domain/profiles/types";
import { getProfileAvatarSrc } from "@/lib/profile-avatar";
import {
  PlusIcon,
  SettingsIcon,
} from "lucide-react";

type HomeClientSidebarProfileProps = {
  activeProfile: Profile | null;
  appVersion: string | null;
  onCreateProfile: () => void;
  onOpenChangeProfileSelect: (open: boolean) => void;
  onOpenProfileSettings: () => void;
  onSelectProfile: (profileId: string) => void;
  profiles: Profile[];
  statusReady: boolean;
  t: I18nContextValue["t"];
};

export function HomeClientSidebarProfile({
  activeProfile,
  appVersion,
  onCreateProfile,
  onOpenChangeProfileSelect,
  onOpenProfileSettings,
  onSelectProfile,
  profiles,
  statusReady,
  t,
}: HomeClientSidebarProfileProps) {
  const versionLabel = appVersion ? `v${appVersion} · (c) kaaLabs '26` : null;

  return (
    <div className="border-t p-4">
      <div className="mb-2 text-sm font-medium text-muted-foreground">
        {t("sidebar.profile")}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Select
          onOpenChange={onOpenChangeProfileSelect}
          onValueChange={onSelectProfile}
          value={activeProfile?.id ?? ""}
        >
          <SelectTrigger
            className="h-20 min-w-0 flex-1 data-[size=default]:h-20"
            data-testid="profile:select-trigger"
            suppressHydrationWarning
          >
            <SelectValue
              className="min-w-0 max-w-full"
              placeholder={t("profile.select.placeholder")}
            >
              {activeProfile ? (
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar
                    name={activeProfile.name}
                    position={activeProfile.avatar?.position ?? null}
                    showInitial={false}
                    sizePx={40}
                    src={getProfileAvatarSrc(activeProfile)}
                  />
                  <span className="min-w-0 truncate">{activeProfile.name}</span>
                </div>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem
                className="py-2"
                data-testid={`profile:option:${profile.id}`}
                key={profile.id}
                value={profile.id}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ProfileAvatar
                    name={profile.name}
                    position={profile.avatar?.position ?? null}
                    showInitial={false}
                    sizePx={28}
                    src={getProfileAvatarSrc(profile)}
                  />
                  <span className="min-w-0 truncate">{profile.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          aria-label={t("profile.new.title")}
          className="h-10 w-10 px-0"
          data-testid="profile:new"
          onClick={onCreateProfile}
          title={t("profile.new.title")}
          type="button"
          variant="outline"
        >
          <PlusIcon className="size-4" />
        </Button>

        <Button
          aria-label={t("profile.settings.title")}
          className="h-10 w-10 px-0"
          data-testid="profile:settings-open"
          disabled={!statusReady}
          onClick={onOpenProfileSettings}
          title={t("profile.settings.title")}
          type="button"
          variant="outline"
        >
          <SettingsIcon className="size-4" />
        </Button>
      </div>

      {versionLabel ? (
        <div
          className="mt-3 text-[11px] text-muted-foreground"
          data-testid="app:version"
        >
          {versionLabel}
        </div>
      ) : null}
    </div>
  );
}
