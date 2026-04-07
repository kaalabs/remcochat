import type {
  AccessibleChatFolder,
  ChatFolder,
} from "@/domain/folders/types";
import { nanoid } from "nanoid";
import { ensureFolderName, normalizeFolderSpaces } from "@/server/folders-domain";
import {
  sqliteFoldersRepository,
  type FoldersRepository,
  type StoredAccessibleFolderRecord,
  type StoredChatFolderRecord,
} from "@/server/folders-repository";

function isFolderNameConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("idx_chat_folders_profile_name")
  );
}

function recordToFolder(record: StoredChatFolderRecord): ChatFolder {
  return {
    id: record.id,
    profileId: record.profileId,
    name: record.name,
    collapsed: record.collapsed,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function recordToAccessibleFolder(record: StoredAccessibleFolderRecord): AccessibleChatFolder {
  return {
    ...recordToFolder(record),
    scope: record.scope,
    ownerName: record.ownerName,
    sharedWithCount: record.sharedWithCount,
  };
}

export type FoldersService = {
  listFolders(profileId: string): ChatFolder[];
  listAccessibleFolders(profileId: string): AccessibleChatFolder[];
  createFolder(profileId: string, input: { name: string }): ChatFolder;
  updateFolder(
    profileId: string,
    folderId: string,
    input: { name?: string; collapsed?: boolean },
  ): ChatFolder;
  updateFolderForViewer(
    profileId: string,
    folderId: string,
    input: { name?: string; collapsed?: boolean },
  ): AccessibleChatFolder;
  renameFolder(profileId: string, folderId: string, input: { name: string }): ChatFolder;
  setFolderCollapsed(
    profileId: string,
    folderId: string,
    input: { collapsed: boolean },
  ): ChatFolder;
  deleteFolder(profileId: string, folderId: string): void;
  shareFolder(profileId: string, folderId: string, input: { targetProfile: string }): void;
  unshareFolder(profileId: string, folderId: string, input: { targetProfile: string }): void;
  listFolderMembers(
    profileId: string,
    folderId: string,
  ): Array<{ profileId: string; name: string; createdAt: string }>;
};

export function createFoldersService(repository: FoldersRepository): FoldersService {
  function getOwnedFolderOrThrow(profileId: string, folderId: string) {
    const folder = repository.getOwnedFolderRecord(profileId, folderId);
    if (!folder) throw new Error("Folder not found.");
    return folder;
  }

  function getFolderByIdOrThrow(folderId: string) {
    const folder = repository.getFolderRecordById(folderId);
    if (!folder) throw new Error("Folder not found.");
    return folder;
  }

  function resolveProfileIdentifier(identifier: string) {
    const matches = repository.findProfilesByIdentifier(identifier);
    if (matches.length === 0) {
      throw new Error("Profile not found.");
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple profiles are named "${identifier}". Rename one to share folders.`,
      );
    }
    return matches[0]!;
  }

  function ensureUniqueFolderName(
    profileId: string,
    name: string,
    excludeFolderId?: string,
  ) {
    if (repository.folderNameExists(profileId, name, excludeFolderId)) {
      throw new Error("Folder name already exists.");
    }
  }

  function listFolders(profileId: string) {
    return repository.listOwnedFolderRecords(profileId).map(recordToFolder);
  }

  function listAccessibleFolders(profileId: string) {
    return repository
      .listAccessibleFolderRecords(profileId)
      .map(recordToAccessibleFolder);
  }

  function getAccessibleFolderForViewer(profileId: string, folderId: string) {
    const folder = listAccessibleFolders(profileId).find((entry) => entry.id === folderId);
    if (!folder) throw new Error("Folder not accessible.");
    return folder;
  }

  function createFolder(profileId: string, input: { name: string }) {
    const name = ensureFolderName(input.name);
    ensureUniqueFolderName(profileId, name);

    try {
      return recordToFolder(
        repository.createOwnedFolderRecord({
          id: nanoid(),
          profileId,
          name,
          collapsed: false,
          now: new Date().toISOString(),
        }),
      );
    } catch (error) {
      if (isFolderNameConstraintError(error)) {
        throw new Error("Folder name already exists.");
      }
      throw error;
    }
  }

  function updateFolder(
    profileId: string,
    folderId: string,
    input: { name?: string; collapsed?: boolean },
  ) {
    const existing = getOwnedFolderOrThrow(profileId, folderId);
    const name =
      input.name === undefined ? existing.name : ensureFolderName(input.name);
    const collapsed =
      input.collapsed === undefined ? existing.collapsed : input.collapsed;

    if (name !== existing.name) {
      ensureUniqueFolderName(profileId, name, folderId);
    }

    try {
      return recordToFolder(
        repository.updateOwnedFolderRecord({
          profileId,
          folderId,
          name,
          collapsed,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      if (isFolderNameConstraintError(error)) {
        throw new Error("Folder name already exists.");
      }
      throw error;
    }
  }

  function updateFolderForViewer(
    profileId: string,
    folderId: string,
    input: { name?: string; collapsed?: boolean },
  ) {
    const folder = getFolderByIdOrThrow(folderId);
    if (folder.profileId === profileId) {
      updateFolder(profileId, folderId, input);
      return getAccessibleFolderForViewer(profileId, folderId);
    }

    const membership = repository.getFolderMembershipRecord(folderId, profileId);
    if (!membership) {
      throw new Error("Folder not accessible.");
    }
    if (input.name !== undefined) {
      throw new Error("Only the folder owner can rename it.");
    }

    if (input.collapsed !== undefined) {
      repository.updateFolderMembershipCollapsed({
        folderId,
        profileId,
        collapsed: input.collapsed,
      });
      return getAccessibleFolderForViewer(profileId, folderId);
    }

    return getAccessibleFolderForViewer(profileId, folderId);
  }

  function renameFolder(profileId: string, folderId: string, input: { name: string }) {
    return updateFolder(profileId, folderId, { name: input.name });
  }

  function setFolderCollapsed(
    profileId: string,
    folderId: string,
    input: { collapsed: boolean },
  ) {
    return updateFolder(profileId, folderId, { collapsed: input.collapsed });
  }

  function deleteFolder(profileId: string, folderId: string) {
    getOwnedFolderOrThrow(profileId, folderId);
    repository.deleteOwnedFolderAndDetachChats(profileId, folderId);
  }

  function shareFolder(
    profileId: string,
    folderId: string,
    input: { targetProfile: string },
  ) {
    const folder = getOwnedFolderOrThrow(profileId, folderId);
    const targetHint = normalizeFolderSpaces(String(input.targetProfile ?? ""));
    if (!targetHint) {
      throw new Error("Target profile is required.");
    }
    const target = resolveProfileIdentifier(targetHint);
    if (target.id === folder.profileId) {
      throw new Error("You cannot share a folder with its owner.");
    }
    repository.addFolderMember({
      folderId,
      profileId: target.id,
      collapsed: false,
      createdAt: new Date().toISOString(),
    });
  }

  function unshareFolder(
    profileId: string,
    folderId: string,
    input: { targetProfile: string },
  ) {
    const folder = getOwnedFolderOrThrow(profileId, folderId);
    const targetHint = normalizeFolderSpaces(String(input.targetProfile ?? ""));
    if (!targetHint) {
      throw new Error("Target profile is required.");
    }
    const target = resolveProfileIdentifier(targetHint);
    if (target.id === folder.profileId) {
      throw new Error("Cannot remove the folder owner.");
    }
    repository.removeFolderMember(folderId, target.id);
  }

  function listFolderMembers(profileId: string, folderId: string) {
    getOwnedFolderOrThrow(profileId, folderId);
    return repository.listFolderMemberProfiles(folderId);
  }

  return {
    listFolders,
    listAccessibleFolders,
    createFolder,
    updateFolder,
    updateFolderForViewer,
    renameFolder,
    setFolderCollapsed,
    deleteFolder,
    shareFolder,
    unshareFolder,
    listFolderMembers,
  };
}

export const foldersService = createFoldersService(sqliteFoldersRepository);
