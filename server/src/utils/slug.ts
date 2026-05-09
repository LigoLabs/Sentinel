// Diacritic range U+0300..U+036F (combining marks) — stripped after NFKD.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
