-- ============================================
-- Migration 019: Auto-Like Columns (handled by migrator)
-- ============================================
-- Column additions for trigger_on, auto_like, auto_like_type
-- are handled by ensureAutomationColumns() in migrator.js
-- to safely handle cases where 018 ran before these were added.

SELECT 1;
