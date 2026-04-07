"use client";

import type { UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useRef,
} from "react";

import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { StickToBottomContext } from "use-stick-to-bottom";

type ComposerFocusGuardInput = {
  chatSettingsOpen: boolean;
  createProfileOpen: boolean;
  editOpen: boolean;
  memorizeOpen: boolean;
  profileSettingsOpen: boolean;
  profileSelectOpen: boolean;
};

type GlobalShortcutAction =
  | "create-chat"
  | "focus-composer"
  | "none"
  | "stop-stream";

type ResolveGlobalShortcutActionInput = ComposerFocusGuardInput & {
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  status: string;
};

type UseHomeClientGlobalUiEffectsInput = ComposerFocusGuardInput & {
  activeChatId: string;
  createChat: () => void;
  focusComposer: (opts?: { toEnd?: boolean }) => void;
  isTemporaryChat: boolean;
  messages: UIMessage<RemcoChatMessageMetadata>[];
  pinTranscriptToBottomIfFollowing: () => void;
  status: string;
  stop: () => void;
};

export function requestFocusComposer(opts?: { toEnd?: boolean }) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    const element = document.querySelector(
      '[data-testid="composer:textarea"]'
    ) as HTMLTextAreaElement | null;
    if (!element) return;
    element.focus();
    if (opts?.toEnd) {
      const length = element.value.length;
      element.setSelectionRange(length, length);
    }
  });
}

export function isComposerFocusBlocked(input: ComposerFocusGuardInput): boolean {
  return (
    input.createProfileOpen ||
    input.editOpen ||
    input.profileSettingsOpen ||
    input.chatSettingsOpen ||
    input.memorizeOpen ||
    input.profileSelectOpen
  );
}

export function shouldPinTranscriptDuringStreaming(status: string): boolean {
  return status === "submitted" || status === "streaming";
}

export function resolveGlobalShortcutAction(
  input: ResolveGlobalShortcutActionInput
): GlobalShortcutAction {
  if (input.defaultPrevented) return "none";
  if (isComposerFocusBlocked(input)) return "none";

  if (input.key === "Escape") {
    return input.status === "submitted" || input.status === "streaming"
      ? "stop-stream"
      : "none";
  }

  const key = input.key.toLowerCase();

  if ((input.metaKey || input.ctrlKey) && input.shiftKey && key === "n") {
    return "create-chat";
  }

  if ((input.metaKey || input.ctrlKey) && (key === "/" || key === "?")) {
    return "focus-composer";
  }

  return "none";
}

export function useHomeClientTranscriptScroll() {
  const stickToBottomContextRef = useRef<StickToBottomContext | null>(null);

  const scrollTranscriptToBottom = useCallback(
    (animation: "instant" | "smooth" = "instant") => {
      const context = stickToBottomContextRef.current;
      if (!context) return;
      void context.scrollToBottom(animation);
    },
    []
  );

  const queueScrollTranscriptToBottom = useCallback(
    (animation: "instant" | "smooth" = "instant") => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollTranscriptToBottom(animation))
      );
    },
    [scrollTranscriptToBottom]
  );

  const pinTranscriptToBottomIfFollowing = useCallback(() => {
    const context = stickToBottomContextRef.current;
    if (!context) return;
    void context.scrollToBottom({
      animation: "instant",
      preserveScrollPosition: true,
    });
  }, []);

  return {
    pinTranscriptToBottomIfFollowing,
    queueScrollTranscriptToBottom,
    scrollTranscriptToBottom,
    stickToBottomContextRef,
  };
}

export function useHomeClientGlobalUiEffects({
  activeChatId,
  chatSettingsOpen,
  createChat,
  createProfileOpen,
  editOpen,
  focusComposer,
  isTemporaryChat,
  memorizeOpen,
  messages,
  pinTranscriptToBottomIfFollowing,
  profileSettingsOpen,
  profileSelectOpen,
  status,
  stop,
}: UseHomeClientGlobalUiEffectsInput) {
  useEffect(() => {
    if (!shouldPinTranscriptDuringStreaming(status)) return;

    let firstRaf = 0;
    let secondRaf = 0;

    pinTranscriptToBottomIfFollowing();
    firstRaf = requestAnimationFrame(() => {
      pinTranscriptToBottomIfFollowing();
      secondRaf = requestAnimationFrame(() => {
        pinTranscriptToBottomIfFollowing();
      });
    });

    return () => {
      if (firstRaf) cancelAnimationFrame(firstRaf);
      if (secondRaf) cancelAnimationFrame(secondRaf);
    };
  }, [messages, pinTranscriptToBottomIfFollowing, status]);

  useEffect(() => {
    if (status !== "ready") return;
    if (
      isComposerFocusBlocked({
        chatSettingsOpen,
        createProfileOpen,
        editOpen,
        memorizeOpen,
        profileSettingsOpen,
        profileSelectOpen,
      })
    ) {
      return;
    }
    focusComposer({ toEnd: true });
  }, [
    activeChatId,
    chatSettingsOpen,
    createProfileOpen,
    editOpen,
    focusComposer,
    isTemporaryChat,
    memorizeOpen,
    profileSettingsOpen,
    profileSelectOpen,
    status,
  ]);

  useEffect(() => {
    const onFocusRequested = () => {
      if (status !== "ready") return;
      if (
        isComposerFocusBlocked({
          chatSettingsOpen,
          createProfileOpen,
          editOpen,
          memorizeOpen,
          profileSettingsOpen,
          profileSelectOpen,
        })
      ) {
        return;
      }
      focusComposer({ toEnd: true });
    };

    window.addEventListener("remcochat:focus-composer", onFocusRequested);
    return () => {
      window.removeEventListener("remcochat:focus-composer", onFocusRequested);
    };
  }, [
    chatSettingsOpen,
    createProfileOpen,
    editOpen,
    focusComposer,
    memorizeOpen,
    profileSettingsOpen,
    profileSelectOpen,
    status,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveGlobalShortcutAction({
        chatSettingsOpen,
        createProfileOpen,
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
        editOpen,
        key: event.key,
        memorizeOpen,
        metaKey: event.metaKey,
        profileSettingsOpen,
        profileSelectOpen,
        shiftKey: event.shiftKey,
        status,
      });

      if (action === "none") return;

      event.preventDefault();

      if (action === "stop-stream") {
        stop();
        return;
      }

      if (action === "create-chat") {
        createChat();
        return;
      }

      focusComposer({ toEnd: true });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    chatSettingsOpen,
    createChat,
    createProfileOpen,
    editOpen,
    focusComposer,
    memorizeOpen,
    profileSettingsOpen,
    profileSelectOpen,
    status,
    stop,
  ]);
}
