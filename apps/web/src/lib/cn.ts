/** Joins class names, dropping falsy entries. Shared by the UI primitives. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
