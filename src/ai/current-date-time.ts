export type CurrentDateTimeToolOutput = {
  nowUtcISO: string;
  zone: {
    label: string;
    timeZone: string;
    offset: string;
  };
  local: {
    dateISO: string;
    time24: string;
    dateTimeISO: string;
    dateLabel: string;
  };
};

