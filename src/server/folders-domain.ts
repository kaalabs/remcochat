const MAX_FOLDER_NAME_LENGTH = 60;

export function normalizeFolderSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function ensureFolderName(name: string) {
  const trimmed = normalizeFolderSpaces(String(name ?? ""));
  if (!trimmed) {
    throw new Error("Folder name is required.");
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error("Folder name is too long.");
  }
  return trimmed;
}
