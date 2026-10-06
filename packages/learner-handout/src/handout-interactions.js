// Same delegated behavior in React Preview, Vite and unhydrated standalone documents.
(() => {
  const disclosures = new WeakMap();
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const reveal = target?.closest('button[data-grammar-reveal]');
    if (reveal) {
      const content = reveal.parentElement.querySelector('.reveal-content');
      content.removeAttribute('aria-hidden');
      content.classList.add('is-revealed');
      if (document.activeElement === reveal) {
        content.tabIndex = -1;
        content.focus();
      }
      reveal.hidden = true;
      return;
    }
    const summary = target?.closest('details[data-handout-disclosure] > summary');
    if (!summary) return;
    const details = summary.parentElement;
    const content = details.querySelector('.disclosure-content');
    const previous = disclosures.get(details);
    const opening = previous ? !previous.opening : !details.open;
    // Native details remains the no-animation/reduced-motion fallback.
    if (!content.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (previous) {
        previous.animation.cancel();
        disclosures.delete(details);
        content.style.overflow = '';
        details.open = previous.opening;
      }
      return;
    }
    event.preventDefault();
    const from = details.open ? content.getBoundingClientRect().height : 0;
    previous?.animation.cancel();
    details.open = true;
    content.style.overflow = 'hidden';
    const animation = content.animate(
      [{ height: `${from}px` }, { height: `${opening ? content.scrollHeight : 0}px` }],
      { duration: 180, easing: 'ease-out' },
    );
    const current = { opening, animation };
    disclosures.set(details, current);
    animation.onfinish = () => {
      if (disclosures.get(details) !== current) return;
      if (!opening && content.contains(document.activeElement)) summary.focus();
      details.open = opening;
      content.style.overflow = '';
      disclosures.delete(details);
    };
  });
})();
