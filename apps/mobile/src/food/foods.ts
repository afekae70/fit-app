/**
 * A short list of everyday foods, with what a hundred grams of each holds.
 *
 * Logging food is only bearable if most things can be picked rather than looked up. Nobody
 * knows the calories in a plate of rice; everybody knows it was rice. So the log offers this
 * list first, and typing numbers by hand is the fallback for whatever is not on it.
 *
 * ## What the numbers are
 *
 * Typical values per 100 g of the food as eaten — cooked rice, not dry; a boiled potato, not a
 * raw one — rounded, from standard food-composition tables. They are a guide, not a label: two
 * brands of the same cheese differ by more than the rounding here. The screen says so, and a
 * food can always be logged with the numbers off its own packet instead.
 *
 * Deliberately no branded products and no composed dishes. A brand's recipe changes without
 * notice and a "chicken salad" is whatever the cook made; listing either would put a precise
 * number on something this file cannot know. Staples only, the things a meal is built from.
 * No alcohol either: its calories come from neither protein, carbohydrate nor fat, which is
 * the one thing the test for this file cannot check.
 *
 * ## The test
 *
 * Every row is checked against itself: calories should come to roughly 4 per gram of protein
 * and of carbohydrate and 9 per gram of fat. A row that does not is a typo — a fat and a
 * carbohydrate swapped, a digit dropped — and that check has caught more wrong nutrition data
 * than any amount of proofreading.
 */

export interface FoodSeed {
  /** Stable, lowercase, never shown. Stored on a log entry so the row can be found again. */
  key: string;
  he: string;
  en: string;
  /** Per 100 g, as eaten. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /**
   * A natural unit, where the food has one: an egg, a slice, a tablespoon. Offered as a
   * quicker way to say how much than a number of grams.
   */
  serving?: { grams: number; he: string; en: string };
}

const f = (
  key: string,
  he: string,
  en: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  serving?: FoodSeed['serving'],
): FoodSeed => ({ key, he, en, kcal, protein, carbs, fat, ...(serving ? { serving } : {}) });

const unit = (grams: number, he: string, en: string) => ({ grams, he, en });

export const FOOD_SEED: readonly FoodSeed[] = [
  /* ------------------------------------------------------------------ meat, fish, eggs */
  f('chicken_breast', 'חזה עוף מבושל', 'Chicken breast, cooked', 165, 31, 0, 3.6),
  f('chicken_thigh', 'ירך עוף (פרגית) מבושל', 'Chicken thigh, cooked', 209, 26, 0, 10.9),
  f('chicken_schnitzel', 'שניצל עוף מטוגן', 'Chicken schnitzel, fried', 250, 18, 12, 14),
  f('turkey_breast', 'חזה הודו מבושל', 'Turkey breast, cooked', 135, 30, 0, 1),
  f('turkey_pastrami', 'פסטרמה הודו', 'Turkey pastrami', 100, 17, 2, 2.5),
  f('beef_ground', 'בשר בקר טחון מבושל', 'Ground beef, cooked', 217, 26, 0, 12),
  f('beef_steak', 'סטייק בקר', 'Beef steak, cooked', 206, 29, 0, 9),
  f('sausage', 'נקניקייה', 'Sausage', 290, 11, 2, 26),
  f('salmon', 'סלמון מבושל', 'Salmon, cooked', 206, 22, 0, 12),
  f('tuna_water', 'טונה במים', 'Tuna, canned in water', 116, 26, 0, 1),
  f('white_fish', 'דג לבן (אמנון) מבושל', 'White fish (tilapia), cooked', 128, 26, 0, 2.7),
  f('egg', 'ביצה', 'Egg', 143, 12.6, 0.7, 9.5, unit(50, 'ביצה', 'egg')),
  f('egg_white', 'חלבון ביצה', 'Egg white', 52, 11, 0.7, 0.2, unit(33, 'חלבון', 'egg white')),
  f('tofu', 'טופו', 'Tofu, firm', 145, 16, 3, 9),

  /* ------------------------------------------------------------------------- dairy */
  f('milk_3', 'חלב 3%', 'Milk, 3%', 60, 3.2, 4.7, 3, unit(240, 'כוס', 'glass')),
  f('yogurt_plain', 'יוגורט טבעי 3%', 'Plain yogurt, 3%', 62, 3.5, 4.7, 3),
  f('yogurt_greek', 'יוגורט יווני 2%', 'Greek yogurt, 2%', 73, 10, 4, 2),
  f('cottage_5', "קוטג' 5%", 'Cottage cheese, 5%', 97, 11, 3, 5),
  f('white_cheese_5', 'גבינה לבנה 5%', 'Soft white cheese, 5%', 95, 9.5, 4, 5),
  f(
    'yellow_cheese',
    'גבינה צהובה 28%',
    'Hard yellow cheese',
    350,
    25,
    1,
    28,
    unit(25, 'פרוסה', 'slice'),
  ),
  f('butter', 'חמאה', 'Butter', 717, 0.9, 0.1, 81, unit(10, 'כפית גדושה', 'pat')),
  f('whey', 'אבקת חלבון', 'Whey protein powder', 400, 80, 7, 6, unit(30, 'מנה', 'scoop')),

  /* ---------------------------------------------------------------------- legumes */
  f('lentils', 'עדשים מבושלות', 'Lentils, cooked', 116, 9, 20, 0.4),
  f('chickpeas', 'חומוס גרגרים מבושל', 'Chickpeas, cooked', 164, 8.9, 27, 2.6),
  f('hummus', 'סלט חומוס', 'Hummus spread', 260, 8, 12, 20, unit(30, 'כף', 'tablespoon')),
  f('tahini', 'טחינה גולמית', 'Tahini, raw', 595, 17, 21, 54, unit(15, 'כף', 'tablespoon')),
  f('falafel', 'פלאפל', 'Falafel', 333, 13, 32, 18, unit(17, 'כדור', 'ball')),
  f('peas', 'אפונה מבושלת', 'Green peas, cooked', 84, 5.4, 15.6, 0.2),

  /* ------------------------------------------------------------ grains and starches */
  f('rice_white', 'אורז לבן מבושל', 'White rice, cooked', 130, 2.7, 28, 0.3),
  f('rice_brown', 'אורז מלא מבושל', 'Brown rice, cooked', 123, 2.7, 25.6, 1),
  f('pasta', 'פסטה מבושלת', 'Pasta, cooked', 158, 5.8, 31, 0.9),
  f('couscous', 'קוסקוס מבושל', 'Couscous, cooked', 112, 3.8, 23, 0.2),
  f('bulgur', 'בורגול מבושל', 'Bulgur, cooked', 83, 3.1, 18.6, 0.2),
  f('quinoa', 'קינואה מבושלת', 'Quinoa, cooked', 120, 4.4, 21.3, 1.9),
  f('bread_white', 'לחם לבן', 'White bread', 265, 9, 49, 3.2, unit(30, 'פרוסה', 'slice')),
  f('bread_whole', 'לחם מלא', 'Whole-wheat bread', 247, 13, 41, 3.4, unit(30, 'פרוסה', 'slice')),
  f('pita', 'פיתה', 'Pita', 275, 9, 55, 1.2, unit(100, 'פיתה', 'pita')),
  f('roll', 'לחמנייה', 'Bread roll', 270, 9, 50, 3.5, unit(70, 'לחמנייה', 'roll')),
  f('tortilla', 'טורטייה', 'Wheat tortilla', 310, 8, 51, 8, unit(45, 'טורטייה', 'tortilla')),
  f('oats', 'שיבולת שועל', 'Oats, dry', 389, 16.9, 66, 6.9, unit(40, 'מנה', 'serving')),
  f('cornflakes', 'קורנפלקס', 'Corn flakes', 357, 7.5, 84, 0.4, unit(30, 'מנה', 'serving')),
  f('granola', 'גרנולה', 'Granola', 471, 10, 64, 20, unit(40, 'מנה', 'serving')),
  f('rice_cake', 'פריכית אורז', 'Rice cake', 387, 8, 82, 2.8, unit(10, 'פריכית', 'rice cake')),
  f('potato', 'תפוח אדמה מבושל', 'Potato, boiled', 87, 1.9, 20, 0.1),
  f('sweet_potato', 'בטטה אפויה', 'Sweet potato, baked', 90, 2, 20.7, 0.2),
  f('fries', "צ'יפס", 'French fries', 312, 3.4, 41, 15),
  f('corn', 'תירס מבושל', 'Sweetcorn, cooked', 96, 3.4, 21, 1.5),

  /* ------------------------------------------------------------------------- fruit */
  f('banana', 'בננה', 'Banana', 89, 1.1, 22.8, 0.3, unit(120, 'בננה', 'banana')),
  f('apple', 'תפוח', 'Apple', 52, 0.3, 13.8, 0.2, unit(180, 'תפוח', 'apple')),
  f('orange', 'תפוז', 'Orange', 47, 0.9, 11.8, 0.1, unit(130, 'תפוז', 'orange')),
  f('pear', 'אגס', 'Pear', 57, 0.4, 15.2, 0.1, unit(170, 'אגס', 'pear')),
  f('grapes', 'ענבים', 'Grapes', 69, 0.7, 18, 0.2),
  f('strawberries', 'תותים', 'Strawberries', 32, 0.7, 7.7, 0.3),
  f('watermelon', 'אבטיח', 'Watermelon', 30, 0.6, 7.6, 0.2),
  f('mango', 'מנגו', 'Mango', 60, 0.8, 15, 0.4),
  f('dates', 'תמר מג׳הול', 'Medjool date', 277, 1.8, 75, 0.2, unit(24, 'תמר', 'date')),
  f('avocado', 'אבוקדו', 'Avocado', 160, 2, 8.5, 14.7),

  /* -------------------------------------------------------------------- vegetables */
  f('tomato', 'עגבנייה', 'Tomato', 18, 0.9, 3.9, 0.2, unit(120, 'עגבנייה', 'tomato')),
  f('cucumber', 'מלפפון', 'Cucumber', 15, 0.7, 3.6, 0.1, unit(100, 'מלפפון', 'cucumber')),
  f('pepper', 'פלפל', 'Bell pepper', 31, 1, 6, 0.3),
  f('carrot', 'גזר', 'Carrot', 41, 0.9, 9.6, 0.2),
  f('broccoli', 'ברוקולי מבושל', 'Broccoli, cooked', 35, 2.4, 7.2, 0.4),
  f('lettuce', 'חסה', 'Lettuce', 15, 1.4, 2.9, 0.2),
  f('onion', 'בצל', 'Onion', 40, 1.1, 9.3, 0.1),
  f('olives', 'זיתים', 'Olives', 145, 1, 3.8, 15.3),

  /* ----------------------------------------------------------------- nuts and fats */
  f('olive_oil', 'שמן זית', 'Olive oil', 884, 0, 0, 100, unit(14, 'כף', 'tablespoon')),
  f('mayonnaise', 'מיונז', 'Mayonnaise', 680, 1, 0.6, 75, unit(14, 'כף', 'tablespoon')),
  f('almonds', 'שקדים', 'Almonds', 579, 21, 22, 50, unit(30, 'חופן', 'handful')),
  f('walnuts', 'אגוזי מלך', 'Walnuts', 654, 15, 14, 65, unit(30, 'חופן', 'handful')),
  f('cashews', 'קשיו', 'Cashews', 553, 18, 30, 44, unit(30, 'חופן', 'handful')),
  f('peanuts', 'בוטנים', 'Peanuts', 567, 26, 16, 49, unit(30, 'חופן', 'handful')),
  f('peanut_butter', 'חמאת בוטנים', 'Peanut butter', 588, 25, 20, 50, unit(16, 'כף', 'tablespoon')),

  /* ------------------------------------------------------------ sweets and snacks */
  f('chocolate_dark', 'שוקולד מריר 70%', 'Dark chocolate, 70%', 598, 7.8, 46, 43),
  f('chocolate_milk', 'שוקולד חלב', 'Milk chocolate', 535, 7.6, 59, 30),
  f('halva', 'חלווה', 'Halva', 469, 12, 60, 22),
  f('ice_cream', 'גלידה וניל', 'Vanilla ice cream', 207, 3.5, 24, 11),
  f('crisps', 'חטיף תפוחי אדמה', 'Potato crisps', 536, 7, 53, 35),
  f('popcorn', 'פופקורן', 'Popcorn, air-popped', 387, 13, 78, 4.5),
  f('pizza', 'פיצה', 'Cheese pizza', 266, 11, 33, 10, unit(110, 'משולש', 'slice')),
  f('honey', 'דבש', 'Honey', 304, 0.3, 82, 0, unit(7, 'כפית', 'teaspoon')),
  f('sugar', 'סוכר', 'Sugar', 387, 0, 100, 0, unit(4, 'כפית', 'teaspoon')),
  f('ketchup', 'קטשופ', 'Ketchup', 101, 1, 27, 0.1, unit(15, 'כף', 'tablespoon')),

  /* ------------------------------------------------------------------------ drinks */
  f('cola', 'קולה', 'Cola', 42, 0, 10.6, 0, unit(330, 'פחית', 'can')),
  f('orange_juice', 'מיץ תפוזים', 'Orange juice', 45, 0.7, 10.4, 0.2, unit(240, 'כוס', 'glass')),
];

export const FOOD_BY_KEY: ReadonlyMap<string, FoodSeed> = new Map(
  FOOD_SEED.map((food) => [food.key, food]),
);
