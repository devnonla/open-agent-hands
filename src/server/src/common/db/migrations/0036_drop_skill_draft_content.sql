UPDATE skills
SET content = draft_content, updated_at = unixepoch()
WHERE draft_content IS NOT NULL
  AND TRIM(draft_content) != ''
  AND draft_content != content;

UPDATE skill_references
SET content = draft_content, updated_at = unixepoch()
WHERE draft_content IS NOT NULL
  AND TRIM(draft_content) != ''
  AND draft_content != content;

ALTER TABLE skills DROP COLUMN draft_content;
ALTER TABLE skill_references DROP COLUMN draft_content;
