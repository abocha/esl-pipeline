export type ContractVersionKey = 'api' | 'manifest' | 'prompt' | 'validator' | 'db';
export type ContractBumpLevel = 'major' | 'minor' | 'patch';

export interface ContractVersionRegistry {
  api: string;
  manifest: string;
  prompt: string;
  validator: string;
  db: string;
}

export const API_CONTRACT_VERSION = '4.1.0';
export const MANIFEST_CONTRACT_VERSION = '3.2.0';
export const PROMPT_SCHEMA_VERSION = '2.2.0';
export const VALIDATOR_CONTRACT_VERSION = '2.1.0';
export const DB_CONTRACT_VERSION = '0.23.1';
export const DB_MIGRATION_HEAD = '0045_student_memory_snapshot_eligibility_repair';

export const CONTRACT_VERSIONS: Readonly<ContractVersionRegistry> = Object.freeze({
  api: API_CONTRACT_VERSION,
  manifest: MANIFEST_CONTRACT_VERSION,
  prompt: PROMPT_SCHEMA_VERSION,
  validator: VALIDATOR_CONTRACT_VERSION,
  db: DB_CONTRACT_VERSION,
});
