// A guard against turning an explicit edit into a duplicate booking. The
// assistant still resolves the target and asks about ambiguous corrections.
export const isExistingEventChange = (content) => {
  if (/\b(?:create|add|book|schedule)\s+(?:a\s+)?(?:new|another)\b/i.test(content)) return false;
  return /\b(?:move|reschedule|postpone|edit|update|cancel|delete)\b|\bchange\s+(?:it|this|that|the|my|existing)\b|\b(?:mover|remarcar|reagendar|alterar|editar|cancelar|excluir|cambiar|reprogramar|posponer|eliminar)\b|সরাও|পরিবর্তন|বাতিল/i.test(content);
};
