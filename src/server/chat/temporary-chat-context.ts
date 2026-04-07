export function prepareTemporaryPromptContext(input: {
  profileCustomInstructions?: string | null;
  profileInstructionsRevision: number;
  temporarySessionId?: string | null;
}) {
  const profileInstructions = (input.profileCustomInstructions ?? "").trim();
  const temporarySessionId = String(input.temporarySessionId ?? "").trim();

  return {
    temporarySessionId,
    sessionKey: temporarySessionId ? `tmp:${temporarySessionId}` : "",
    prompt: {
      isTemporary: true,
      profileInstructions,
      profileInstructionsRevision: input.profileInstructionsRevision,
      chatInstructions: "",
      systemChatInstructionsRevision: 1,
      headerChatInstructionsRevision: 0,
      memoryEnabled: false,
      memoryLines: [] as string[],
      activatedSkillNames: [] as string[],
    },
  };
}
