UPDATE student_memory_snapshots AS snapshot
SET status = 'superseded',
    superseded_at = COALESCE(snapshot.superseded_at, NOW()),
    superseded_by_id = NULL,
    updated_at = NOW()
WHERE snapshot.status IN ('pending', 'ready')
  AND EXISTS (
    SELECT 1
    FROM unnest(snapshot.lesson_memory_entry_ids) AS source(lesson_memory_entry_id)
    LEFT JOIN lesson_memory_entries AS lesson
      ON lesson.id = source.lesson_memory_entry_id
     AND lesson.student_id = snapshot.student_id
     AND lesson.status = 'ready'
     AND lesson.source_content_hash IS NOT NULL
    WHERE lesson.id IS NULL
  );
