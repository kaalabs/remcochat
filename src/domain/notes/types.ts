export type QuickNote = {
  id: string;
  profileId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type NotesToolOutput = {
  notes: QuickNote[];
  totalCount: number;
  limit: number;
};
