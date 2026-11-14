-- Hosted Supabase can grant anon EXECUTE through default privileges.
-- Revoking PUBLIC alone does not remove those direct role grants.
revoke execute on function
 public.guard_connected_time(),
 public.guard_billed_expense(),
 public.guard_source_invoice(),
 public.create_work_invoice(uuid,uuid[],uuid[],date,uuid,boolean),
 public.bind_client_account(),
 public.guard_group_projects(),
 public.planning_fingerprint(uuid),
 public.shift_work_date(date,integer,integer[],date[]),
 public.preview_task_schedule(uuid,date,date),
 public.apply_task_schedule(uuid,date,date,text,uuid),
 public.save_task_allocations(uuid,jsonb,text),
 public.get_project_planning(uuid),
 public.guard_planning_change(),
 public.create_assistant_task(uuid,text,text,date,uuid),
 public.preview_client_project(uuid,uuid)
from public, anon;
-- Internal helpers run through the owner RPCs or table triggers only.
revoke execute on function public.planning_fingerprint(uuid),
 public.shift_work_date(date,integer,integer[],date[]),
 public.guard_connected_time(),public.guard_billed_expense(),
 public.guard_source_invoice(),public.bind_client_account(),
 public.guard_group_projects(),public.guard_planning_change()
from authenticated;
notify pgrst, 'reload schema';
