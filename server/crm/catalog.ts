import { z } from "zod";
export const triggers = [
  "lead.created",
  "customer.created",
  "quote.created",
  "quote.sent",
  "quote.viewed",
  "quote.accepted",
  "quote.declined",
  "invoice.created",
  "invoice.sent",
  "invoice.due",
  "invoice.overdue",
  "invoice.paid",
  "appointment.scheduled",
  "appointment.upcoming",
  "technician.on_the_way",
  "job.completed",
  "customer.inactive",
  "equipment.maintenance_due",
  "equipment.replacement_due",
  "campaign.seasonal",
  "payment.received",
  "coupon.issued",
] as const;
export const conditionFields = [
  "quote_pending",
  "invoice_unpaid",
  "invoice_balance",
  "has_email",
  "has_phone",
  "allows_sms",
  "allows_marketing_email",
  "job_type",
  "quote_amount",
  "months_since_service",
  "coupon_unused",
] as const;
export const conditionSchema = z.object({
  field: z.enum(conditionFields),
  op: z.enum(["eq", "gt", "lt", "exists"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export const stepSchema = z.object({
  action: z.enum(["email", "sms", "wait", "stop", "activity"]),
  wait_minutes: z.number().int().min(0).max(525600),
  template_id: z.string().uuid().optional(),
  conditions: z.array(conditionSchema).max(20).default([]),
  message: z.string().max(2000).optional(),
});
export const automationSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  enabled: z.boolean().default(false),
  trigger: z.enum(triggers),
  conditions: z.array(conditionSchema).max(20).default([]),
  stop_conditions: z.array(conditionSchema).max(20).default([]),
  steps: z.array(stepSchema).min(1).max(30),
});
export const templateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  channel: z.enum(["email", "sms"]),
  category: z.enum(["transactional", "marketing"]),
  subject: z.string().max(300).default(""),
  body: z.string().min(1).max(20000),
  active: z.boolean().default(true),
  archived: z.boolean().default(false),
});
export const starters = [
  [
    "Quote follow-up",
    "quote.sent",
    "quote",
    "transactional",
    [
      [2880, "sms"],
      [4320, "email"],
      [7200, "sms"],
    ],
  ],
  [
    "Unpaid invoice reminder",
    "invoice.due",
    "invoice",
    "transactional",
    [
      [0, "email"],
      [4320, "sms"],
      [0, "email"],
      [5760, "sms"],
      [0, "email"],
      [10080, "email"],
    ],
  ],
  [
    "Appointment reminder",
    "appointment.upcoming",
    "appointment",
    "transactional",
    [[0, "sms"]],
  ],
  [
    "Technician on the way",
    "technician.on_the_way",
    "on_the_way",
    "transactional",
    [[0, "sms"]],
  ],
  [
    "Job completed / thank you",
    "job.completed",
    "thank_you",
    "transactional",
    [[0, "email"]],
  ],
  [
    "Google review request",
    "job.completed",
    "review",
    "marketing",
    [[1440, "sms"]],
  ],
  [
    "Maintenance reminder",
    "equipment.maintenance_due",
    "maintenance",
    "marketing",
    [[0, "email"]],
  ],
  [
    "Equipment replacement follow-up",
    "equipment.replacement_due",
    "replacement",
    "marketing",
    [[0, "email"]],
  ],
  [
    "Seasonal HVAC campaign",
    "campaign.seasonal",
    "seasonal",
    "marketing",
    [[0, "email"]],
  ],
  [
    "Inactive customer",
    "customer.inactive",
    "inactive",
    "marketing",
    [[0, "email"]],
  ],
  [
    "New lead follow-up",
    "lead.created",
    "lead",
    "transactional",
    [[60, "sms"]],
  ],
  [
    "Quote accepted confirmation",
    "quote.accepted",
    "accepted",
    "transactional",
    [[0, "email"]],
  ],
  [
    "Quote declined follow-up",
    "quote.declined",
    "declined",
    "transactional",
    [[1440, "email"]],
  ],
  [
    "Payment received / receipt",
    "payment.received",
    "receipt",
    "transactional",
    [[0, "email"]],
  ],
] as const;
export const bodies: Record<string, string> = {
  quote:
    "Hi {{customer_first_name}}, your Air King Mechanical quote is ready. Review your options: {{quote_link}}. Please let us know if you have questions.",
  invoice:
    "Hi {{customer_first_name}}, your Air King invoice {{invoice_number}} has {{amount_due}} remaining. View or pay securely: {{payment_link}}.",
  appointment:
    "Hi {{customer_first_name}}, a reminder about your Air King appointment on {{appointment_date}} at {{appointment_time}}. Address: {{job_address}}.",
  on_the_way:
    "Hi {{customer_first_name}}, {{technician_name}} from Air King Mechanical is on the way to {{job_address}}.",
  thank_you:
    "Thank you for choosing Air King Mechanical, {{customer_first_name}}. We appreciate your business!",
  review:
    "Hi {{customer_first_name}}, thank you for choosing Air King. Would you share your experience? {{review_link}}",
  maintenance:
    "Hi {{customer_first_name}}, it is time to schedule maintenance for your HVAC equipment. Contact Air King Mechanical to arrange a visit.",
  replacement:
    "Hi {{customer_first_name}}, would you like to revisit your HVAC replacement recommendation? Air King is here to help.",
  seasonal:
    "Hi {{customer_first_name}}, get your HVAC system ready for the season with Air King Mechanical. Contact us to schedule service.",
  inactive:
    "Hi {{customer_first_name}}, it has been a while since your last visit. Air King Mechanical is here when you need HVAC service.",
  lead: "Hi {{customer_first_name}}, thank you for contacting Air King Mechanical. How can we help with your HVAC needs?",
  accepted:
    "Thank you, {{customer_first_name}}. We received your quote acceptance. Air King will contact you to arrange the next steps. {{quote_link}}",
  declined:
    "Hi {{customer_first_name}}, we received your decision on the quote. Thank you for considering Air King. Please let us know if you would like to discuss other options.",
  receipt:
    "Thank you for your payment of {{receipt_amount}}, {{customer_first_name}}. Your remaining balance is {{amount_due}}. View your invoice and payment history: {{payment_link}}",
};
