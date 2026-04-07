export type AgendaItem = {
  id: string;
  profileId: string;
  description: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  timezone: string;
  ownerProfileId: string;
  ownerProfileName?: string;
  scope: "owned" | "shared";
  sharedWithCount: number;
  localDate: string;
  localTime: string;
  viewerLocalDate: string;
  viewerLocalTime: string;
};

export type AgendaToolOutput =
  | {
      ok: true;
      action: "create" | "update" | "delete" | "share" | "unshare";
      message: string;
      item?: AgendaItem;
      items?: AgendaItem[];
    }
  | {
      ok: true;
      action: "list";
      rangeLabel: string;
      timezone: string;
      items: AgendaItem[];
    }
  | {
      ok: false;
      error: string;
      candidates?: AgendaItem[];
    };
