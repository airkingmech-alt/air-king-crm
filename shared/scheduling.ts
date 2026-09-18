import { z } from "zod";

export const scheduleChange = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  }),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(15).max(1440),
  technician: z.string().trim().max(200),
  priority: z.enum(["Low","Normal","High","Emergency"]).optional(),
  technicianId: z.string().uuid().nullable().optional(),
});
export function jobDuration(job: Record<string, any>) {
  const duration = Number(job.durationMinutes || Number(job.laborHours) * 60 || 60);
  return Number.isFinite(duration) && duration >= 15 && duration <= 1440 ? duration : 60;
}
// Floating business-local time: never shift an appointment with the viewer's timezone.
export function jobStart(job: Record<string, any>) {
  return Date.parse(`${job.scheduledDate}T${job.scheduledTime || "09:00"}:00Z`);
}
export function conflictingJobs(job: Record<string, any>, others: Record<string, any>[]) {
  if (!job.technician && !job.technicianId) return [];
  const start = jobStart(job), end = start + jobDuration(job) * 60000;
  return others.filter(other => {
    if (other.id === job.id || ["Cancelled", "Completed", "Unscheduled"].includes(other.status)) return false;
    const same = job.technicianId && other.technicianId ? job.technicianId === other.technicianId
      : job.technician?.toLowerCase() === other.technician?.toLowerCase();
    const otherStart = jobStart(other);
    return same && start < otherStart + jobDuration(other) * 60000 && end > otherStart;
  });
}
