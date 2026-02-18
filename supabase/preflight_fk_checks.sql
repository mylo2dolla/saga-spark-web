-- Preflight checks for FK safety before applying 20260120000000_add_missing_fks_indexes_policies.sql

-- Orphan checks (user_id references missing from auth.users)
SELECT COUNT(*) AS orphaned_game_saves
FROM public.game_saves gs
WHERE gs.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = gs.user_id);

SELECT COUNT(*) AS orphaned_server_nodes
FROM public.server_nodes sn
WHERE sn.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = sn.user_id);

-- Safe remediation: null out orphaned user_id values (keeps records, avoids deleting users)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_saves'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    UPDATE public.game_saves gs
    SET user_id = NULL
    WHERE gs.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = gs.user_id);
  ELSE
    RAISE NOTICE 'game_saves.user_id is NOT NULL; resolve orphaned rows manually before adding FK.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'server_nodes'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    UPDATE public.server_nodes sn
    SET user_id = NULL
    WHERE sn.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = sn.user_id);
  ELSE
    RAISE NOTICE 'server_nodes.user_id is NOT NULL; resolve orphaned rows manually before adding FK.';
  END IF;
END $$;
