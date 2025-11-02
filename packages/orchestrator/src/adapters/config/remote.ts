import type { ConfigProvider, PresetMap, StudentProfile } from '../../config.js';

export type RemoteConfigProviderOptions = {
  endpoint: string;
  token?: string;
};

export class RemoteConfigProvider implements ConfigProvider {
  constructor(private readonly options: RemoteConfigProviderOptions) {}

  async loadPresets(_presetsPath?: string): Promise<PresetMap> {
    throw new Error('RemoteConfigProvider.loadPresets not implemented yet');
  }

  async loadStudentProfiles(_studentsDir?: string): Promise<StudentProfile[]> {
    throw new Error('RemoteConfigProvider.loadStudentProfiles not implemented yet');
  }

  async resolveVoicesPath(_voicesPath?: string, _fallback?: string): Promise<string | undefined> {
    throw new Error('RemoteConfigProvider.resolveVoicesPath not implemented yet');
  }
}
