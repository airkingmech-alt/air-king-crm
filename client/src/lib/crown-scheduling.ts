import type { CrownCareMembership, WorkOrder } from "../data/mock-data";
import { crownVisitLink } from "../../../shared/crown-scheduling";

type CrownVisitRpc = (name: "crm_schedule_crown_visit", args: { p_work_order: WorkOrder }) =>
  PromiseLike<{ data: any; error: { message?: string } | null }>;

export async function saveCrownVisit(rpc: CrownVisitRpc, workOrder: WorkOrder) {
  const link = crownVisitLink.parse(workOrder);
  const { data, error } = await rpc("crm_schedule_crown_visit", { p_work_order: workOrder });
  if (error) throw new Error(error.message || "The Crown Care visit could not be saved. Please try again.");
  const visit = data?.membership?.[`${link.membershipSeason}Visit`];
  if (data?.workOrder?.id !== workOrder.id || data?.membership?.id !== link.membershipId ||
      visit?.workOrderId !== workOrder.id || visit?.status !== "Scheduled") {
    throw new Error("The visit save could not be confirmed. Refresh before trying again.");
  }
  return data as { workOrder: WorkOrder; membership: CrownCareMembership };
}
