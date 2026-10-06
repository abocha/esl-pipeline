// Shared by the Vite fixture and saved documents. No hydration or React event handlers.
(() => {
  let currentAudio;
  let currentButton;
  const state = (button, label) => {
    button.querySelector('.clip-status').textContent = label;
    button.parentElement.querySelector('.clip-error').hidden = label !== 'Retry';
    button.dataset.playbackState = {
      Play: 'play',
      'Playing…': 'playing',
      Replay: 'replay',
      Retry: 'retry',
    }[label];
    const name = `${label} pronunciation for ${button.dataset.clipText}`;
    button.setAttribute('aria-label', name);
    button.title = name;
  };
  document.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest('button[data-pronunciation-clip][data-audio-url]')
        : null;
    if (!button || button.disabled) return;
    currentAudio?.pause();
    if (currentButton) state(currentButton, 'Play');
    const audio = new Audio(button.dataset.audioUrl);
    currentAudio = audio;
    currentButton = button;
    state(button, 'Playing…');
    const finish = (label) => {
      if (currentAudio === audio) state(button, label);
    };
    audio.addEventListener('ended', () => finish('Replay'));
    audio.addEventListener('error', () => finish('Retry'));
    void audio.play().catch(() => finish('Retry'));
  });
})();
