import { Socket } from 'node:net';

function requireLoopback(host) {
  const normalized = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  )
    return;
  // Deliberately omit the URL/path: a failed test must not print credentials or request content.
  throw new Error('External network access is disabled in provider/orchestrator unit tests');
}

export function blockExternalConnections() {
  const connect = Socket.prototype.connect;
  const fetch = globalThis.fetch;
  Socket.prototype.connect = function (...args) {
    // Node also passes its normalized [options, callback] tuple to Socket.connect.
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host =
      typeof options === 'object'
        ? options.host
        : typeof args[1] === 'string'
          ? args[1]
          : 'localhost';
    requireLoopback(host ?? 'localhost');
    if (options?.path || (typeof options === 'string' && !/^\d+$/u.test(options))) {
      throw new Error('Socket paths are disabled in provider/orchestrator unit tests');
    }
    return Reflect.apply(connect, this, args);
  };
  // Fetch can reuse pooled sockets; reject before dispatch even when no new socket is opened.
  globalThis.fetch = async (input, init) => {
    requireLoopback(
      new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname,
    );
    return fetch(input, init);
  };
  return () => {
    Socket.prototype.connect = connect;
    globalThis.fetch = fetch;
  };
}
