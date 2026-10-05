// Shared by the Vite fixture and saved documents. No hydration or React event handlers.
(() => {
  let currentAudio;
  document.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element ? event.target.closest('button[data-audio-url]') : null;
    if (!button || button.disabled) return;
    const status = button
      .closest('[data-assignment-pronunciation]')
      ?.querySelector('.playback-status');
    currentAudio?.pause();
    const audio = new Audio(button.dataset.audioUrl);
    currentAudio = audio;
    if (status)
      status.textContent = `Playing: ${button.getAttribute('aria-label')?.replace('Play pronunciation for ', '')}`;
    const finish = (message) => {
      if (currentAudio === audio && status) status.textContent = message;
    };
    audio.addEventListener('ended', () => finish('Playback finished.'));
    audio.addEventListener('error', () => finish('Audio unavailable. Try again.'));
    void audio.play().catch(() => finish('Audio unavailable. Try again.'));
  });
})();
