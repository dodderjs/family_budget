import { CategoryNode } from '../services/transactionService';

export interface CategoryGroup {
  parentKey: string;
  parentLabel: string;
  leafKeys: string[];
}

/** Groups leaf categories under their main (group) category. Categories with
 * no resolvable parent land under a synthetic "other" bucket rather than
 * being dropped, since a stale parent_id shouldn't silently hide a leaf from
 * both the toolbar's grouping and the dashboard's drill-down. */
export function buildCategoryGroups(categories: CategoryNode[]): CategoryGroup[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const groups = new Map<string, CategoryGroup>();

  categories
    .filter((category) => category.parent_id)
    .forEach((leaf) => {
      const parent = byId.get(leaf.parent_id as string);
      const parentKey = parent?.key || 'other';
      const parentLabel = parent?.label || 'Other';
      if (!groups.has(parentKey)) groups.set(parentKey, { parentKey, parentLabel, leafKeys: [] });
      groups.get(parentKey)!.leafKeys.push(leaf.key);
    });

  return [...groups.values()].sort((a, b) => a.parentLabel.localeCompare(b.parentLabel));
}

/** Display label for a main category's key - used when a parent-level chart
 * value (already a key, see _build_parent_category_lookup) needs a label. */
export function mainCategoryLabel(categories: CategoryNode[], parentKey: string): string {
  const main = categories.find((category) => !category.parent_id && category.key === parentKey);
  return main?.label || parentKey;
}
