import { z } from "zod";

// Canonical OV NLU result. This is intentionally small and stable:
// it describes *what* the user asked for (slots + constraints), not tool args.

export const OvIntentKindSchema = z.enum([
  "stations.search",
  "stations.nearest",
  "departures.list",
  "departures.window",
  "arrivals.list",
  "trips.search",
  "trips.detail",
  "journey.detail",
  "disruptions.list",
  "disruptions.by_station",
  "disruptions.detail",
]);

export const OvQueryV1Schema = z
  .object({
    version: z.literal(1),
    intentKind: OvIntentKindSchema,
    confidence: z.number().min(0).max(1),
    isFollowUp: z.boolean().default(false),
    slots: z
      .object({
        // Common station-like slots.
        stationText: z.string().optional(),
        fromText: z.string().optional(),
        toText: z.string().optional(),
        viaText: z.string().optional(),

        // Board window slots.
        date: z.string().optional(),
        fromTime: z.string().optional(),
        toTime: z.string().optional(),

        // Trips detail slots.
        ctxRecon: z.string().optional(),

        // Journey detail slots.
        journeyId: z.string().optional(),
        train: z.number().int().optional(),

        // High-level time hint for trips.search.
        dateTimeHint: z.string().optional(),
      })
      .strict(),
    requested: z
      .object({
        // Keep constraints generic; planner is responsible for allowlisting per action.
        hard: z.record(z.string(), z.unknown()).optional(),
        soft: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .default({}),
    missing: z.array(z.string()).default([]),
    clarification: z.string().default(""),
  })
  .strict();

export type OvQueryV1 = z.infer<typeof OvQueryV1Schema>;

