import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const root = new URL('../../../out/learner-handout/', import.meta.url);
createServer(async (request, response) => {
  const filename = request.url === '/' ? 'shadow_sentence-mixed.html' : request.url?.slice(1);
  if (
    !filename ||
    !/^(?:[a-z_]+-(?:available|mixed|unavailable)\.html|fixture-tone\.wav|grammar\.html|polish(?:-(?:emoji|icons))?\.html)$/.test(
      filename,
    )
  ) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(new URL(filename, root));
    response
      .writeHead(200, {
        'Content-Type': filename.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8',
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(5175, '127.0.0.1', () => console.log('Static fixture server: http://127.0.0.1:5175'));
