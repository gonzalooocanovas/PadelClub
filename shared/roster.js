// Fictional career roster. Every character has a bot level, a playing STYLE that changes how the AI positions itself
// and which shots it chooses (see shared/ai.js), a look, and a short scouting note.
//
// styles: net (lives at the net, attacks) · retriever (gets everything back) · power (overheads and winners)
//         allround (balanced) · wild (dangerous but inconsistent) · counter (patient, lobs and slices)

export const ROSTER = [
  { id: 'pablo', name: 'Coach Pablo', style: 'retriever', level: 'easy', points: 40, look: { arch: 2, hair: 6, skin: 1, racket: 3 }, note: 'Club coach. Patient, rarely misses, rarely attacks. Make him move.' },
  { id: 'sofi', name: 'Sofi', style: 'net', level: 'easy', points: 55, look: { arch: 1, hair: 1, skin: 2, racket: 5 }, note: 'Cheerful net player. Volleys well, weak against lobs.' },
  { id: 'marta', name: 'Marta', style: 'allround', level: 'easy', points: 60, look: { arch: 1, hair: 4, skin: 0, racket: 1 }, note: 'Steady from every position. No big weapon.' },
  { id: 'luis', name: 'Luis', style: 'power', level: 'easy', points: 70, look: { arch: 0, hair: 3, skin: 4, racket: 4 }, note: 'Swings hard at everything. Errors when rushed.' },
  { id: 'diego', name: 'Diego', style: 'retriever', level: 'normal', points: 130, look: { arch: 0, hair: 3, skin: 4, racket: 1 }, note: 'League regular who never gives up a point cheaply.' },
  { id: 'ana', name: 'Ana', style: 'allround', level: 'normal', points: 150, look: { arch: 3, hair: 2, skin: 3, racket: 0 }, note: 'Reads the game well. Strong at changing pace with the slice.' },
  { id: 'carla', name: 'Carla', style: 'net', level: 'normal', points: 165, look: { arch: 3, hair: 2, skin: 3, racket: 2 }, note: 'Takes the net early. Lob over her head.' },
  { id: 'nico', name: 'Nico', style: 'wild', level: 'normal', points: 175, look: { arch: 2, hair: 5, skin: 1, racket: 2 }, note: 'Brilliant or awful. Let him make the mistakes.' },
  { id: 'kai', name: 'Kai', style: 'allround', level: 'hard', points: 290, look: { arch: 0, hair: 0, skin: 2, racket: 6 }, note: 'Complete player with no obvious weakness.' },
  { id: 'lucia', name: 'Lucía', style: 'retriever', level: 'hard', points: 310, look: { arch: 3, hair: 1, skin: 0, racket: 3 }, note: 'Tireless defender. Only a well-placed drop shot breaks her.' },
  { id: 'ruben', name: 'Rubén', style: 'power', level: 'hard', points: 330, look: { arch: 2, hair: 6, skin: 0, racket: 6 }, note: 'Overhead specialist. Do not give him high balls.' },
  { id: 'mateo', name: 'Mateo', style: 'counter', level: 'hard', points: 350, look: { arch: 0, hair: 0, skin: 1, racket: 7 }, note: 'Patient counter-attacker. Waits for your error, then pounces.' },
  { id: 'elena', name: 'Elena', style: 'net', level: 'hard', points: 370, look: { arch: 1, hair: 1, skin: 2, racket: 7 }, note: 'Fast hands at the net. Keep the ball low and at her feet.' },
  { id: 'javi', name: 'Javi', style: 'wild', level: 'hard', points: 390, look: { arch: 0, hair: 3, skin: 4, racket: 6 }, note: 'Dangerous attacker, inconsistent. Streaky.' },
  { id: 'vega', name: 'Maestro Vega', style: 'counter', level: 'expert', points: 720, look: { arch: 2, hair: 6, skin: 3, racket: 6 }, note: 'The best defender on the circuit. Wins long rallies.' },
  { id: 'rios', name: 'Maestra Ríos', style: 'power', level: 'expert', points: 760, look: { arch: 3, hair: 4, skin: 3, racket: 7 }, note: 'Pure power from both sides of the court. Hard to lob.' },
];

export const ROSTER_BY_ID = Object.fromEntries(ROSTER.map((r) => [r.id, r]));

/** Style modifiers applied on top of a bot level (see shared/ai.js). Additive on the 0..1 tendencies. */
export const STYLE_MODS = {
  net: { aggr: 0.15, lob: -0.15, netZ: 2.4, backZ: 5.6, smash: 0.1 },
  retriever: { speed: 0.05, aggr: -0.15, lob: 0.1, slice: 0.1, flub: -0.04 },
  power: { aggr: 0.2, smash: 0.15, speed: -0.02, flub: 0.02 },
  allround: {},
  wild: { aggr: 0.25, flub: 0.07, noise: 0.4 },
  counter: { aggr: -0.1, lob: 0.15, slice: 0.15, netZ: 3.6, backZ: 7.0 },
};
