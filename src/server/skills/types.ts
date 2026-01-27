export type SkillFrontmatter = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  ["allowed-tools"]?: string;
};

export type SkillRecord = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  skillDir: string;
  skillMdPath: string;
  sourceDir: string;
};

export type SkillCollision = {
  name: string;
  winner: SkillRecord;
  losers: SkillRecord[];
};

export type SkillsRegistrySnapshot = {
  enabled: boolean;
  scannedAt: number;
  scanRoots: string[];
  skills: SkillRecord[];
  invalid: { skillDir: string; skillMdPath: string; error: string }[];
  collisions: SkillCollision[];
  warnings: string[];
};

export type SkillsRegistry = {
  snapshot(): SkillsRegistrySnapshot;
  get(name: string): SkillRecord | null;
  list(): { name: string; description: string }[];
};

