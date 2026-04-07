"use client";

import type {
  ChangeEventHandler,
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import { ProfileAvatarPositioner } from "@/components/profile-avatar-positioner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryItem } from "@/domain/memory/types";
import type { Profile } from "@/domain/profiles/types";
import { getProfileAvatarSrc } from "@/lib/profile-avatar";
import {
  ALLOWED_PROFILE_AVATAR_MEDIA_TYPES,
} from "@/lib/profile-avatar-constraints";

type HomeClientCreateProfileDialogProps = {
  createError: string | null;
  createOpen: boolean;
  creating: boolean;
  newProfileName: string;
  onCreateProfile: () => void;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setNewProfileName: Dispatch<SetStateAction<string>>;
  t: I18nContextValue["t"];
};

type HomeClientDeleteProfileState = {
  canConfirm: boolean;
  confirm: string;
  error: string | null;
  open: boolean;
  saving: boolean;
  setConfirm: Dispatch<SetStateAction<string>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

type HomeClientProfileSettingsState = {
  avatarDraftError: string | null;
  avatarDraftFile: File | null;
  avatarDraftObjectUrl: string | null;
  avatarMaxMb: number;
  avatarPositionDraft: { x: number; y: number };
  avatarRemoveDraft: boolean;
  error: string | null;
  memoryEnabledDraft: boolean;
  memoryItems: MemoryItem[];
  open: boolean;
  profileInstructionsDraft: string;
  saving: boolean;
  setAvatarPositionDraft: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setMemoryEnabledDraft: Dispatch<SetStateAction<boolean>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setProfileInstructionsDraft: Dispatch<SetStateAction<string>>;
  setUiLanguageDraft: Dispatch<SetStateAction<Profile["uiLanguage"]>>;
  uiLanguageDraft: Profile["uiLanguage"];
};

type HomeClientProfileSettingsDialogProps = {
  activeProfile: Profile | null;
  avatarFileInputRef: RefObject<HTMLInputElement | null>;
  canOpenDeleteProfile: boolean;
  deleteProfile: HomeClientDeleteProfileState;
  onChooseAvatarFile: () => void;
  onDeleteMemory: (memoryId: string) => void;
  onRemoveAvatarDraft: () => void;
  onSaveProfileSettings: () => void;
  onAvatarFileChange: ChangeEventHandler<HTMLInputElement>;
  profileSettings: HomeClientProfileSettingsState;
  t: I18nContextValue["t"];
};

type HomeClientDeleteProfileDialogProps = {
  activeProfileName: string;
  deleteProfile: HomeClientDeleteProfileState;
  onConfirmDeleteProfile: () => void;
  t: I18nContextValue["t"];
};

export function isCreateProfileSubmitDisabled(input: {
  creating: boolean;
  newProfileName: string;
}): boolean {
  return input.creating || !input.newProfileName.trim();
}

export function resolveProfileAvatarPreviewSrc(input: {
  activeProfile: Profile | null;
  avatarDraftObjectUrl: string | null;
  avatarRemoveDraft: boolean;
}): string | null {
  if (input.avatarRemoveDraft) return null;
  if (input.avatarDraftObjectUrl) return input.avatarDraftObjectUrl;
  if (!input.activeProfile) return null;
  return getProfileAvatarSrc(input.activeProfile);
}

export function shouldShowProfileAvatarDragHint(input: {
  activeProfile: Profile | null;
  avatarDraftObjectUrl: string | null;
  avatarRemoveDraft: boolean;
}): boolean {
  return Boolean(
    !input.avatarRemoveDraft &&
      (input.avatarDraftObjectUrl || input.activeProfile?.avatar)
  );
}

export function HomeClientCreateProfileDialog({
  createError,
  createOpen,
  creating,
  newProfileName,
  onCreateProfile,
  setCreateOpen,
  setNewProfileName,
  t,
}: HomeClientCreateProfileDialogProps) {
  return (
    <Dialog onOpenChange={setCreateOpen} open={createOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.new.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            data-testid="profile:create-name"
            onChange={(event) => setNewProfileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCreateProfile();
              }
            }}
            placeholder={t("profile.name.placeholder")}
            value={newProfileName}
          />

          {createError ? (
            <div className="text-sm text-destructive">{createError}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              data-testid="profile:create-cancel"
              onClick={() => setCreateOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="profile:create-submit"
              disabled={isCreateProfileSubmitDisabled({
                creating,
                newProfileName,
              })}
              onClick={onCreateProfile}
              type="button"
            >
              {t("common.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HomeClientProfileSettingsDialog({
  activeProfile,
  avatarFileInputRef,
  canOpenDeleteProfile,
  deleteProfile,
  onChooseAvatarFile,
  onDeleteMemory,
  onRemoveAvatarDraft,
  onSaveProfileSettings,
  onAvatarFileChange,
  profileSettings,
  t,
}: HomeClientProfileSettingsDialogProps) {
  const avatarPreviewSrc = resolveProfileAvatarPreviewSrc({
    activeProfile,
    avatarDraftObjectUrl: profileSettings.avatarDraftObjectUrl,
    avatarRemoveDraft: profileSettings.avatarRemoveDraft,
  });

  return (
    <Dialog onOpenChange={profileSettings.setOpen} open={profileSettings.open}>
      <DialogContent
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_1fr] overflow-hidden sm:max-w-md"
        data-testid="profile:settings-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("profile.settings.title")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="space-y-4 pr-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("profile.language.label")}
              </div>
              <Select
                onValueChange={(value) =>
                  profileSettings.setUiLanguageDraft(value as Profile["uiLanguage"])
                }
                value={profileSettings.uiLanguageDraft}
              >
                <SelectTrigger
                  className="h-9"
                  data-testid="profile:ui-language-trigger"
                  suppressHydrationWarning
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem data-testid="profile:ui-language-option:en" value="en">
                    {t("profile.language.option.en")}
                  </SelectItem>
                  <SelectItem data-testid="profile:ui-language-option:nl" value="nl">
                    {t("profile.language.option.nl")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">{t("profile.photo.label")}</div>
              <div className="text-xs text-muted-foreground">
                {t("profile.photo.description")}
              </div>

              <div className="flex items-center gap-4">
                <ProfileAvatarPositioner
                  data-testid="profile:avatar-positioner"
                  disabled={
                    profileSettings.saving || profileSettings.avatarRemoveDraft
                  }
                  name={activeProfile?.name ?? ""}
                  onPositionChange={profileSettings.setAvatarPositionDraft}
                  position={profileSettings.avatarPositionDraft}
                  sizePx={96}
                  src={avatarPreviewSrc}
                />

                <div className="space-y-2">
                  <input
                    accept={ALLOWED_PROFILE_AVATAR_MEDIA_TYPES.join(",")}
                    className="hidden"
                    onChange={onAvatarFileChange}
                    ref={avatarFileInputRef}
                    type="file"
                  />

                  <Button
                    className="h-9"
                    disabled={profileSettings.saving || !activeProfile}
                    onClick={onChooseAvatarFile}
                    type="button"
                    variant="outline"
                  >
                    {activeProfile?.avatar || profileSettings.avatarDraftFile
                      ? t("profile.photo.change")
                      : t("profile.photo.upload")}
                  </Button>

                  <Button
                    className="h-9"
                    disabled={
                      profileSettings.saving ||
                      (!activeProfile?.avatar && !profileSettings.avatarDraftFile)
                    }
                    onClick={onRemoveAvatarDraft}
                    type="button"
                    variant="outline"
                  >
                    {t("profile.photo.remove")}
                  </Button>

                  <div className="text-xs text-muted-foreground">
                    {t("profile.photo.max_size", {
                      mb: profileSettings.avatarMaxMb,
                    })}
                  </div>
                </div>
              </div>

              {shouldShowProfileAvatarDragHint({
                activeProfile,
                avatarDraftObjectUrl: profileSettings.avatarDraftObjectUrl,
                avatarRemoveDraft: profileSettings.avatarRemoveDraft,
              }) ? (
                <div className="text-xs text-muted-foreground">
                  {t("profile.photo.drag_hint")}
                </div>
              ) : null}

              {profileSettings.avatarDraftError ? (
                <div className="text-sm text-destructive">
                  {profileSettings.avatarDraftError}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">
                {t("profile.custom_instructions.label")}
              </div>
              <Textarea
                className="min-h-[8rem]"
                data-testid="profile:instructions"
                onChange={(event) =>
                  profileSettings.setProfileInstructionsDraft(event.target.value)
                }
                placeholder={t("profile.custom_instructions.placeholder")}
                value={profileSettings.profileInstructionsDraft}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
              <div>
                <div className="text-sm font-medium">
                  {t("profile.memory.label")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("profile.memory.description")}
                </div>
              </div>
              <button
                aria-checked={profileSettings.memoryEnabledDraft}
                aria-label={t("profile.memory.toggle.aria")}
                className={
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                  (profileSettings.memoryEnabledDraft ? "bg-primary" : "bg-muted")
                }
                data-testid="profile:memory-toggle"
                onClick={() => profileSettings.setMemoryEnabledDraft((value) => !value)}
                role="switch"
                title={
                  profileSettings.memoryEnabledDraft
                    ? t("profile.memory.toggle.title_on")
                    : t("profile.memory.toggle.title_off")
                }
                type="button"
              >
                <span
                  className={
                    "pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm transition-transform " +
                    (profileSettings.memoryEnabledDraft
                      ? "translate-x-5"
                      : "translate-x-0.5")
                  }
                />
              </button>
            </div>

            {profileSettings.memoryEnabledDraft ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">
                  {t("profile.memory.saved.title")}
                </div>
                {profileSettings.memoryItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {t("profile.memory.saved.empty")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profileSettings.memoryItems.map((memoryItem) => (
                      <div
                        className="flex items-start justify-between gap-3 rounded-md border bg-card p-3"
                        key={memoryItem.id}
                      >
                        <div
                          className="min-w-0 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]"
                          data-testid="profile:memory-item"
                        >
                          {memoryItem.content}
                        </div>
                        <Button
                          className="h-8 shrink-0 px-2"
                          onClick={() => onDeleteMemory(memoryItem.id)}
                          type="button"
                          variant="ghost"
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {profileSettings.error ? (
              <div className="text-sm text-destructive">{profileSettings.error}</div>
            ) : null}

            <div className="rounded-md border border-destructive/30 bg-card p-3">
              <div className="text-sm font-medium">{t("profile.danger.title")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("profile.danger.description")}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  data-testid="profile:delete-open"
                  disabled={!canOpenDeleteProfile}
                  onClick={() => deleteProfile.setOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  {t("profile.delete.button")}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                data-testid="profile:settings-cancel"
                disabled={profileSettings.saving}
                onClick={() => profileSettings.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="profile:settings-save"
                disabled={profileSettings.saving}
                onClick={onSaveProfileSettings}
                type="button"
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HomeClientDeleteProfileDialog({
  activeProfileName,
  deleteProfile,
  onConfirmDeleteProfile,
  t,
}: HomeClientDeleteProfileDialogProps) {
  return (
    <Dialog onOpenChange={deleteProfile.setOpen} open={deleteProfile.open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.delete.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {t("profile.delete.description", {
              profileName: activeProfileName || t("profile.delete.fallback_name"),
            })}
          </div>

          <Input
            autoFocus
            data-testid="profile:delete-confirm-input"
            onChange={(event) => deleteProfile.setConfirm(event.target.value)}
            placeholder={t("profile.delete.placeholder")}
            value={deleteProfile.confirm}
          />

          {deleteProfile.error ? (
            <div className="text-sm text-destructive">{deleteProfile.error}</div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              data-testid="profile:delete-cancel"
              disabled={deleteProfile.saving}
              onClick={() => deleteProfile.setOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              data-testid="profile:delete-submit"
              disabled={!deleteProfile.canConfirm}
              onClick={onConfirmDeleteProfile}
              type="button"
              variant="destructive"
            >
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
