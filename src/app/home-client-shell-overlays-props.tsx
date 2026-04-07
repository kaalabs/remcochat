"use client";

import type {
  CreateHomeClientRootShellPropsInput,
  HomeClientOverlaysProps,
  HomeClientSidebarControllerSharedProps,
} from "@/app/home-client-shell-types";
import {
  renderHomeClientSidebarController,
} from "@/app/home-client-shell-sidebar-props";

export function createHomeClientOverlaysProps(
  input: CreateHomeClientRootShellPropsInput,
  sidebarControllerSharedProps: HomeClientSidebarControllerSharedProps
): HomeClientOverlaysProps {
  return {
    chatSettingsDialog: {
      chatSettings: input.chatSettingsController.chatSettings,
      onSaveChatSettings: input.chatSettingsController.saveChatSettings,
      t: input.t,
    },
    createProfileDialog: {
      createError: input.createProfileController.createProfile.error,
      createOpen: input.createProfileController.createProfile.open,
      creating: input.createProfileController.createProfile.saving,
      newProfileName: input.createProfileController.createProfile.name,
      onCreateProfile: input.createProfileController.saveCreateProfile,
      setCreateOpen: input.createProfileController.createProfile.setOpen,
      setNewProfileName: input.createProfileController.createProfile.setName,
      t: input.t,
    },
    deleteProfileDialog: {
      activeProfileName: input.activeProfile?.name ?? "",
      deleteProfile: input.profileSettingsController.deleteProfile,
      onConfirmDeleteProfile: input.profileSettingsController.confirmDeleteProfile,
      t: input.t,
    },
    drawerContent: renderHomeClientSidebarController(
      sidebarControllerSharedProps,
      "drawer"
    ),
    drawerOpen: input.sidebarOpen,
    editForkDialog: {
      editFork: input.editForkController.editFork,
      onForkFromEdit: input.editForkController.forkFromEdit,
      t: input.t,
    },
    folderDialogs: {
      activeProfileAvailable: Boolean(input.activeProfile),
      deleteFolder: input.folderActions.deleteFolder,
      manageSharing: input.folderActions.manageSharing,
      newFolder: input.folderActions.newFolder,
      onConfirmDeleteFolder: input.folderActions.confirmDeleteFolder,
      onConfirmShareFolder: input.folderActions.confirmShareFolder,
      onCreateFolderByName: input.folderActions.createFolderByName,
      onSaveRenameFolder: input.folderActions.saveRenameFolder,
      onStopSharingFolderWithMember:
        input.folderActions.stopSharingFolderWithMember,
      renameFolder: input.folderActions.renameFolder,
      shareFolder: input.folderActions.shareFolder,
      statusReady: input.chatSession.status === "ready",
      t: input.t,
    },
    lanAdminDialog: {
      clearLanAdminTokenState: input.lanAdminState.clearLanAdminTokenState,
      lanAdminAccess: input.lanAdminState.lanAdminAccess,
      lanAdminAccessEnabled: input.lanAdminAccessEnabled,
      saveLanAdminToken: input.lanAdminState.saveLanAdminToken,
      t: input.t,
    },
    memorizeDialog: {
      memorize: input.memorizeController.memorize,
      onSaveMemorize: input.memorizeController.saveMemorize,
      t: input.t,
    },
    onDrawerOpenChange: input.handleSidebarDrawerOpenChange,
    profileSettingsDialog: {
      activeProfile: input.activeProfile,
      avatarFileInputRef: input.profileSettingsController.avatarFileInputRef,
      canOpenDeleteProfile:
        Boolean(input.activeProfile) && input.chatSession.status === "ready",
      deleteProfile: input.profileSettingsController.deleteProfile,
      onAvatarFileChange: input.profileSettingsController.handleAvatarFileChange,
      onChooseAvatarFile: input.profileSettingsController.chooseAvatarFile,
      onDeleteMemory: input.profileSettingsController.deleteMemory,
      onRemoveAvatarDraft: input.profileSettingsController.removeAvatarDraft,
      onSaveProfileSettings: input.profileSettingsController.saveProfileSettings,
      profileSettings: input.profileSettingsController.profileSettings,
      t: input.t,
    },
    renameChatDialog: {
      canSaveRenameChat: input.chatActions.canSaveRenameChat,
      onRenameChatTitle: input.chatActions.renameChatTitle,
      renameChat: input.chatActions.renameChat,
      t: input.t,
    },
    t: input.t,
  };
}
