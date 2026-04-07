import { foldersService } from "@/server/folders-service";

export { foldersService } from "@/server/folders-service";

export const listFolders = foldersService.listFolders;
export const listAccessibleFolders = foldersService.listAccessibleFolders;
export const createFolder = foldersService.createFolder;
export const updateFolder = foldersService.updateFolder;
export const updateFolderForViewer = foldersService.updateFolderForViewer;
export const renameFolder = foldersService.renameFolder;
export const setFolderCollapsed = foldersService.setFolderCollapsed;
export const deleteFolder = foldersService.deleteFolder;
export const shareFolder = foldersService.shareFolder;
export const unshareFolder = foldersService.unshareFolder;
export const listFolderMembers = foldersService.listFolderMembers;
