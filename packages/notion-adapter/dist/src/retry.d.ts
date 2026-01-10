export declare function withRetry<T>(fn: () => Promise<T>, label: string, tries?: number): Promise<T>;
