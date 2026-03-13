import type {
  ApiMethods,
  ApiResponse,
  ChatFullInfo,
  ForumTopic,
  Message,
  Update,
  UserFromGetMe,
} from '@grammyjs/types';

type TelegramApi = ApiMethods<never>;
type TelegramMethod = keyof TelegramApi;
type MethodArgs<M extends TelegramMethod> =
  Parameters<TelegramApi[M]> extends [] ? undefined : Parameters<TelegramApi[M]>[0];
type MethodResult<M extends TelegramMethod> = ReturnType<TelegramApi[M]>;

export class TelegramApiError extends Error {
  readonly method: string;
  readonly statusCode: number;

  constructor(message: string, method: string, statusCode: number) {
    super(message);
    this.name = 'TelegramApiError';
    this.method = method;
    this.statusCode = statusCode;
  }
}

export interface TelegramClientOptions {
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class TelegramClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramClientOptions) {
    this.token = options.token;
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<M extends TelegramMethod>(method: M, args?: MethodArgs<M>): Promise<MethodResult<M>> {
    const url = `${this.apiBaseUrl}/bot${this.token}/${String(method)}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: args === undefined ? undefined : JSON.stringify(args),
    });

    const json = (await response.json()) as ApiResponse<MethodResult<M>>;
    if (!response.ok) {
      const description = 'description' in json ? json.description : response.statusText;
      throw new TelegramApiError(description, String(method), response.status);
    }

    if (!json.ok) {
      throw new TelegramApiError(json.description, String(method), json.error_code);
    }

    return json.result;
  }

  getUpdates(args?: MethodArgs<'getUpdates'>): Promise<Update[]> {
    return this.call('getUpdates', args);
  }

  getMe(): Promise<UserFromGetMe> {
    return this.call('getMe');
  }

  getChat(args: NonNullable<MethodArgs<'getChat'>>): Promise<ChatFullInfo> {
    return this.call('getChat', args);
  }

  createForumTopic(args: NonNullable<MethodArgs<'createForumTopic'>>): Promise<ForumTopic> {
    return this.call('createForumTopic', args);
  }

  setMyCommands(args: NonNullable<MethodArgs<'setMyCommands'>>): Promise<true> {
    return this.call('setMyCommands', args);
  }

  setMyDescription(args: NonNullable<MethodArgs<'setMyDescription'>>): Promise<true> {
    return this.call('setMyDescription', args);
  }

  setMyShortDescription(args: NonNullable<MethodArgs<'setMyShortDescription'>>): Promise<true> {
    return this.call('setMyShortDescription', args);
  }

  setChatMenuButton(args: NonNullable<MethodArgs<'setChatMenuButton'>>): Promise<true> {
    return this.call('setChatMenuButton', args);
  }

  async sendHtmlMessage(args: {
    chatId: string;
    html: string;
    threadId?: number;
    disableLinkPreview?: boolean;
  }): Promise<Message.TextMessage> {
    const disableLinkPreview = args.disableLinkPreview ?? true;
    const payload: NonNullable<MethodArgs<'sendMessage'>> = {
      chat_id: args.chatId,
      text: args.html,
      parse_mode: 'HTML',
      ...(args.threadId ? { message_thread_id: args.threadId } : {}),
      ...(disableLinkPreview
        ? {
            link_preview_options: {
              is_disabled: true,
            },
          }
        : {}),
    };
    return this.call('sendMessage', payload);
  }
}
