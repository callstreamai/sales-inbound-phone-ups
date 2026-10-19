// Dealer color labels can contain disclosure links. Never pass markup to speech.
export function cleanInventoryText(value) {
  return String(value || '').replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}
