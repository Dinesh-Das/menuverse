import { asRecord, asString } from './integration-config.ts';

export type NormalizedChannelOrder = {
  externalOrderId: string;
  items: {
    menu_item_id: string;
    quantity: number;
    modifier_option_ids: unknown[];
  }[];
  customer: Record<string, unknown>;
  deliveryAddress: Record<string, unknown> | null;
};

const SIGNATURE_HEADERS: Record<string, string[]> = {
  swiggy: ['x-swiggy-signature', 'x-menuverse-signature'],
  zomato: ['x-zomato-signature', 'x-menuverse-signature'],
  ubereats: ['x-uber-signature', 'x-menuverse-signature'],
  doordash: ['x-doordash-signature', 'x-menuverse-signature'],
  google_food: ['x-google-signature', 'x-menuverse-signature'],
  custom: ['x-menuverse-signature'],
};

function firstRecord(...values: unknown[]) {
  return values.map(asRecord).find(value => Object.keys(value).length > 0) || {};
}

function firstArray(...values: unknown[]) {
  return values.find(Array.isArray) as unknown[] | undefined || [];
}

function normalizeModifierIds(values: unknown[]) {
  return values.map(value => {
    if (typeof value === 'string') return value.trim();
    const option = asRecord(value);
    return asString(option.modifier_option_id)
      || asString(option.option_id)
      || asString(option.external_id)
      || asString(option.id);
  }).filter(Boolean);
}

function externalIdFor(order: Record<string, unknown>, payload: Record<string, unknown>) {
  return asString(order.external_order_id)
    || asString(order.order_id)
    || asString(order.orderId)
    || asString(order.id)
    || asString(payload.external_order_id)
    || asString(payload.order_id)
    || asString(payload.orderId)
    || asString(payload.id);
}

function normalizeItems(values: unknown[]) {
  return values.map(raw => {
    const item = asRecord(raw);
    const nested = firstRecord(item.item, item.menu_item, item.catalog_object, item.product);
    return {
      menu_item_id: asString(item.menu_item_id)
        || asString(item.item_id)
        || asString(item.itemId)
        || asString(item.merchant_item_id)
        || asString(item.external_id)
        || asString(item.sku)
        || asString(nested.menu_item_id)
        || asString(nested.item_id)
        || asString(nested.external_id)
        || asString(nested.sku)
        || asString(nested.id),
      quantity: Math.max(1, Number(item.quantity || item.qty || item.count || 1)),
      modifier_option_ids: normalizeModifierIds(firstArray(
        item.modifier_option_ids,
        item.modifiers,
        item.options,
        nested.modifier_option_ids,
      )),
    };
  }).filter(item => item.menu_item_id);
}

function orderRecordFor(channel: string, payload: Record<string, unknown>) {
  const data = asRecord(payload.data);
  if (channel === 'swiggy') return firstRecord(payload.order, payload.details, data.order, payload);
  if (channel === 'zomato') return firstRecord(payload.order, data.order, payload);
  if (channel === 'ubereats') return firstRecord(payload.order, data.order, data, payload);
  if (channel === 'doordash') return firstRecord(payload.order, data.order, data, payload);
  if (channel === 'google_food') return firstRecord(payload.order, data.order, data, payload);
  return payload;
}

export function signatureForAggregator(req: Request, channel: string) {
  for (const header of SIGNATURE_HEADERS[channel] || SIGNATURE_HEADERS.custom) {
    const value = req.headers.get(header);
    if (value) return value;
  }
  return '';
}

export function normalizeAggregatorOrder(
  channel: string,
  payload: Record<string, unknown>,
): NormalizedChannelOrder {
  const order = orderRecordFor(channel, payload);
  const data = asRecord(payload.data);
  const items = normalizeItems(firstArray(
    order.items,
    order.order_items,
    order.line_items,
    order.cart_items,
    data.items,
    payload.items,
  ));
  const customer = firstRecord(order.customer, order.user, order.eater, payload.customer);
  const deliveryAddress = firstRecord(
    order.delivery_address,
    order.deliveryAddress,
    order.address,
    payload.delivery_address,
  );

  return {
    externalOrderId: externalIdFor(order, payload),
    items,
    customer,
    deliveryAddress: Object.keys(deliveryAddress).length > 0 ? deliveryAddress : null,
  };
}
