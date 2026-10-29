/**
 * Spreadsheet formula injection mitigation for exported CSV (FR-16).
 * Cells that begin with a formula trigger are prefixed with an apostrophe.
 */
export function safeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export const CSV_TEMPLATE = `account,type,amount,occurredAt,description,category,note,currency
"Tiền mặt",EXPENSE,65000,2026-10-25,Highlands Coffee,Ăn uống,,VND
"Vietcombank",INCOME,15000000,2026-10-01,Lương tháng 10,Lương/Thu nhập,,VND
"Ví MoMo",EXPENSE,120000,2026-10-26,Grab đi làm,Đi lại,Đi taxi,VND
`;
