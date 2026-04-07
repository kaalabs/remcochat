"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type FolderMember = {
  profileId: string;
  name: string;
  createdAt: string;
};

type NewFolderDialogState = {
  draft: string;
  error: string | null;
  open: boolean;
  saving: boolean;
  setDraft: (value: string) => void;
  setError: (value: string | null) => void;
  setOpen: (open: boolean) => void;
};

type RenameFolderDialogState = {
  draft: string;
  error: string | null;
  folderId: string;
  open: boolean;
  saving: boolean;
  setDraft: (value: string) => void;
  setError: (value: string | null) => void;
  setOpen: (open: boolean) => void;
};

type DeleteFolderDialogState = {
  error: string | null;
  folderId: string;
  name: string;
  open: boolean;
  saving: boolean;
  setOpen: (open: boolean) => void;
};

type ShareFolderDialogState = {
  error: string | null;
  folderId: string;
  name: string;
  open: boolean;
  saving: boolean;
  setError: (value: string | null) => void;
  setOpen: (open: boolean) => void;
  setTarget: (value: string) => void;
  target: string;
};

type ManageSharingDialogState = {
  error: string | null;
  folderName: string;
  loading: boolean;
  members: FolderMember[];
  open: boolean;
  saving: boolean;
  setOpen: (open: boolean) => void;
};

export function HomeClientFolderDialogs(props: {
  activeProfileAvailable: boolean;
  deleteFolder: DeleteFolderDialogState;
  manageSharing: ManageSharingDialogState;
  newFolder: NewFolderDialogState;
  onConfirmDeleteFolder: () => void;
  onConfirmShareFolder: () => void;
  onCreateFolderByName: () => void;
  onSaveRenameFolder: () => void;
  onStopSharingFolderWithMember: (member: FolderMember) => void;
  renameFolder: RenameFolderDialogState;
  shareFolder: ShareFolderDialogState;
  statusReady: boolean;
  t: I18nContextValue["t"];
}) {
  const {
    activeProfileAvailable,
    deleteFolder,
    manageSharing,
    newFolder,
    onConfirmDeleteFolder,
    onConfirmShareFolder,
    onCreateFolderByName,
    onSaveRenameFolder,
    onStopSharingFolderWithMember,
    renameFolder,
    shareFolder,
    statusReady,
    t,
  } = props;

  return (
    <>
      <Dialog onOpenChange={newFolder.setOpen} open={newFolder.open}>
        <DialogContent data-testid="folder:new-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.new.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              data-testid="folder:new-input"
              onChange={(e) => {
                newFolder.setDraft(e.target.value);
                if (newFolder.error) newFolder.setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  newFolder.setOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCreateFolderByName();
                }
              }}
              placeholder={t("folder.name.placeholder")}
              value={newFolder.draft}
            />

            {newFolder.error ? (
              <div className="text-sm text-destructive">{newFolder.error}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:new-cancel"
                disabled={newFolder.saving}
                onClick={() => newFolder.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="folder:new-create"
                disabled={
                  !activeProfileAvailable ||
                  !statusReady ||
                  newFolder.saving ||
                  !newFolder.draft.trim() ||
                  newFolder.draft.trim().length > 60
                }
                onClick={() => onCreateFolderByName()}
                type="button"
              >
                {t("common.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={renameFolder.setOpen} open={renameFolder.open}>
        <DialogContent data-testid="folder:rename-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.rename.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              autoFocus
              data-testid="folder:rename-input"
              onChange={(e) => {
                renameFolder.setDraft(e.target.value);
                if (renameFolder.error) renameFolder.setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  renameFolder.setOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSaveRenameFolder();
                }
              }}
              placeholder={t("folder.name.placeholder")}
              value={renameFolder.draft}
            />

            {renameFolder.error ? (
              <div className="text-sm text-destructive">{renameFolder.error}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:rename-cancel"
                disabled={renameFolder.saving}
                onClick={() => renameFolder.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="folder:rename-save"
                disabled={
                  !activeProfileAvailable ||
                  !statusReady ||
                  renameFolder.saving ||
                  !renameFolder.folderId ||
                  !renameFolder.draft.trim() ||
                  renameFolder.draft.trim().length > 60
                }
                onClick={() => onSaveRenameFolder()}
                type="button"
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={deleteFolder.setOpen} open={deleteFolder.open}>
        <DialogContent data-testid="folder:delete-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.delete.confirm_title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {t("folder.delete.description")}
            </div>

            {deleteFolder.name ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {deleteFolder.name}
              </div>
            ) : null}

            {deleteFolder.error ? (
              <div className="text-sm text-destructive">{deleteFolder.error}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:delete-cancel"
                disabled={deleteFolder.saving}
                onClick={() => deleteFolder.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="folder:delete-confirm"
                disabled={
                  !activeProfileAvailable ||
                  !statusReady ||
                  deleteFolder.saving ||
                  !deleteFolder.folderId
                }
                onClick={() => onConfirmDeleteFolder()}
                type="button"
                variant="destructive"
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={shareFolder.setOpen} open={shareFolder.open}>
        <DialogContent data-testid="folder:share-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.share.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {t("folder.share.description")}
            </div>

            {shareFolder.name ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {shareFolder.name}
              </div>
            ) : null}

            <Input
              autoFocus
              data-testid="folder:share-target"
              onChange={(e) => {
                shareFolder.setTarget(e.target.value);
                if (shareFolder.error) shareFolder.setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  shareFolder.setOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  onConfirmShareFolder();
                }
              }}
              placeholder={t("folder.share.placeholder")}
              value={shareFolder.target}
            />

            {shareFolder.error ? (
              <div className="text-sm text-destructive">{shareFolder.error}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                data-testid="folder:share-cancel"
                disabled={shareFolder.saving}
                onClick={() => shareFolder.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="folder:share-submit"
                disabled={
                  !activeProfileAvailable ||
                  !statusReady ||
                  shareFolder.saving ||
                  !shareFolder.folderId ||
                  !shareFolder.target.trim()
                }
                onClick={() => onConfirmShareFolder()}
                type="button"
              >
                {t("folder.share")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={manageSharing.setOpen} open={manageSharing.open}>
        <DialogContent data-testid="folder:manage-sharing-dialog">
          <DialogHeader>
            <DialogTitle>{t("folder.manage_sharing")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {manageSharing.folderName ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm">
                {manageSharing.folderName}
              </div>
            ) : null}

            {manageSharing.loading ? (
              <div className="text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : null}

            {manageSharing.error ? (
              <div className="text-sm text-destructive">{manageSharing.error}</div>
            ) : null}

            {!manageSharing.loading && manageSharing.members.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("folder.manage_sharing.empty")}
              </div>
            ) : null}

            {!manageSharing.loading && manageSharing.members.length > 0 ? (
              <div className="space-y-2">
                {manageSharing.members.map((member) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                    key={member.profileId}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{member.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {member.profileId}
                      </div>
                    </div>
                    <Button
                      className="h-8 shrink-0"
                      disabled={manageSharing.saving}
                      onClick={() => onStopSharingFolderWithMember(member)}
                      type="button"
                      variant="destructive"
                    >
                      {t("folder.manage_sharing.stop")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                data-testid="folder:manage-sharing-close"
                disabled={manageSharing.saving}
                onClick={() => manageSharing.setOpen(false)}
                type="button"
                variant="ghost"
              >
                {t("common.close")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
