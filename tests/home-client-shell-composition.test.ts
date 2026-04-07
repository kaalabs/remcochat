import assert from "node:assert/strict";
import test from "node:test";

import { isValidElement, type ComponentProps, type ReactElement } from "react";

import {
  createHomeClientRootShellProps,
} from "../src/app/home-client-shell-composition";
import {
  HomeClientSidebarController,
} from "../src/app/home-client-sidebar-controller";

function createInput(
  overrides: Partial<Parameters<typeof createHomeClientRootShellProps>[0]> = {}
): Parameters<typeof createHomeClientRootShellProps>[0] {
  const noop = () => {};
  const setOpenSpy = (open: boolean) => open;

  return {
    activeChat: {
      id: "chat-1",
      title: "Chat 1",
      profileId: "profile-1",
      modelId: "model-1",
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-26T12:05:00.000Z",
      folderId: null,
      chatInstructions: "",
      chatInstructionsRevision: 0,
      activatedSkillNames: [],
      scope: "owned",
      pinnedAt: null,
      archivedAt: null,
      deletedAt: null,
      ownerName: "Owner",
    },
    activeChatId: "chat-1",
    activeProfile: {
      id: "profile-1",
      name: "Owner",
      createdAt: "2026-03-26T12:00:00.000Z",
      defaultModelId: "model-1",
      customInstructions: "",
      customInstructionsRevision: 0,
      memoryEnabled: true,
      uiLanguage: "en",
      avatar: null,
    },
    adminEnabled: true,
    appVersion: "0.26.8",
    archivedOpen: true,
    canManageActiveChat: true,
    chatActions: {
      archiveChatById: noop,
      canSaveRenameChat: true,
      deleteChat: { error: "delete failed" },
      deleteChatById: noop,
      exportChatById: noop,
      openRenameChat: noop,
      renameChat: { open: false },
      renameChatTitle: noop,
      togglePinChatById: noop,
      unarchiveChatById: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["chatActions"],
    chatColumnMaxWidthClass: "max-w-5xl",
    chatSession: {
      addToolApprovalResponse: noop,
      attachmentUploadError: null,
      canSend: true,
      chatRequestBody: { profileId: "profile-1" },
      error: null,
      handleAttachmentCountChange: noop,
      handleAttachmentError: noop,
      handleComposerKeyDown: noop,
      handlePromptSubmit: noop,
      input: "hello",
      messages: [],
      regenerateLatest: noop,
      retryLatest: noop,
      sendMemoryDecision: noop,
      sendOpenList: noop,
      setInput: noop,
      setMessages: noop,
      showThinking: false,
      status: "ready",
      stop: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["chatSession"],
    chatSettingsController: {
      chatSettings: { open: false, chatId: "chat-1", instructionsDraft: "" },
      openChatSettings: noop,
      saveChatSettings: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["chatSettingsController"],
    chats: [],
    closeSidebarDrawer: noop,
    createChat: noop,
    createProfileController: {
      createProfile: {
        error: null,
        name: "",
        open: false,
        saving: false,
        setName: noop,
        setOpen: noop,
      },
      saveCreateProfile: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["createProfileController"],
    desktopGridStyle: {},
    desktopSidebarCollapsed: false,
    desktopSidebarResizing: false,
    editForkController: {
      editFork: { open: false },
      forkFromEdit: noop,
      startEditUserMessage: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["editForkController"],
    endDesktopSidebarResize: noop,
    folderActions: {
      confirmDeleteFolder: noop,
      confirmShareFolder: noop,
      createFolderByName: noop,
      deleteFolder: { open: false },
      folderError: "folder failed",
      manageSharing: { open: false },
      moveChatToFolder: noop,
      newFolder: { open: false, setOpen: noop },
      openDeleteFolder: noop,
      openManageFolderSharing: noop,
      openRenameFolder: noop,
      openShareFolder: noop,
      renameFolder: { open: false },
      saveRenameFolder: noop,
      shareFolder: { open: false },
      stopSharingFolderWithMember: noop,
      toggleFolderCollapsed: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["folderActions"],
    folderGroupCollapsed: { personal: true },
    handleSidebarDrawerOpenChange: noop,
    hasArchivedChats: true,
    isTemporaryChat: false,
    lanAdminAccessEnabled: true,
    lanAdminState: {
      clearLanAdminTokenState: noop,
      lanAdminAccess: {
        allowed: true,
        allowedReason: "",
        bashToolsEnabledHeader: null,
        draft: "",
        hasToken: true,
        open: false,
        remember: false,
        setDraft: noop,
        setOpen: setOpenSpy,
        setRemember: noop,
        setVisible: noop,
        visible: false,
      },
      saveLanAdminToken: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["lanAdminState"],
    memorizeController: {
      memorize: { open: false },
      saveMemorize: noop,
      startMemorize: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["memorizeController"],
    modelSelection: {
      effectiveModelId: "model-1",
      handleHeaderModelChange: noop,
      modelOptions: [],
      providersLoadError: "providers failed",
      reasoningEffort: "medium",
      reasoningOptions: [],
      selectedModel: null,
      setReasoningEffort: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["modelSelection"],
    onArchivedOpenChange: noop,
    onCollapseDesktop: noop,
    onCreateFolder: noop,
    onExpandDesktopSidebar: noop,
    onMoveDesktopSidebarResize: noop,
    onOpenCreateProfileFromSidebar: noop,
    onOpenLanAdmin: noop,
    onOpenProfileSettingsFromSidebar: noop,
    onOpenSidebar: noop,
    onResetDesktopSidebarWidth: noop,
    onSelectPersistedSidebarChat: noop,
    onSelectProfile: noop,
    onSetVariantsByUserMessageId: noop,
    onSidebarProfileSelectOpenChange: noop,
    onToggleTemporaryChat: noop,
    openingMessage: "Start chatting",
    ownedFolders: [],
    profiles: [],
    profileSettingsController: {
      avatarFileInputRef: { current: null },
      chooseAvatarFile: noop,
      confirmDeleteProfile: noop,
      deleteMemory: noop,
      deleteProfile: { open: false },
      handleAvatarFileChange: noop,
      profileSettings: { open: false },
      removeAvatarDraft: noop,
      saveProfileSettings: noop,
    } as unknown as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["profileSettingsController"],
    setFolderGroupCollapsedValue: noop,
    sharedFoldersByOwner: [],
    sidebarOpen: true,
    startDesktopSidebarResize: noop,
    stickToBottomContextRef: { current: null } as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["stickToBottomContextRef"],
    t: ((key: string) => key) as Parameters<
      typeof createHomeClientRootShellProps
    >[0]["t"],
    variantsByUserMessageId: {},
    ...overrides,
  };
}

test("createHomeClientRootShellProps wires the sidebar controller for desktop and drawer shells", () => {
  const result = createHomeClientRootShellProps(createInput());

  assert.ok(isValidElement(result.desktopSidebarContent));
  const desktopSidebar = result.desktopSidebarContent as ReactElement<
    ComponentProps<typeof HomeClientSidebarController>
  >;
  assert.equal(desktopSidebar.type, HomeClientSidebarController);
  assert.equal(desktopSidebar.props.mode, "desktop");
  assert.equal(desktopSidebar.props.activeChatId, "chat-1");

  assert.ok(isValidElement(result.overlays.drawerContent));
  const drawerSidebar = result.overlays.drawerContent as ReactElement<
    ComponentProps<typeof HomeClientSidebarController>
  >;
  assert.equal(drawerSidebar.type, HomeClientSidebarController);
  assert.equal(drawerSidebar.props.mode, "drawer");
  assert.equal(drawerSidebar.props.activeChatId, "chat-1");
});

test("createHomeClientRootShellProps preserves the extracted main-column and overlay contracts", () => {
  const result = createHomeClientRootShellProps(
    createInput({
      desktopSidebarCollapsed: true,
    })
  );

  assert.equal(result.desktopSidebarContent, null);
  assert.equal(result.mainColumn.contentMaxWidthClass, "max-w-5xl");
  assert.equal(result.mainColumn.header.effectiveModelId, "model-1");
  assert.equal(result.mainColumn.providersLoadError, "providers failed");
  assert.equal(result.overlays.drawerOpen, true);
  assert.equal(
    result.overlays.chatSettingsDialog.chatSettings.instructionsDraft,
    ""
  );
  assert.equal(
    result.overlays.renameChatDialog.canSaveRenameChat,
    true
  );
});
