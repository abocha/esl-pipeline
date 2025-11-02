import type { AssignmentManifest, ManifestStore } from '../../manifest.js';

export type S3ManifestStoreOptions = {
  bucket: string;
  prefix?: string;
  region?: string;
};

export class S3ManifestStore implements ManifestStore {
  constructor(private readonly options: S3ManifestStoreOptions) {}

  manifestPathFor(mdPath: string): string {
    void mdPath;
    throw new Error('S3ManifestStore.manifestPathFor not implemented yet');
  }

  async writeManifest(mdPath: string, manifest: AssignmentManifest): Promise<string> {
    void mdPath;
    void manifest;
    throw new Error('S3ManifestStore.writeManifest not implemented yet');
  }

  async readManifest(mdPath: string): Promise<AssignmentManifest | null> {
    void mdPath;
    throw new Error('S3ManifestStore.readManifest not implemented yet');
  }
}
