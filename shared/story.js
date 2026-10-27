// Career story: a short scene before each event and one after it. Plain text, no logic: the career UI shows it.
// Speakers are roster ids (see roster.js) or 'narrator'.

export const STORY = {
  'club-open': {
    intro: ['pablo', 'Welcome to the club. Four players, one trophy, no pressure. Show me what you can do on court and we will talk about the rest.'],
    champion: ['pablo', 'You made it look easy. Come back next week: there is a doubles cup, and I have found you a partner.'],
    other: ['pablo', 'Everyone loses their first draw. Watch how the others use the walls and try again.'],
  },
  'club-doubles': {
    intro: ['sofi', 'Hi! I am Sofi. I live at the net, so you cover the back and send me the balls. Deal?'],
    champion: ['sofi', 'We are a team now! Wait until the league hears about this.'],
    other: ['sofi', 'We were out of sync. Next time I will call it louder.'],
  },
  'sunday-league': {
    intro: ['diego', 'Sunday league: everybody plays everybody. Nobody gives a point away here, remember that.'],
    champion: ['diego', 'Top of the group and the final won. I did not see that coming. Respect.'],
    other: ['diego', 'The league is long. Win the long rallies and the table takes care of itself.'],
  },
  'league-final': {
    intro: ['ana', 'The season final, and I am your partner. I read the game, you finish the points. Let us keep it simple.'],
    champion: ['ana', 'League champions. The regional circuit will want to meet us now.'],
    other: ['ana', 'We lost to the better plan on the day. Let us build a better one.'],
  },
  'regional-qualifier': {
    intro: ['kai', 'Regional level. I am in the draw, and I have no weak side. Try not to give me the middle.'],
    champion: ['kai', 'You earned your place on the regional circuit. I will be watching your results.'],
    other: ['kai', 'This is a different speed. Train the volleys and the smash, then come back.'],
  },
  'regional-doubles': {
    intro: ['mateo', 'Floodlights and golden point: one ball decides the game. I am patient, you be brave.'],
    champion: ['mateo', 'We waited for the mistakes and they came. That is how you win under lights.'],
    other: ['mateo', 'Golden point is cruel. Better a bad day than a bad habit: we go again.'],
  },
  'national-open': {
    intro: ['narrator', 'The national open. Every style on the circuit is in the draw: power, nets, counters. Read the scouting notes before each match.'],
    champion: ['narrator', 'National champion. The press wants to know who you are.'],
    other: ['narrator', 'The national draw has no easy rounds. The ranking will remember the effort.'],
  },
  'national-doubles': {
    intro: ['mateo', 'The nation\'s best pairs in one arena. I will take the left, you take whatever comes at your feet.'],
    champion: ['mateo', 'Two titles in the same year. Nobody can call it luck now.'],
    other: ['mateo', 'We were close. The pros do not forgive the second error: sharpen it.'],
  },
  'pro-qualifying': {
    intro: ['vega', 'Pro qualifying. I have beaten everyone who sat where you sit. Prove me wrong.'],
    champion: ['vega', 'Not many beat me from the back of the court. You are on the tour now.'],
    other: ['vega', 'The tour does not wait. Learn from today and apply for the next one.'],
  },
  'international-tour': {
    intro: ['narrator', 'The international tour: a round robin against the circuit regulars. Mateo is back at your side.'],
    champion: ['narrator', 'You topped the tour group. The Major is next, and everyone knows your name.'],
    other: ['narrator', 'The tour is long. One bad group does not end a season.'],
  },
  'the-major': {
    intro: ['rios', 'The Major. Best of three, golden point, the whole world watching. I hope you came to win.'],
    champion: ['rios', 'A Major champion. I came to beat you and I could not. Well played.'],
    other: ['rios', 'It was close enough to hurt. That is the only way a Major is lost.'],
  },
  'legends-cup': {
    intro: ['vega', 'Invitation only. Four players, the best of two generations. This is the one I want to win.'],
    champion: ['vega', 'The Legends Cup is yours. I would hand it over to nobody else.'],
    other: ['vega', 'Even legends lose here. Come back when you are ready for it.'],
  },
};

/** The scene to show before an event, or after it ('champion' or anything else). */
export function sceneFor(eventId, kind) {
  const s = STORY[eventId];
  if (!s) return null;
  const pair = s[kind] || s.other;
  return pair ? { who: pair[0], text: pair[1] } : null;
}
