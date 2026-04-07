import type { MemoryItem } from "@/domain/memory/types";
import { nanoid } from "nanoid";
import { ensureMemoryContent } from "@/server/memory-domain";
import {
  sqliteMemoryRepository,
  type MemoryRepository,
} from "@/server/memory-repository";
import { getProfile } from "@/server/profiles";

export type MemoryService = {
  listProfileMemory(profileId: string): MemoryItem[];
  createMemoryItem(input: { profileId: string; content: string }): MemoryItem;
  getMemoryItem(profileId: string, id: string): MemoryItem;
  deleteMemoryItem(profileId: string, id: string): void;
};

export function createMemoryService(repository: MemoryRepository): MemoryService {
  return {
    listProfileMemory(profileId) {
      return repository.listProfileMemory(profileId);
    },

    createMemoryItem(input) {
      const profile = getProfile(input.profileId);
      return repository.createMemoryItem({
        id: nanoid(),
        profileId: profile.id,
        content: ensureMemoryContent(input.content),
        now: new Date().toISOString(),
      });
    },

    getMemoryItem(profileId, id) {
      const item = repository.getMemoryItem(profileId, id);
      if (!item) throw new Error("Memory item not found.");
      return item;
    },

    deleteMemoryItem(profileId, id) {
      repository.deleteMemoryItem(profileId, id);
    },
  };
}

export const memoryService = createMemoryService(sqliteMemoryRepository);
export const listProfileMemory = memoryService.listProfileMemory;
export const createMemoryItem = memoryService.createMemoryItem;
export const getMemoryItem = memoryService.getMemoryItem;
export const deleteMemoryItem = memoryService.deleteMemoryItem;
