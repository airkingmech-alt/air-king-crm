begin;
-- Preserve all current edit, acceptance, numbering, and audit guards. Change
-- only the option count, allowed fourth identity, and warranty cost validation.
-- Abort on unexpected function drift instead of overwriting newer behavior.
do $migration$
declare
  definition text := pg_get_functiondef('crm_private.guard_document_edit()'::regprocedure);
  old_count text := $text$not between 1 and 3 then raise exception 'Include 1 to 3 quote options'$text$;
  old_tiers text := $text$not in ('good','better','best')$text$;
  old_amounts text := $text$array['customerPrice','totalCost','equipmentCost','purchaseTax']$text$;
begin
  if position(old_count in definition)=0 or position(old_tiers in definition)=0 or position(old_amounts in definition)=0 then
    raise exception 'Quote edit guard changed; review four-option migration before applying';
  end if;
  definition := replace(definition, old_count, $text$not between 1 and 4 then raise exception 'Include 1 to 4 quote options'$text$);
  definition := replace(definition, old_tiers, $text$not in ('value','good','better','best')$text$);
  definition := replace(definition, old_amounts, $text$array['customerPrice','totalCost','equipmentCost','purchaseTax','laborWarrantyCost']$text$);
  execute definition;
end $migration$;
-- No customer rows or pricebook data are updated.
commit;
