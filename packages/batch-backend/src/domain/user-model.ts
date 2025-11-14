// packages/batch-backend/src/domain/user-model.ts

// User domain model for the batch-backend authentication system.
// Mirrors the `users` table schema used in database operations.

export type UserRole = 'admin' | 'user' | 'viewer';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
}

// UserRegistration.declaration()
export interface UserRegistration {
  email: string;
  password: string;
  role?: UserRole;
}

// UserLogin.declaration()
export interface UserLogin {
  email: string;
  password: string;
}

// UserUpdate.declaration()
export interface UserUpdate {
  email?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
}

// isValidRole.declaration()
export function isValidRole(role: string): role is UserRole {
  return ['admin', 'user', 'viewer'].includes(role);
}

// sanitizeUser.declaration()
export function sanitizeUser(user: UserRecord): Omit<UserRecord, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...sanitized } = user;
  return sanitized;
}

// validateUserData.declaration()
export function validateUserData(user: Partial<UserRecord>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!user.email) {
    errors.push('Email is required');
  } else if (!isValidEmail(user.email)) {
    errors.push('Email format is invalid');
  }

  if (!user.passwordHash && !user.id) {
    errors.push('Password hash is required for new users');
  }

  if (user.role && !isValidRole(user.role)) {
    errors.push('Invalid user role');
  }

  if (user.isActive !== undefined && typeof user.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// isValidEmail.declaration()
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// generateResetToken.declaration()
export function generateResetToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
