import { z } from "zod";

const ALLOWED_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "gray_background",
  "brown_background",
  "orange_background",
  "yellow_background",
  "green_background",
  "blue_background",
  "purple_background",
  "pink_background",
  "red_background"
] as const;

export const ColorName = z.enum(ALLOWED_COLORS);

export const PresetSchema = z.object({
  h2: ColorName.optional(),
  h3: ColorName.optional(),
  toggleMap: z.object({
    h2: ColorName.optional()
  }).optional()
});

export type ColorPreset = z.infer<typeof PresetSchema>;
export type PresetsFile = Record<string, ColorPreset>;