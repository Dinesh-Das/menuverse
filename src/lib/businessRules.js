export const ORDER_STATUS_TRANSITIONS = {
  pending: ['accepted', 'preparing', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served'],
  served: ['completed'],
  completed: [],
  cancelled: [],
};

export function safeParseModifiers(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function canTransitionOrderStatus(fromStatus, toStatus) {
  return Boolean(ORDER_STATUS_TRANSITIONS[fromStatus]?.includes(toStatus));
}

export function calculateOrderTotals(items, taxRate = 0) {
  const subtotal = items.reduce((sum, item) => {
    const quantity = Math.max(0, Number(item.quantity ?? item.qty ?? 0));
    const basePrice = Number(item.price ?? 0);
    const modifierTotal = (item.modifiers || item.selectedModifiers || []).reduce(
      (modSum, modifier) => modSum + Number(modifier.price_delta ?? modifier.priceDelta ?? 0),
      0
    );
    return sum + (basePrice + modifierTotal) * quantity;
  }, 0);

  const taxAmount = subtotal * Number(taxRate || 0);
  return {
    subtotal: Number(subtotal.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    totalAmount: Number((subtotal + taxAmount).toFixed(2)),
  };
}
