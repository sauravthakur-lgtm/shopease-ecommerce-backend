import {
  getProductCategoryAliases,
  normalizeProductCategory,
} from './product-category';

describe('product categories', () => {
  it.each([
    [' electronics ', 'Electronics'],
    ['ELECTRONIC', 'Electronics'],
    ['clothing', 'Clothes'],
    ['APPAREL', 'Clothes'],
    ['home and kitchen', 'Home & Kitchen'],
  ])('normalizes %s to %s', (category, expected) => {
    expect(normalizeProductCategory(category)).toBe(expected);
  });

  it('returns legacy aliases so categories remain searchable after normalization', () => {
    expect(getProductCategoryAliases('Electronics')).toEqual([
      'Electronic',
      'Electronics',
    ]);
    expect(getProductCategoryAliases('Clothes')).toContain('Clothing');
  });
});
