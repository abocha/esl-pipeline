import type { Client } from '@notionhq/client';
export interface AddAudioOpts {
    replace?: boolean;
    target?: 'study-text';
    client?: Client;
}
export declare function getClient(): Client;
export declare function addOrReplaceAudioUnderStudyText(pageId: string, url: string, opts?: AddAudioOpts): Promise<{
    replaced: boolean;
    appended: boolean;
}>;
