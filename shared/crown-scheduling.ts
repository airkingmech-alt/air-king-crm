import { z } from "zod";
import { scheduleChange } from "./scheduling";

export const crownVisitLink = z.object({
  membershipId: z.string().trim().min(1),
  membershipSeason: z.enum(["spring", "fall"]),
  scheduledDate: scheduleChange.shape.scheduledDate,
  scheduledTime: scheduleChange.shape.scheduledTime,
});

export interface CrownVisit {
  status: string;
  workOrderId?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  technician?: string;
  completedAt?: string;
}

export function canBookCrownVisit(visit?: CrownVisit) {
  return !visit || (!visit.workOrderId && ["Unscheduled", "Not Scheduled"].includes(visit.status));
}
