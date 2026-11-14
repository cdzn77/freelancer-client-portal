create function public.initialize_retainer_usage() returns trigger language plpgsql security definer set search_path=public as $$ begin new.used=coalesce((select sum(minutes)/60.0 from time_entries where workspace_id=new.workspace_id and project_id=new.project_id and billable and entry_date>=new.period and entry_date<(new.period+interval '1 month')),0);return new;end $$;
create trigger retainer_usage before insert or update of period,project_id on retainers for each row execute function initialize_retainer_usage();
update retainers set period=period;
