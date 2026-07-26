"use strict";

/**
 * dishes.js — the food.
 *
 * 72 dishes across 10 venues. Every dish has a cook time and a payout,
 * and each venue draws from its own menu, so the game feels different
 * at level 4 than it does at level 94.
 *
 * On top of that, orders can carry a MODIFIER (spicy, deluxe, double,
 * rush, takeaway). You still cook the base dish — the modifier changes
 * what the order is worth and how long the customer will wait. That's
 * 72 dishes x 6 modifiers = 432 distinct order types, before you factor
 * in which venue and level you're playing.
 */

// t = cook seconds, p = base points
const DISHES = {
  // --- diner staples
  burger:      { n: "Burger",       e: "🍔", t: 3.5, p: 100 },
  cheeseburger:{ n: "Cheeseburger", e: "🍔", t: 4.0, p: 120 },
  hotdog:      { n: "Hot Dog",      e: "🌭", t: 2.5, p: 80  },
  fries:       { n: "Fries",        e: "🍟", t: 2.0, p: 60  },
  onionrings:  { n: "Onion Rings",  e: "🧅", t: 2.5, p: 75  },
  nuggets:     { n: "Nuggets",      e: "🍗", t: 3.0, p: 90  },
  pancakes:    { n: "Pancakes",     e: "🥞", t: 3.5, p: 95  },
  waffle:      { n: "Waffle",       e: "🧇", t: 3.5, p: 100 },
  omelette:    { n: "Omelette",     e: "🍳", t: 3.0, p: 90  },
  toast:       { n: "Toast",        e: "🍞", t: 1.5, p: 45  },
  bacon:       { n: "Bacon",        e: "🥓", t: 2.5, p: 70  },
  cereal:      { n: "Cereal",       e: "🥣", t: 1.2, p: 40  },

  // --- drinks
  coffee:      { n: "Coffee",       e: "☕", t: 1.5, p: 45  },
  espresso:    { n: "Espresso",     e: "☕", t: 1.2, p: 50  },
  soda:        { n: "Soda",         e: "🥤", t: 1.2, p: 40  },
  milkshake:   { n: "Milkshake",    e: "🥛", t: 2.5, p: 80  },
  lemonade:    { n: "Lemonade",     e: "🍋", t: 1.8, p: 55  },
  greentea:    { n: "Green Tea",    e: "🍵", t: 1.5, p: 50  },
  horchata:    { n: "Horchata",     e: "🥛", t: 2.0, p: 60  },
  wine:        { n: "Wine",         e: "🍷", t: 1.5, p: 90  },
  champagne:   { n: "Champagne",    e: "🍾", t: 2.0, p: 140 },
  cocktail:    { n: "Cocktail",     e: "🍸", t: 2.8, p: 110 },

  // --- italian
  pizza:       { n: "Pizza",        e: "🍕", t: 5.0, p: 140 },
  calzone:     { n: "Calzone",      e: "🥟", t: 5.5, p: 155 },
  pasta:       { n: "Pasta",        e: "🍝", t: 4.0, p: 120 },
  ravioli:     { n: "Ravioli",      e: "🥟", t: 4.5, p: 135 },
  lasagna:     { n: "Lasagna",      e: "🍲", t: 6.0, p: 175 },
  risotto:     { n: "Risotto",      e: "🍚", t: 5.5, p: 160 },
  gnocchi:     { n: "Gnocchi",      e: "🥔", t: 4.5, p: 130 },
  garlicbread: { n: "Garlic Bread", e: "🥖", t: 2.0, p: 60  },
  bruschetta:  { n: "Bruschetta",   e: "🍅", t: 2.5, p: 75  },

  // --- japanese
  sushi:       { n: "Sushi",        e: "🍣", t: 4.5, p: 130 },
  sashimi:     { n: "Sashimi",      e: "🐟", t: 4.0, p: 140 },
  ramen:       { n: "Ramen",        e: "🍜", t: 5.5, p: 150 },
  miso:        { n: "Miso Soup",    e: "🥣", t: 2.0, p: 60  },
  edamame:     { n: "Edamame",      e: "🫛", t: 1.5, p: 50  },
  tempura:     { n: "Tempura",      e: "🍤", t: 4.0, p: 125 },
  onigiri:     { n: "Onigiri",      e: "🍙", t: 2.5, p: 70  },
  mochi:       { n: "Mochi",        e: "🍡", t: 2.0, p: 65  },

  // --- mexican
  taco:        { n: "Taco",         e: "🌮", t: 2.5, p: 80  },
  burrito:     { n: "Burrito",      e: "🌯", t: 3.5, p: 110 },
  quesadilla:  { n: "Quesadilla",   e: "🧀", t: 3.0, p: 95  },
  nachos:      { n: "Nachos",       e: "🧀", t: 2.8, p: 85  },
  elote:       { n: "Elote",        e: "🌽", t: 2.2, p: 70  },
  churros:     { n: "Churros",      e: "🥖", t: 3.0, p: 90  },
  guac:        { n: "Guacamole",    e: "🥑", t: 2.0, p: 65  },

  // --- seafood
  fish:        { n: "Fish",         e: "🐟", t: 4.0, p: 120 },
  chips:       { n: "Chips",        e: "🍟", t: 2.2, p: 65  },
  prawns:      { n: "Prawns",       e: "🍤", t: 3.5, p: 115 },
  chowder:     { n: "Chowder",      e: "🍲", t: 4.0, p: 120 },
  crab:        { n: "Crab",         e: "🦀", t: 5.0, p: 160 },
  lobster:     { n: "Lobster",      e: "🦞", t: 6.5, p: 210 },
  oysters:     { n: "Oysters",      e: "🦪", t: 3.0, p: 150 },
  scallops:    { n: "Scallops",     e: "🐚", t: 4.5, p: 175 },
  mushypeas:   { n: "Mushy Peas",   e: "🫛", t: 1.8, p: 50  },

  // --- grill / premium
  steak:       { n: "Steak",        e: "🥩", t: 6.0, p: 190 },
  ribs:        { n: "Ribs",         e: "🍖", t: 7.0, p: 215 },
  wings:       { n: "Wings",        e: "🍗", t: 4.0, p: 120 },
  duck:        { n: "Duck",         e: "🦆", t: 6.5, p: 205 },
  venison:     { n: "Venison",      e: "🦌", t: 7.5, p: 245 },
  wagyu:       { n: "Wagyu",        e: "🥩", t: 8.0, p: 300 },
  foiegras:    { n: "Foie Gras",    e: "🍽️", t: 5.5, p: 230 },
  truffle:     { n: "Truffle Dish", e: "🍄", t: 6.0, p: 250 },
  caviar:      { n: "Caviar",       e: "🥄", t: 3.0, p: 220 },

  // --- sides & greens
  salad:       { n: "Salad",        e: "🥗", t: 1.8, p: 55  },
  caesar:      { n: "Caesar",       e: "🥬", t: 2.5, p: 75  },
  mash:        { n: "Mash",         e: "🥔", t: 3.0, p: 80  },
  asparagus:   { n: "Asparagus",    e: "🥦", t: 2.5, p: 75  },
  soup:        { n: "Soup",         e: "🍲", t: 3.0, p: 85  },

  // --- desserts
  cheesecake:  { n: "Cheesecake",   e: "🍰", t: 3.5, p: 110 },
  tiramisu:    { n: "Tiramisu",     e: "🍮", t: 4.0, p: 125 },
  icecream:    { n: "Ice Cream",    e: "🍨", t: 1.5, p: 55  },
  donut:       { n: "Donut",        e: "🍩", t: 2.0, p: 60  },
  macaron:     { n: "Macarons",     e: "🍬", t: 3.5, p: 130 },
  souffle:     { n: "Soufflé",      e: "🧁", t: 6.0, p: 200 },
  cheeseboard: { n: "Cheeseboard",  e: "🧀", t: 3.0, p: 145 },
};

/**
 * Order modifiers. You still cook the BASE dish — the modifier changes
 * the payout and how patient the customer is. `w` is the spawn weight.
 */
const MODIFIERS = {
  none:   { n: "",          badge: "",   pay: 1.00, wait: 1.00, w: 100 },
  spicy:  { n: "Spicy",     badge: "🌶️", pay: 1.25, wait: 1.00, w: 22  },
  deluxe: { n: "Deluxe",    badge: "⭐", pay: 1.60, wait: 1.15, w: 16  },
  double: { n: "Double",    badge: "2️⃣", pay: 1.85, wait: 1.20, w: 12  },
  rush:   { n: "In a Rush", badge: "⚡", pay: 1.45, wait: 0.60, w: 14  },
  togo:   { n: "To Go",     badge: "🥡", pay: 1.30, wait: 0.80, w: 14  },
};

/** Which dishes each venue serves. Menus grow as you climb. */
const VENUES = [
  { id: 0, name: "Family Diner",    emoji: "🍔", from: 1,  to: 10,
    menu: ["burger", "fries", "coffee", "pancakes", "hotdog", "milkshake", "toast", "omelette"] },
  { id: 1, name: "Burger Joint",    emoji: "🍟", from: 11, to: 20,
    menu: ["burger", "cheeseburger", "fries", "onionrings", "soda", "nuggets", "milkshake", "icecream"] },
  { id: 2, name: "Pizza Place",     emoji: "🍕", from: 21, to: 30,
    menu: ["pizza", "calzone", "garlicbread", "salad", "pasta", "soda", "tiramisu", "wings", "bruschetta"] },
  { id: 3, name: "Sushi Bar",       emoji: "🍣", from: 31, to: 40,
    menu: ["sushi", "sashimi", "ramen", "miso", "edamame", "tempura", "greentea", "mochi", "onigiri"] },
  { id: 4, name: "Taco Stand",      emoji: "🌮", from: 41, to: 50,
    menu: ["taco", "burrito", "quesadilla", "nachos", "guac", "churros", "horchata", "elote", "salad"] },
  { id: 5, name: "Fish & Chips",    emoji: "🐟", from: 51, to: 60,
    menu: ["fish", "chips", "mushypeas", "prawns", "chowder", "lemonade", "crab", "cheesecake", "caesar"] },
  { id: 6, name: "Steakhouse",      emoji: "🥩", from: 61, to: 70,
    menu: ["steak", "ribs", "mash", "asparagus", "wine", "cheesecake", "caesar", "soup", "wings"] },
  { id: 7, name: "Italian Kitchen", emoji: "🍝", from: 71, to: 80,
    menu: ["pasta", "risotto", "lasagna", "bruschetta", "gnocchi", "ravioli", "tiramisu", "espresso", "wine"] },
  { id: 8, name: "Luxury Buffet",   emoji: "🍽️", from: 81, to: 90,
    menu: ["lobster", "oysters", "duck", "truffle", "souffle", "champagne", "cheeseboard", "scallops", "caviar", "macaron"] },
  { id: 9, name: "Five-Star",       emoji: "👨‍🍳", from: 91, to: 100,
    menu: ["wagyu", "foiegras", "scallops", "venison", "truffle", "macaron", "souffle", "caviar", "champagne", "cocktail"] },
];

/** Upgrades you buy with tips between shifts. */
const UPGRADES = {
  stove:  { name: "Hotter Stove",  emoji: "🔥", max: 5, cost: (l) => 220 + l * 260,
            blurb: (l) => `Cook ${Math.round((1 - Math.pow(0.88, l + 1)) * 100)}% faster` },
  pass:   { name: "Longer Pass",   emoji: "🍽️", max: 3, cost: (l) => 300 + l * 380,
            blurb: (l) => `Hold ${3 + l + 1} plates at once` },
  burner: { name: "Extra Burner",  emoji: "🍳", max: 2, cost: (l) => 700 + l * 900,
            blurb: (l) => `Cook ${l + 2} dishes at the same time` },
  shoes:  { name: "Better Shoes",  emoji: "👟", max: 4, cost: (l) => 180 + l * 200,
            blurb: (l) => `Move ${Math.round(((1 + (l + 1) * 0.16) - 1) * 100)}% faster` },
  charm:  { name: "Table Charm",   emoji: "💛", max: 4, cost: (l) => 250 + l * 280,
            blurb: (l) => `Earn ${Math.round((l + 1) * 30)}% bigger tips` },
  chairs: { name: "Comfier Chairs",emoji: "🪑", max: 4, cost: (l) => 260 + l * 300,
            blurb: (l) => `Customers wait ${Math.round((l + 1) * 10)}% longer` },
};

function venueForLevel(level) {
  return VENUES.find((v) => level >= v.from && level <= v.to) || VENUES[0];
}

/** Menu grows with level inside a venue so early levels aren't overwhelming. */
function menuForLevel(level) {
  const v = venueForLevel(level);
  const within = level - v.from; // 0..9
  const count = Math.min(v.menu.length, 3 + Math.floor(within / 2));
  return v.menu.slice(0, count);
}

/** Weighted modifier roll. Higher levels see more exotic orders. */
function rollModifier(level, rng) {
  if (level < 6) return "none";
  const spice = Math.min(2.2, 0.5 + level / 30);
  const keys = Object.keys(MODIFIERS);
  const weights = keys.map((k) =>
    k === "none" ? MODIFIERS[k].w : MODIFIERS[k].w * spice
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r <= 0) return keys[i];
  }
  return "none";
}

module.exports = { DISHES, MODIFIERS, VENUES, UPGRADES, venueForLevel, menuForLevel, rollModifier };
