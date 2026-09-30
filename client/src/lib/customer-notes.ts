import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { supabase } from "./supabase";
import { customerNotesQueryOptions } from "../../../shared/customer-notes";

export function useCustomerNotes(customerId: string) {
  const { profile } = useAuth();
  const query = useQuery(customerNotesQueryOptions(supabase, profile?.id || "", profile?.company_id || "", customerId));
  const { refetch } = query;
  useEffect(() => {
    const refresh = () => { void refetch(); };
    window.addEventListener("crm-refresh", refresh);
    return () => window.removeEventListener("crm-refresh", refresh);
  }, [refetch]);
  return query;
}
