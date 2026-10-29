import type { Category } from '@prisma/client';
import type { CategoryDto } from '@smart-finance/shared-types';

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    type: category.type,
    isSystem: category.isSystem,
    isArchived: category.isArchived,
  };
}
