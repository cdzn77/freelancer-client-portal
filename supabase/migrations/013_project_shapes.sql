alter table projects add column shape_id integer not null default 1 check(shape_id between 1 and 72);
-- Give existing projects stable, varied identities; editors can choose any shape.
with numbered as(select id,row_number() over(order by created_at,id) as n from projects) update projects set shape_id=((numbered.n-1)%72+1)::int from numbered where projects.id=numbered.id;
