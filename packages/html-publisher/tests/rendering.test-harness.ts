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
  document.write(html);
  document.close();

  const browserWindow = globalThis as Window & typeof globalThis;

  Object.defineProperty(browserWindow, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [],
      cancel: () => {},
      speak: () => {},
    },
  });
  Object.defineProperty(browserWindow, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: function SpeechSynthesisUtterance(this: { text: string; lang: string }, text: string) {
      this.text = text;
      this.lang = 'en-US';
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
