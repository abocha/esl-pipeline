import type { ImportOptions } from './types.js';
export declare function runImport(opts: ImportOptions): Promise<{
    dataSourceId: string;
    propertiesPreview: Record<string, {
        title: Array<{
            annotations?: {
                bold?: boolean;
                italic?: boolean;
                strikethrough?: boolean;
                underline?: boolean;
                code?: boolean;
                color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red" | "default_background" | "gray_background" | "brown_background" | "orange_background" | "yellow_background" | "green_background" | "blue_background" | "purple_background" | "pink_background" | "red_background";
            };
        } & ({
            type?: "text";
            text: {
                content: string;
                link?: {
                    url: string;
                } | null;
            };
        } | {
            type?: "mention";
            mention: {
                type?: "user";
                user: {
                    id: string;
                    object?: "user";
                };
            } | {
                type?: "date";
                date: {
                    start: string;
                    end?: string | null;
                    time_zone?: string | null;
                };
            } | {
                type?: "page";
                page: {
                    id: string;
                };
            } | {
                type?: "database";
                database: {
                    id: string;
                };
            } | {
                type?: "template_mention";
                template_mention: {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                } | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                };
            } | {
                type?: "custom_emoji";
                custom_emoji: {
                    id: string;
                    name?: string;
                    url?: string;
                };
            };
        } | {
            type?: "equation";
            equation: {
                expression: string;
            };
        })>;
        type?: "title";
    } | {
        rich_text: Array<{
            annotations?: {
                bold?: boolean;
                italic?: boolean;
                strikethrough?: boolean;
                underline?: boolean;
                code?: boolean;
                color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red" | "default_background" | "gray_background" | "brown_background" | "orange_background" | "yellow_background" | "green_background" | "blue_background" | "purple_background" | "pink_background" | "red_background";
            };
        } & ({
            type?: "text";
            text: {
                content: string;
                link?: {
                    url: string;
                } | null;
            };
        } | {
            type?: "mention";
            mention: {
                type?: "user";
                user: {
                    id: string;
                    object?: "user";
                };
            } | {
                type?: "date";
                date: {
                    start: string;
                    end?: string | null;
                    time_zone?: string | null;
                };
            } | {
                type?: "page";
                page: {
                    id: string;
                };
            } | {
                type?: "database";
                database: {
                    id: string;
                };
            } | {
                type?: "template_mention";
                template_mention: {
                    type?: "template_mention_date";
                    template_mention_date: "today" | "now";
                } | {
                    type?: "template_mention_user";
                    template_mention_user: "me";
                };
            } | {
                type?: "custom_emoji";
                custom_emoji: {
                    id: string;
                    name?: string;
                    url?: string;
                };
            };
        } | {
            type?: "equation";
            equation: {
                expression: string;
            };
        })>;
        type?: "rich_text";
    } | {
        number: number | null;
        type?: "number";
    } | {
        url: string | null;
        type?: "url";
    } | {
        select: {
            id: string;
            name?: string;
            color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
            description?: string | null;
        } | {
            name: string;
            id?: string;
            color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
            description?: string | null;
        } | null;
        type?: "select";
    } | {
        multi_select: Array<{
            id: string;
            name?: string;
            color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
            description?: string | null;
        } | {
            name: string;
            id?: string;
            color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
            description?: string | null;
        }>;
        type?: "multi_select";
    } | {
        people: Array<{
            id: string;
            object?: "user";
        } | {
            id: string;
            name?: string | null;
            object?: "group";
        }>;
        type?: "people";
    } | {
        email: string | null;
        type?: "email";
    } | {
        phone_number: string | null;
        type?: "phone_number";
    } | {
        date: {
            start: string;
            end?: string | null;
            time_zone?: string | null;
        } | null;
        type?: "date";
    } | {
        checkbox: boolean;
        type?: "checkbox";
    } | {
        relation: Array<{
            id: string;
        }>;
        type?: "relation";
    } | {
        files: Array<({
            file: {
                url: string;
                expiry_time?: string;
            };
            name: string;
            type?: "file";
        } | {
            external: {
                url: string;
            };
            name: string;
            type?: "external";
        }) | {
            file_upload: {
                id: string;
            };
            type?: "file_upload";
            name?: string;
        }>;
        type?: "files";
    } | {
        status: {
            id: string;
            name?: string;
            color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
            description?: string | null;
        } | {
            name: string;
            id?: string;
            color?: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
            description?: string | null;
        } | null;
        type?: "status";
    } | {
        place: {
            lat: number;
            lon: number;
            name?: string | null;
            address?: string | null;
            aws_place_id?: string | null;
            google_place_id?: string | null;
        } | null;
        type?: "place";
    }>;
    iconPreview: string | undefined;
    coverPreview: string | undefined;
    blocksPreview: any[];
    totalBlocks: number;
    studentLinked: boolean;
    page_id: undefined;
    url: undefined;
} | {
    page_id: string;
    url: string | undefined;
    studentLinked: boolean;
}>;
