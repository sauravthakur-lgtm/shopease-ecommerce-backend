export type UserRole = 'ADMIN' | 'VENDOR' | 'CUSTOMER';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
}
