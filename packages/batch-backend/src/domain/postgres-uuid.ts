import { z } from 'zod';

// PostgreSQL UUID identities (including 0059's MD5-derived revision IDs) do not
// require RFC version/variant bits. Accept only the canonical textual shape.
export const postgresUuidSchema = z
  .string()
  .length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
