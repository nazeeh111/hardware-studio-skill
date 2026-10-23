// Short, deterministic questions improve an idea before any model is asked to draft it.
// They do not infer engineering specifications from an image or a few keywords.
const conditions = [
  { id: 'motion', title: 'Motion or load', question: 'What must move, how far, and under what load?', when: /\b(motor|servo|robot|arm|actuator|pump|valve|drive|lift)\b/i },
  { id: 'sensing', title: 'Measurements', question: 'What range, accuracy, and update rate matter?', when: /\b(sensor|measure|monitor|detect|logger|temperature|humidity|moisture|pressure)\b/i },
  { id: 'visual', title: 'Visible output', question: idea => /\b(display|screen|oled|lcd)\b/i.test(idea) ? 'What display size and readability are needed?' : 'How many lights, and what brightness or visibility is needed?', when: /\b(led|light|lamp|display|screen|pixel|oled|lcd)\b/i },
  { id: 'runtime', title: 'Runtime', question: 'How long must it run between charges, and how will it charge?', when: /\b(battery|portable|wearable|wireless|recharge)\b/i },
  { id: 'power', title: 'Power source', question: 'What will power it, and what supply limits are known?', when: idea => !/\b(usb|battery|solar|mains|wall adapter|power supply|power bank|5\s?v|12\s?v|24\s?v)\b/i.test(idea) },
  { id: 'environment', title: 'Operating place', question: 'Where will it run, and what heat, water, or motion will it face?', when: idea => !/\b(indoor|outdoor|desk|garden|wearable|underwater|vehicle|car|room)\b/i.test(idea) },
  { id: 'size', title: 'Physical limit', question: 'What size, weight, or mounting constraint must it meet?', when: idea => !/\b\d+(?:\.\d+)?\s?(?:mm|cm|m|inches|inch|grams|g|kg)\b/i.test(idea) },
  { id: 'success', title: 'Success check', question: 'What observable result would show that it works?', when: () => true }
];

export function briefQuestions(idea) {
  const input = String(idea || '').trim();
  if (input.length < 5) return [];
  const mechanicalScope = /\b(?:mechanical[- ]only|(?:enclosure|case|bracket|mount|holder|shell)\s+only)\b/i.test(input);
  const matched = conditions.filter(item => !(mechanicalScope && ['sensing', 'visual', 'runtime', 'power'].includes(item.id)) && (typeof item.when === 'function' ? item.when(input) : item.when.test(input)));
  const selected = [...matched.filter(item => item.id !== 'success').slice(0, 3), matched.find(item => item.id === 'success')];
  return selected
    .map(({ id, title, question }) => ({ id, title, question: typeof question === 'function' ? question(input) : question }));
}

export function composeBrief(idea, answers = {}) {
  const input = String(idea || '').trim().slice(0, 2000);
  if (!input) return { text: '', openQuestions: [], answered: 0 };
  const questions = briefQuestions(input);
  const supplied = [], openQuestions = [];
  for (const item of questions) {
    const answer = String(answers[item.id] || '').trim().slice(0, 240);
    if (answer) supplied.push(`${item.title}: ${answer}`);
    else openQuestions.push(item.question);
  }
  const text = [input, supplied.length ? `Design conditions supplied by the user:\n${supplied.map(line => `- ${line}`).join('\n')}` : '',
    openQuestions.length ? `Open design questions; do not invent exact specifications:\n${openQuestions.map(line => `- ${line}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  return { text, openQuestions, answered: supplied.length };
}
