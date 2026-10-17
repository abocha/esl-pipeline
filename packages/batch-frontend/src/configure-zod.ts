import { config } from 'zod';

// Configure before importing application schemas: skip Zod's eval capability probe
// and use its interpreter under the frontend's strict Content Security Policy.
config({ jitless: true });
