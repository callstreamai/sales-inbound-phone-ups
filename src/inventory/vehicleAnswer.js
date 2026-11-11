// Unit upholstery is deterministic: never borrow material from another slot/model.
export function unitMaterialAnswer(question, facts) {
  if (!/\b(leather|softex|upholstery|fabric|seating material|seat material|interior material)\b/i.test(question)) return null;
  const units = (facts.units || []).filter(u => u && typeof u.stock === 'string' && u.stock);
  let candidates = units;
  const stock = units.find(u => question.toLowerCase().includes(u.stock.toLowerCase()));
  if (stock) candidates = [stock];
  else {
    if (/\b(used|pre.?owned)\b/i.test(question)) candidates = candidates.filter(u => u.condition !== 'new');
    else if (/\bnew\b/i.test(question)) candidates = candidates.filter(u => u.condition === 'new');
    const colors = ['red', 'white', 'black', 'blue', 'green', 'silver', 'gray'];
    for (const color of colors) if (new RegExp(`\\b${color}\\b`, 'i').test(question)) candidates = candidates.filter(u => new RegExp(`\\b${color}\\b`, 'i').test(u.color || ''));
    if (candidates.length > 1 && Number(facts.selected_slot) > 0) candidates = candidates.filter(u => Number(u.slot) === Number(facts.selected_slot));
  }
  // General model upholstery questions still use manufacturer guidance via OpenAI.
  if (!units.length || !/\b(this|that|one|used|new|red|white|black|blue|green|silver|gray)\b/i.test(question) && !stock && !Number(facts.selected_slot)) return null;
  if (candidates.length !== 1) return { success: true, status: 'clarify_unit', helper_answer: 'Which of the listed vehicles would you like me to check the seating material for?', helper_sales_note: 'Caller asked about upholstery; the unit needs clarification.', helper_source: 'verified_unit_facts' };
  const u = candidates[0];
  // Only an explicit upholstery label establishes material; a feature mentioning
  // a leather steering wheel or an interior color is not seating evidence.
  const material = String(u.interior || '');
  let answer;
  if (/softex/i.test(material)) answer = 'The listing describes the seating as SofTex, which is synthetic upholstery rather than genuine leather.';
  else if (/fabric|cloth/i.test(material)) answer = 'The listing describes fabric or cloth seating rather than genuine leather.';
  else if (/leather/i.test(material) && !/leatherette|synthetic|faux/i.test(material)) answer = 'The listing describes leather seating for that vehicle.';
  else answer = 'That vehicle’s listing does not specify the seating material, so I cannot confirm genuine leather from it. Sales can check the exact upholstery for that stock number.';
  return { success: true, status: 'answered', helper_answer: answer, helper_sales_note: `Upholstery question for stock ${u.stock}; answered only from that unit's interior description.`, helper_source: 'verified_unit_facts' };
}
