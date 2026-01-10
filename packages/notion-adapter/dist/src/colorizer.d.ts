import { z } from 'zod';
export declare const PresetSchema: z.ZodObject<{
    h2: z.ZodOptional<z.ZodEnum<{
        default: "default";
        gray: "gray";
        brown: "brown";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        blue: "blue";
        purple: "purple";
        pink: "pink";
        red: "red";
        gray_background: "gray_background";
        brown_background: "brown_background";
        orange_background: "orange_background";
        yellow_background: "yellow_background";
        green_background: "green_background";
        blue_background: "blue_background";
        purple_background: "purple_background";
        pink_background: "pink_background";
        red_background: "red_background";
    }>>;
    h3: z.ZodOptional<z.ZodEnum<{
        default: "default";
        gray: "gray";
        brown: "brown";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        blue: "blue";
        purple: "purple";
        pink: "pink";
        red: "red";
        gray_background: "gray_background";
        brown_background: "brown_background";
        orange_background: "orange_background";
        yellow_background: "yellow_background";
        green_background: "green_background";
        blue_background: "blue_background";
        purple_background: "purple_background";
        pink_background: "pink_background";
        red_background: "red_background";
    }>>;
    toggleMap: z.ZodOptional<z.ZodObject<{
        h2: z.ZodOptional<z.ZodEnum<{
            default: "default";
            gray: "gray";
            brown: "brown";
            orange: "orange";
            yellow: "yellow";
            green: "green";
            blue: "blue";
            purple: "purple";
            pink: "pink";
            red: "red";
            gray_background: "gray_background";
            brown_background: "brown_background";
            orange_background: "orange_background";
            yellow_background: "yellow_background";
            green_background: "green_background";
            blue_background: "blue_background";
            purple_background: "purple_background";
            pink_background: "pink_background";
            red_background: "red_background";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ColorPreset = z.infer<typeof PresetSchema>;
export type PresetsFile = Record<string, ColorPreset>;
interface Counts {
    h2: number;
    h3: number;
    toggles: number;
}
export declare function loadPreset(presetName: string, presetsPath: string): Promise<ColorPreset>;
export declare function applyHeadingPreset(pageId: string, presetName: string, presetsPath?: string): Promise<{
    applied: boolean;
    counts: Counts;
}>;
export {};
