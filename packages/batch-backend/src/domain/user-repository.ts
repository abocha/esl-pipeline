// packages/batch-backend/src/domain/user-repository.ts
// PostgreSQL-backed repository for UserRecord.
// - Uses withPgClient() from infrastructure/db.
// - All queries parameterized.
// - Follows same patterns as job-repository.ts
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { UserRecord, UserRole } from './user-model.js';

/**
 * PostgreSQL row structure for users table
 */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

// createUser.declaration()
export async function createUser(params: {
  email: string;
  passwordHash: string;
  role?: UserRole;
  isActive?: boolean;
}): Promise<UserRecord> {
  const id = randomUUID();
  const now = new Date();
  const role = params.role || 'user';
  const isActive = params.isActive === undefined ? true : params.isActive;

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      RETURNING id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      `,
      [id, params.email, params.passwordHash, role, isActive, now],
    );
    return result.rows[0];
  });

  logger.info('User created', { userId: id, email: params.email, role });

  return mapRowToUser(row);
}

// getUserById.declaration()
export async function getUserById(id: string): Promise<UserRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      FROM users
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToUser(row) : null;
}

// getUserByEmail.declaration()
export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      FROM users
      WHERE email = $1
      `,
      [email.toLowerCase()],
    );
    return result.rows[0];
  });

  return row ? mapRowToUser(row) : null;
}

// updateUser.declaration()
export async function updateUser(params: {
  id: string;
  email?: string;
  passwordHash?: string;
  role?: UserRole;
  isActive?: boolean;
}): Promise<UserRecord | null> {
  const { id, ...updateFields } = params;

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const values: (string | boolean)[] = [];
  let paramIndex = 1;

  if (updateFields.email) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(updateFields.email.toLowerCase());
  }

  if (updateFields.passwordHash) {
    setClauses.push(`password_hash = $${paramIndex++}`);
    values.push(updateFields.passwordHash);
  }

  if (updateFields.role) {
    setClauses.push(`role = $${paramIndex++}`);
    values.push(updateFields.role);
  }

  if (updateFields.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    values.push(updateFields.isActive);
  }

  setClauses.push(`updated_at = NOW()`);

  if (setClauses.length === 1) {
    // Only updated_at
    throw new Error('No fields to update');
  }

  values.push(id);

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE users
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      `,
      values,
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('No user row updated (user not found)', { userId: id });
    return null;
  }

  logger.info('User updated', { userId: id, updatedFields: Object.keys(updateFields) });
  return mapRowToUser(row);
}

// updateUserLastLogin.declaration()
export async function updateUserLastLogin(userId: string): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      UPDATE users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [userId],
    );
  });

  logger.debug('User last login updated', { userId });
}

// deleteUser.declaration()
export async function deleteUser(userId: string): Promise<boolean> {
  const result = await withPgClient(async (client: PoolClient) => {
    const queryResult = await client.query(
      `
      DELETE FROM users
      WHERE id = $1
      RETURNING id
      `,
      [userId],
    );
    return queryResult;
  });

  const deleted = result.rows.length > 0;

  if (deleted) {
    logger.info('User deleted', { userId });
  } else {
    logger.warn('User not found for deletion', { userId });
  }

  return deleted;
}

// activateUser.declaration()
export async function activateUser(userId: string): Promise<UserRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE users
      SET is_active = true, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      `,
      [userId],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('User not found for activation', { userId });
    return null;
  }

  logger.info('User activated', { userId });
  return mapRowToUser(row);
}

// deactivateUser.declaration()
export async function deactivateUser(userId: string): Promise<UserRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE users
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      `,
      [userId],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('User not found for deactivation', { userId });
    return null;
  }

  logger.info('User deactivated', { userId });
  return mapRowToUser(row);
}

// getAllUsers.declaration()
export async function getAllUsers(limit = 100, offset = 0): Promise<UserRecord[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
      FROM users
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset],
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToUser(row));
}

// countUsers.declaration()
export async function countUsers(): Promise<number> {
  const result = await withPgClient(async (client: PoolClient) => {
    const queryResult = await client.query('SELECT COUNT(*) as count FROM users');
    return queryResult;
  });

  return Number.parseInt(result.rows[0].count, 10);
}

function mapRowToUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}
