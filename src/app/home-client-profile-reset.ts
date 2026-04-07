"use client";

import type { UIMessage } from "ai";
import type { Dispatch, SetStateAction } from "react";

import type {
  AccessibleChat,
  RemcoChatMessageMetadata,
} from "@/domain/chats/types";
import type { AccessibleChatFolder } from "@/domain/folders/types";

type VariantsByUserMessageId = Record<
  string,
  UIMessage<RemcoChatMessageMetadata>[]
>;

type RunHomeClientProfileResetInput = {
  nextActiveProfileId?: string;
  setActiveChatId: Dispatch<SetStateAction<string>>;
  setActiveProfileId?: Dispatch<SetStateAction<string>>;
  setChats: Dispatch<SetStateAction<AccessibleChat[]>>;
  setFolders?: Dispatch<SetStateAction<AccessibleChatFolder[]>>;
  setIsTemporaryChat?: Dispatch<SetStateAction<boolean>>;
  setVariantsByUserMessageId?: Dispatch<
    SetStateAction<VariantsByUserMessageId>
  >;
};

export function runHomeClientProfileReset({
  nextActiveProfileId,
  setActiveChatId,
  setActiveProfileId,
  setChats,
  setFolders,
  setIsTemporaryChat,
  setVariantsByUserMessageId,
}: RunHomeClientProfileResetInput) {
  if (setActiveProfileId && typeof nextActiveProfileId === "string") {
    setActiveProfileId(nextActiveProfileId);
  }
  setChats([]);
  setFolders?.([]);
  setActiveChatId("");
  setVariantsByUserMessageId?.({});
  setIsTemporaryChat?.(false);
}
