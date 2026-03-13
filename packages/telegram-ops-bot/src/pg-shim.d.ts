declare module 'pg' {
  export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
    rowCount?: number;
  }

  export interface ClientConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionTimeoutMillis?: number;
  }

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }

  export class Pool {
    constructor(config?: ClientConfig);
    query<T = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
}
