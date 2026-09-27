/**
 * The title line. Loud on purpose: the rest of the page is numbers.
 * One per day (so it doesn't flicker between renders); tap for another.
 */
export const LINES = [
  "LFGgggg! 🚀",
  "Rise and grind! ☕️",
  "Pumpin', pumpin', pumpin'. Doug Banks in the morning 📻",
  "It's giving… gains 💅",
  "No cap, today's the day 🧢",
  "Main character energy only 🎬",
  "Lock in. 🔒",
  "We're so back 📈",
  "Light weight, baby! 🏋️",
  "Yeah buddy! 💪",
  "Touch grass later. Touch iron now. 🌱",
  "Delulu is the solulu. Hit the PR ✨",
  "The pump is the vibe 🎧",
  "Ate and left no crumbs 🍽️",
  "Understood the assignment ✅",
  "Rent's due. The rent is reps 🏠",
  "Gym rat arc 🐀",
  "Built different 🧱",
  "Earn the protein shake 🥤",
  "Sore today, strong tomorrow 🔥",
  "Let him cook 👨‍🍳",
  "Get in, get pumped, get out ⏱️",
  "One more rep, bestie 🫶",
  "Vibe check passed. Now lift 📋",
  "Say less. Lift more 🤐",
  "The iron doesn't care about your inbox 📬",
  "Bro really thought about skipping 👀",
  "Slay the sets, then slay the day 💀",
  "Hydrate or diedrate 💧",
  "Clock in. Get swole. Clock out 🕘",
];

/** Stable index for a date: same line all day, a different one tomorrow. */
export function lineIndex(date: string): number {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % LINES.length;
}
