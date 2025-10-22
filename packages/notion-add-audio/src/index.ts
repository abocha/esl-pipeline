export type AddAudioOptions = {
  replace?: boolean;
  target?: 'study-text';
};

export async function addAudioUnderStudyText(
  pageId: string,
  url: string,
  opts: AddAudioOptions = {}
): Promise<{ replaced: boolean; appended: boolean }> {
  if (!pageId.trim()) throw new Error('pageId is required');
  if (!url.trim()) throw new Error('url is required');

  return {
    replaced: Boolean(opts.replace),
    appended: !opts.replace
  };
}
