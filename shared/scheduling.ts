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
  if (!scheduleChange.shape.scheduledDate.safeParse(job.scheduledDate).success ||
      !scheduleChange.shape.scheduledTime.safeParse(job.scheduledTime).success) return NaN;
  return Date.parse(`${job.scheduledDate}T${job.scheduledTime}:00Z`);
}
export function conflictingJobs(job: Record<string, any>, others: Record<string, any>[]) {
  if ((!job.technician && !job.technicianId) || job.deletedAt || ["Cancelled", "Completed", "Unscheduled", "Needs Follow-up"].includes(job.status)) return [];
  const start = jobStart(job), end = start + jobDuration(job) * 60000;
  return others.filter(other => {
    if (other.id === job.id || ["Cancelled", "Completed", "Unscheduled", "Needs Follow-up"].includes(other.status) || other.deletedAt) return false;
    const same = job.technicianId && other.technicianId ? job.technicianId === other.technicianId
      : job.technician?.trim().toLowerCase() === other.technician?.trim().toLowerCase();
    const otherStart = jobStart(other);
    if (!Number.isFinite(otherStart) && scheduleChange.shape.scheduledDate.safeParse(other.scheduledDate).success) {
      // This is an uncertainty window, not an inferred appointment time. A
      // date-only historical booking must be reviewed before adding work that day.
      const day = Date.parse(`${other.scheduledDate}T00:00:00Z`);
      return same && start < day + 86400000 && end > day;
    }
    return same && start < otherStart + jobDuration(other) * 60000 && end > otherStart;
  });
}
