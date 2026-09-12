-- Canonical ordering and its digest are validated by the API. Database collation
-- must not impose a different order on an already signed path array.
CREATE OR REPLACE FUNCTION github_delivery_changed_paths_are_bounded(paths jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(paths) <> 'array' THEN false
    WHEN jsonb_array_length(paths) NOT BETWEEN 1 AND 200 THEN false
    ELSE jsonb_array_length(paths) = (
      SELECT count(DISTINCT value) FROM jsonb_array_elements(paths)
    ) AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(paths) AS current_item(value)
      WHERE jsonb_typeof(current_item.value) <> 'string'
        OR char_length(current_item.value #>> '{}') NOT BETWEEN 1 AND 500
        OR btrim(current_item.value #>> '{}') <> current_item.value #>> '{}'
        OR left(current_item.value #>> '{}', 1) IN ('/', '~')
        OR strpos(current_item.value #>> '{}', chr(92)) > 0
        OR current_item.value #>> '{}' ~ '(^|/)(\.|\.\.)(/|$)'
    )
  END
$function$;
