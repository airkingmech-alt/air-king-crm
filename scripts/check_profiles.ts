import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  "https://vnqtoehunolxvxywrizj.supabase.co",
  "sb_publishable_zUN2rwZLrMxy4wvhswrPDA_SqyJn11x"
);
const { data, error } = await sb.from("profiles").select("id").limit(3);
if (error) console.log("ERROR:", error.code, "-", error.message);
else console.log("profiles table OK. rows:", data.length, JSON.stringify(data));
