// Minimal className joiner — keeps conditional Tailwind classes readable
// without pulling in a dependency. Falsy entries are dropped.
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
