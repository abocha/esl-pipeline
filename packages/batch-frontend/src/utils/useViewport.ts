import { useEffect, useState } from 'react';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const getViewport = (): Viewport => {
  if (globalThis.window === undefined) return 'desktop';
  const width = globalThis.window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1200) return 'tablet';
  return 'desktop';
};

export const useViewport = (): Viewport => {
  const [viewport, setViewport] = useState<Viewport>(getViewport);

  useEffect(() => {
    const handleResize = () => setViewport(getViewport());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return viewport;
};
