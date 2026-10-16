// Typical WA market seasons (when produce is local, plentiful and usually cheapest).
// A general guide only, used until the app has a year of our own invoice prices.
// Sources: LiveLighter WA seasonal fruit chart, Perth pick-your-own farm seasons,
// So Perth "now in season", plus general WA growing seasons.
const GUIDE: [RegExp, string][] = [
  [/strawberr/i, "Aug–Nov (Wanneroo, peaks in spring)"],
  [/watermelon|rock ?melon|honeydew|honey melon|gold honey/i, "Nov–Mar"],
  [/pineapple/i, "Oct–Feb"],
  [/kiwi/i, "May–Oct"],
  [/banana/i, "Year round (Carnarvon)"],
  [/avocado/i, "Sep–Mar (WA Hass)"],
  [/apple/i, "Mar–Jul (new season)"],
  [/grape/i, "Dec–Apr"],
  [/lemon/i, "May–Oct"],
  [/lime/i, "Feb–Jul"],
  [/orange|mandarin/i, "Jun–Oct (navels)"],
  [/rhubarb/i, "Year round, best Sep–Dec"],
  [/cherry tomato/i, "Nov–Apr"],
  [/tomato/i, "Dec–Apr"],
  [/pickling cucumber|cucumber/i, "Nov–Apr"],
  [/capsicum/i, "Dec–Apr"],
  [/eggplant/i, "Dec–Apr"],
  [/zucchini/i, "Nov–Apr"],
  [/broccoli/i, "May–Oct"],
  [/cauliflower/i, "May–Sep"],
  [/cabbage/i, "May–Sep"],
  [/brussels/i, "May–Aug"],
  [/parsnip/i, "Apr–Sep"],
  [/pumpkin/i, "Mar–Aug"],
  [/garlic/i, "Nov–Feb (new season)"],
  [/ginger/i, "Feb–Jul"],
  [/chive/i, "Sep–Mar"],
  [/spinach|rocket/i, "Year round, best Apr–Oct"],
  [/mixed leaves|lettuce|cos|iceberg/i, "Year round"],
  [/onion|shallot/i, "Year round, new season Dec–Mar"],
  [/carrot|beetroot|potato|mushroom/i, "Year round"],
  [/egg/i, "Year round"],
];

export function waSeason(name: string): string | null {
  for (const [re, season] of GUIDE) if (re.test(name)) return season;
  return null;
}
