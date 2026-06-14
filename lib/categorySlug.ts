/**
 * lib/categorySlug.ts
 * Shared slug helpers for the QNE-mirrored category tree.
 *
 * Tree structure: parent = QNE stock `category`, child = QNE stock `group`.
 * Child slugs are namespaced under the parent (`parent--child`) so that the
 * same group name under two different categories never collides.
 */

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unnamed'
}

/** Slug for a top-level category mirrored from QNE `category`. */
export function qneParentSlug(qneCategory: string): string {
  return slugify(qneCategory)
}

/** Slug for a subcategory mirrored from QNE `category` > `group`. */
export function qneChildSlug(qneCategory: string, qneGroup: string): string {
  return `${slugify(qneCategory)}--${slugify(qneGroup)}`
}
