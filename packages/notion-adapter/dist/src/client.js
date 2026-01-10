import { Client } from '@notionhq/client';
import { ConfigurationError } from '@esl-pipeline/contracts';
export function createNotionClient() {
    const token = process.env.NOTION_TOKEN;
    if (!token)
        throw new ConfigurationError('NOTION_TOKEN is required in environment');
    const timeoutRaw = process.env.NOTION_CLIENT_TIMEOUT;
    const timeoutMs = timeoutRaw && Number.isFinite(Number(timeoutRaw)) && Number(timeoutRaw) > 0
        ? Math.floor(Number(timeoutRaw))
        : undefined;
    return new Client({ auth: token, notionVersion: '2025-09-03', timeoutMs });
}
//# sourceMappingURL=client.js.map