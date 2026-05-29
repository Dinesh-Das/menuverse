import { jsPDF } from 'jspdf';

function money(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function orderItems(order) {
  return order?.items || order?.order_items || [];
}

export async function downloadOrderReceipt(order, restaurant) {
  const doc = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'portrait' });
  const width = 105;
  let y = 10;

  const line = (text, x = 8, size = 9, style = 'normal', align = 'left') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    const value = String(text || '');
    if (align === 'center') {
      doc.text(value, width / 2, y, { align: 'center', maxWidth: width - 16 });
    } else if (align === 'right') {
      doc.text(value, width - 8, y, { align: 'right', maxWidth: width - 16 });
    } else {
      doc.text(value, x, y, { maxWidth: width - 16 });
    }
    y += size * 0.45;
  };

  const divider = (dashed = false) => {
    doc.setLineDash(dashed ? [1, 1] : [], 0);
    doc.setDrawColor(180);
    doc.line(8, y, width - 8, y);
    y += 3;
  };

  line(restaurant?.name || 'Menuverse', 8, 13, 'bold', 'center');
  y += 1;
  if (restaurant?.address) line(restaurant.address, 8, 8, 'normal', 'center');
  if (restaurant?.gstin) line(`GSTIN: ${restaurant.gstin}`, 8, 8, 'normal', 'center');
  y += 2;
  divider();

  line('Receipt', 8, 10, 'bold', 'center');
  y += 1;
  const dateStr = order?.created_at
    ? new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  line(`Order: #${(order?.id || '').slice(-8).toUpperCase()}`, 8, 8);
  y -= 8 * 0.45;
  line(dateStr, 8, 8, 'normal', 'right');
  if (order?.table_number || order?.table?.number) line(`Table: ${order.table_number || order.table.number}`, 8, 8);
  y += 2;
  divider(true);

  orderItems(order).forEach((item) => {
    const name = item.name || item.menu_item?.name || '';
    const qty = Number(item.quantity || item.qty || 1);
    const price = Number(item.unit_price || item.price || 0);
    const lineTotal = qty * price;
    line(`${qty}x ${name}`, 8, 8);
    y -= 8 * 0.45;
    line(money(lineTotal), 8, 8, 'normal', 'right');
    if (item.item_note) {
      y += 8 * 0.35;
      line(`  Note: ${item.item_note}`, 8, 7, 'italic');
    }
  });

  y += 2;
  divider(true);

  const subtotal = Number(order?.subtotal_amount ?? order?.subtotal ?? order?.total_amount ?? 0);
  const tax = Number(order?.tax_amount ?? order?.tax ?? 0);
  const total = Number(order?.total_amount ?? order?.total ?? 0);
  const discount = Number(order?.loyalty_discount ?? order?.discount ?? 0);

  line('Subtotal', 8, 8);
  y -= 8 * 0.45;
  line(money(subtotal), 8, 8, 'normal', 'right');

  if (tax > 0) {
    line('GST', 8, 8);
    y -= 8 * 0.45;
    line(money(tax), 8, 8, 'normal', 'right');
  }

  if (discount > 0) {
    line('Loyalty discount', 8, 8);
    y -= 8 * 0.45;
    line(`-${money(discount)}`, 8, 8, 'normal', 'right');
  }

  y += 1;
  divider();

  doc.setFillColor(245, 245, 245);
  doc.rect(8, y - 1, width - 16, 7, 'F');
  line('TOTAL', 8, 10, 'bold');
  y -= 10 * 0.45;
  line(money(total), 8, 10, 'bold', 'right');
  y += 4;

  const method = order?.payment_method || order?.payment?.method || '';
  if (method) line(`Paid via ${method}`, 8, 8, 'italic', 'center');

  y += 3;
  line('Thank you for dining with us!', 8, 8, 'italic', 'center');
  line('Powered by Menuverse', 8, 7, 'normal', 'center');

  const filename = `receipt-${(order?.id || 'order').slice(-8)}.pdf`;
  doc.save(filename);
}
