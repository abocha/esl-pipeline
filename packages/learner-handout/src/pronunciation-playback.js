// Shared by the Vite fixture and saved documents. No hydration or React event handlers.
(() => {
  let currentAudio;
  let currentButton;
  const state = (button, label) => {
    button.textContent = label;
    button.setAttribute('aria-label', `${label} pronunciation for ${button.dataset.clipText}`);
  };
  document.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element ? event.target.closest('button[data-audio-url]') : null;
    if (!button || button.disabled) return;
    currentAudio?.pause();
    if (currentButton) state(currentButton, currentButton.dataset.playLabel ?? 'Play');
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
