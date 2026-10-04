export function buildPronunciationBehaviorScript(): string {
  return `  try {
    const audioPayloadNode = document.getElementById('esl-pronunciation-audio');
    let pronunciationAudio = null;
    if (audioPayloadNode instanceof HTMLScriptElement && audioPayloadNode.textContent) {
      try {
        pronunciationAudio = JSON.parse(audioPayloadNode.textContent);
      } catch {
        pronunciationAudio = null;
      }
    }
    if (document.querySelector('[data-assignment-pronunciation]')) {
      const clips = Array.isArray(pronunciationAudio?.itemClips) ? pronunciationAudio.itemClips : [];
      document.querySelectorAll('[data-pronunciation-clip]').forEach(button => {
        const clip = clips.find(c => c.id === button.dataset.pronunciationClip);
        if (!clip?.url || button.disabled) return;
        button.addEventListener('click', () => { void new Audio(clip.url).play().catch(() => {}); });
      });
    }
  } catch {}
`;
}
