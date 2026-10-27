// Career mode: a ladder of matches against named bots, from the club courts to the legends.
// Beat a stage to unlock the next one; earn 1-3 stars depending on how many games you concede.
//
// You always play on team 0 (slot 0). In doubles the partner is a bot of the stage's partner level.

export const CAREER = [
  { id: 1, tier: 'Club', name: 'First Steps', desc: 'A friendly 1v1 with the club coach.', mode: 'singles', difficulty: 'easy', opponents: ['Coach Pablo'], sets: 1, gamesPerSet: 2, xp: 60 },
  { id: 2, tier: 'Club', name: 'Club Doubles', desc: 'Your first doubles match, with Sofi at your side.', mode: 'doubles', difficulty: 'easy', partner: 'Sofi', partnerDiff: 'easy', opponents: ['Marta', 'Luis'], sets: 1, gamesPerSet: 3, xp: 80 },
  { id: 3, tier: 'League', name: 'Sunday League', desc: 'Singles against the league regular.', mode: 'singles', difficulty: 'normal', opponents: ['Diego'], sets: 1, gamesPerSet: 4, xp: 110 },
  { id: 4, tier: 'League', name: 'League Final', desc: 'Doubles final. Ana is your partner today.', mode: 'doubles', difficulty: 'normal', partner: 'Ana', partnerDiff: 'normal', opponents: ['Carla', 'Nico'], sets: 1, gamesPerSet: 6, xp: 150 },
  { id: 5, tier: 'Pro Circuit', name: 'Qualifier', desc: 'Singles qualifier against a seasoned pro.', mode: 'singles', difficulty: 'hard', opponents: ['Ruben'], sets: 1, gamesPerSet: 4, xp: 200 },
  { id: 6, tier: 'Pro Circuit', name: 'Pro Doubles', desc: 'Golden point doubles. Mateo plays with you.', mode: 'doubles', difficulty: 'hard', partner: 'Mateo', partnerDiff: 'hard', opponents: ['Elena', 'Javi'], sets: 1, gamesPerSet: 6, golden: true, xp: 260 },
  { id: 7, tier: 'Legends', name: 'The Wall', desc: 'Singles against the best defender in the circuit.', mode: 'singles', difficulty: 'expert', opponents: ['Maestro Vega'], sets: 1, gamesPerSet: 4, xp: 350 },
  { id: 8, tier: 'Legends', name: 'Grand Final', desc: 'Best of three, golden point, against the Legends.', mode: 'doubles', difficulty: 'expert', partner: 'Mateo', partnerDiff: 'hard', opponents: ['Maestra Rios', 'Maestro Vega'], sets: 3, gamesPerSet: 6, golden: true, xp: 500 },
];

/** Stars for a finished match from the human team's point of view. 0 = lost. */
export function starsFor(results) {
  if (results.winner !== 0) return 0;
  let mine = 0, theirs = 0;
  for (const [a, b] of results.score.sets) { mine += a; theirs += b; }
  const total = mine + theirs || 1;
  const share = theirs / total;
  return share <= 0.15 ? 3 : share <= 0.4 ? 2 : 1;
}
