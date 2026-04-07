"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import type { AccessibleChat } from "@/domain/chats/types";
import type { Profile } from "@/domain/profiles/types";
import {
  useHomeClientAppState,
} from "@/app/home-client-app-state";
import {
  useHomeClientControllers,
} from "@/app/home-client-controllers";
import {
  useDesktopSidebarShell,
} from "@/app/home-client-desktop-sidebar";
import {
  createHomeClientRootShellProps,
} from "@/app/home-client-shell-composition";
import {
  useHomeClientGlobalUiEffects,
  useHomeClientTranscriptScroll,
} from "@/app/home-client-ui-effects";

type UseHomeClientPageCompositionInput = {
  adminEnabled: boolean;
  appVersion: string;
  initialActiveProfileId: string;
  initialChats: AccessibleChat[];
  initialProfiles: Profile[];
  lanAdminAccessEnabled: boolean;
  setUiLanguage: I18nContextValue["setUiLanguage"];
  t: I18nContextValue["t"];
  uiLanguage: Profile["uiLanguage"];
};

export function useHomeClientPageComposition({
  adminEnabled,
  appVersion,
  initialActiveProfileId,
  initialChats,
  initialProfiles,
  lanAdminAccessEnabled,
  setUiLanguage,
  t,
  uiLanguage,
}: UseHomeClientPageCompositionInput) {
  const appState = useHomeClientAppState({
    initialActiveProfileId,
    initialChats,
    initialProfiles,
  });

  const transcriptScroll = useHomeClientTranscriptScroll();
  const desktopSidebarShell = useDesktopSidebarShell();

  const controllers = useHomeClientControllers({
    appState,
    initialActiveProfileId,
    initialProfiles,
    lanAdminAccessEnabled,
    queueScrollTranscriptToBottom:
      transcriptScroll.queueScrollTranscriptToBottom,
    scrollTranscriptToBottom: transcriptScroll.scrollTranscriptToBottom,
    setDesktopSidebarCollapsed:
      desktopSidebarShell.setDesktopSidebarCollapsed,
    setUiLanguage,
    t,
    uiLanguage,
  });

  const {
    activeChatId,
    archivedOpen,
    chats,
    hasArchivedChats,
    profiles,
    setArchivedOpen,
    setVariantsByUserMessageId,
    variantsByUserMessageId,
  } = appState;
  const { stickToBottomContextRef } = transcriptScroll;
  const {
    desktopGridStyle,
    desktopSidebarCollapsed,
    desktopSidebarResizing,
    endDesktopSidebarResize,
    moveDesktopSidebarResize,
    resetDesktopSidebarWidth,
    startDesktopSidebarResize,
  } = desktopSidebarShell;
  const {
    chatControllers,
    profileControllers,
    shellControllers,
  } = controllers;
  const { activeChat, activeProfile, selectProfile } =
    profileControllers.profileSelection;
  const {
    folderGroupCollapsed,
    ownedFolders,
    setFolderGroupCollapsedValue,
    sharedFoldersByOwner,
  } = profileControllers.folderSidebarGroups;
  const { lanAdminAccess } = chatControllers.lanAdminState;
  const {
    closeSidebarDrawer,
    handleSidebarDrawerOpenChange,
    handleSidebarProfileSelectOpenChange,
    openCreateProfileFromSidebar,
    openProfileSettingsFromSidebar,
    openSidebarDrawer,
    openingMessage,
    selectPersistedSidebarChat,
    setDesktopSidebarCollapsedWithComposerFocus,
    sidebarOpen,
    toggleTemporaryChat,
  } = shellControllers.pageController;

  useHomeClientGlobalUiEffects(
    {
      activeChatId,
      chatSettingsOpen: chatControllers.chatSettingsController.chatSettings.open,
      createChat: chatControllers.chatBootstrap.createChat,
      createProfileOpen: shellControllers.createProfileController.createProfile.open,
      editOpen: chatControllers.editForkController.editFork.open,
      focusComposer: shellControllers.pageController.focusComposer,
      isTemporaryChat: chatControllers.isTemporaryChat,
      memorizeOpen: shellControllers.memorizeController.memorize.open,
      messages: chatControllers.chatSession.messages,
      pinTranscriptToBottomIfFollowing:
        transcriptScroll.pinTranscriptToBottomIfFollowing,
      profileSettingsOpen: shellControllers.profileSettingsController.profileSettings.open,
      profileSelectOpen: shellControllers.pageController.profileSelectOpen,
      status: chatControllers.chatSession.status,
      stop: chatControllers.chatSession.stop,
    }
  );

  return createHomeClientRootShellProps({
    activeChat,
    activeChatId,
    activeProfile,
    adminEnabled,
    appVersion,
    archivedOpen,
    canManageActiveChat: chatControllers.canManageActiveChat,
    chatActions: chatControllers.chatActions,
    chatColumnMaxWidthClass: desktopSidebarCollapsed
      ? "max-w-none"
      : "max-w-5xl",
    chatSession: chatControllers.chatSession,
    chatSettingsController: chatControllers.chatSettingsController,
    chats,
    closeSidebarDrawer,
    createChat: chatControllers.chatBootstrap.createChat,
    createProfileController: shellControllers.createProfileController,
    desktopGridStyle,
    desktopSidebarCollapsed,
    desktopSidebarResizing,
    editForkController: chatControllers.editForkController,
    endDesktopSidebarResize,
    folderActions: shellControllers.folderActions,
    folderGroupCollapsed,
    handleSidebarDrawerOpenChange,
    hasArchivedChats,
    isTemporaryChat: chatControllers.isTemporaryChat,
    lanAdminAccessEnabled,
    lanAdminState: chatControllers.lanAdminState,
    memorizeController: shellControllers.memorizeController,
    modelSelection: chatControllers.modelSelection,
    onArchivedOpenChange: setArchivedOpen,
    onCollapseDesktop: () =>
      setDesktopSidebarCollapsedWithComposerFocus(true),
    onCreateFolder: () => shellControllers.folderActions.newFolder.setOpen(true),
    onExpandDesktopSidebar: () =>
      setDesktopSidebarCollapsedWithComposerFocus(false),
    onMoveDesktopSidebarResize: moveDesktopSidebarResize,
    onOpenCreateProfileFromSidebar: openCreateProfileFromSidebar,
    onOpenLanAdmin: () => lanAdminAccess.setOpen(true),
    onOpenProfileSettingsFromSidebar: openProfileSettingsFromSidebar,
    onOpenSidebar: openSidebarDrawer,
    onResetDesktopSidebarWidth: resetDesktopSidebarWidth,
    onSelectPersistedSidebarChat: selectPersistedSidebarChat,
    onSelectProfile: selectProfile,
    onSetVariantsByUserMessageId: setVariantsByUserMessageId,
    onSidebarProfileSelectOpenChange: handleSidebarProfileSelectOpenChange,
    onToggleTemporaryChat: toggleTemporaryChat,
    openingMessage,
    ownedFolders,
    profiles,
    profileSettingsController: shellControllers.profileSettingsController,
    setFolderGroupCollapsedValue,
    sharedFoldersByOwner,
    sidebarOpen,
    startDesktopSidebarResize,
    stickToBottomContextRef,
    t,
    variantsByUserMessageId,
  });
}
