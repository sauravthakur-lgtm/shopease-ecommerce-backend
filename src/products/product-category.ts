const canonicalCategories = new Map<string, string>([
  ['clothes', 'Clothes'],
  ['cloth', 'Clothes'],
  ['clothing', 'Clothes'],
  ['apparel', 'Clothes'],
  ['electronic', 'Electronics'],
  ['electronics', 'Electronics'],
  ['home & kitchen', 'Home & Kitchen'],
  ['home and kitchen', 'Home & Kitchen'],
  ['home-kitchen', 'Home & Kitchen'],
  ['beauty & personal care', 'Beauty & Personal Care'],
  ['beauty and personal care', 'Beauty & Personal Care'],
  ['sports & outdoors', 'Sports & Outdoors'],
  ['sports and outdoors', 'Sports & Outdoors'],
]);

const categoryAliases = new Map<string, string[]>([
  ['Clothes', ['Clothes', 'Cloth', 'Clothing', 'Apparel']],
  ['Electronics', ['Electronic', 'Electronics']],
  ['Home & Kitchen', ['Home & Kitchen', 'Home and Kitchen', 'Home-Kitchen']],
  [
    'Beauty & Personal Care',
    ['Beauty & Personal Care', 'Beauty and Personal Care'],
  ],
  ['Sports & Outdoors', ['Sports & Outdoors', 'Sports and Outdoors']],
]);

export function normalizeProductCategory(category: string): string {
  const trimmedCategory = category.trim();
  const canonical =
    canonicalCategories.get(trimmedCategory.toLocaleLowerCase('en'));

  if (canonical) return canonical;

  return trimmedCategory
    .split(/\s+/)
    .map((word) => word.charAt(0).toLocaleUpperCase('en') + word.slice(1))
    .join(' ');
}

export function getProductCategoryAliases(category: string): string[] {
  const canonical = normalizeProductCategory(category);
  return categoryAliases.get(canonical) ?? [canonical];
}
