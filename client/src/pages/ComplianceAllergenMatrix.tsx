/**
 * ComplianceAllergenMatrix
 * 
 * The allergens matrix is built into the Recipe Book page (RecipeBook.tsx),
 * which includes per-product allergen detection, FSANZ allergen labels, and
 * ingredient-level allergen breakdowns. This page renders that component directly.
 *
 * The old route /recipe-book is preserved for backwards compatibility.
 * The compliance route /compliance/allergens-matrix also renders this page.
 */
import RecipeBook from "./RecipeBook";

export default function ComplianceAllergenMatrix() {
  return <RecipeBook />;
}
