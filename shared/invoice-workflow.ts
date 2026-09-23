export function prepareInvoiceLines(lines: {description:string;quantity:string;unitPrice:string}[], cardFeePercent = 0) {
  const items = lines.filter(line => line.description.trim() || line.unitPrice.trim()).map(line => {
    const quantity=Number(line.quantity), price=Number(line.unitPrice);
    if (!line.description.trim() || !line.unitPrice.trim() || !Number.isFinite(quantity) || quantity<=0 || !Number.isFinite(price) || price<0)
      throw new Error("Each invoice item needs a description, a quantity greater than zero, and a price of zero or more.");
    const cents=Math.round(quantity*price*100);
    if (!Number.isSafeInteger(cents)) throw new Error("An invoice item amount is too large.");
    return {description:line.description.trim(),amount:cents/100};
  });
  let totalCents=items.reduce((sum,item)=>sum+Math.round(item.amount*100),0);
  if (!items.length || totalCents<=0 || !Number.isSafeInteger(totalCents)) throw new Error("Add invoice items with a total greater than zero.");
  if (!Number.isFinite(cardFeePercent) || cardFeePercent < 0 || cardFeePercent > 3)
    throw new Error("Enter a credit-card fee between 0% and 3%.");
  const feeCents = Math.round(totalCents * cardFeePercent / 100);
  if (feeCents > 0) {
    items.push({description:`Credit-card fee (${cardFeePercent}%)`,amount:feeCents/100});
    totalCents += feeCents;
    if (!Number.isSafeInteger(totalCents)) throw new Error("Invoice total is too large.");
  }
  return {items,amount:totalCents/100};
}

// Saving and sending are separate outcomes. Once saved, never re-create on send failure.
export async function saveInvoiceThenSend<T>(save:()=>Promise<T>,afterSave:(invoice:T)=>void,send?: (invoice:T)=>Promise<unknown>) {
  const invoice=await save();
  afterSave(invoice);
  try {
    if(send)await send(invoice);
    return {invoice,deliveryError:null};
  } catch(error:any) {
    return {invoice,deliveryError:error.message || "Email could not be queued. Open the saved invoice to review delivery."};
  }
}
