import type { User } from '@prisma/client';
import type { UserDto } from '@smart-finance/shared-types';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    defaultCurrency: user.defaultCurrency,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}
