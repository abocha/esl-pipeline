export function formatCurrentDateForAssertion(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

export function extractBehaviorScript(html: string): string {
  const scriptMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);
  if (!scriptMatch?.[1]) {
    throw new Error('Expected embedded behavior script');
  }
  return scriptMatch[1];
}

export function createRenderedDocument(html: string): Document {
  const scriptText = extractBehaviorScript(html);

  document.open();
  // Install browser mocks before executing the script exactly once.
  document.write(html.replace(`<script>\n${scriptText}</script>`, ''));
  document.close();

  const browserWindow = globalThis as Window & typeof globalThis;

  Object.defineProperty(browserWindow, 'Audio', {
    configurable: true,
    value: function Audio(this: { src: string; play: () => Promise<void> }, src: string) {
      this.src = src;
      this.play = async () => {};
    },
  });
  Object.defineProperty(browserWindow, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  Object.defineProperty(browserWindow, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => callback(0),
  });
  Object.defineProperty(browserWindow, 'cancelAnimationFrame', {
    configurable: true,
    value: () => {},
  });

  browserWindow.eval(scriptText);
  return document;
}
