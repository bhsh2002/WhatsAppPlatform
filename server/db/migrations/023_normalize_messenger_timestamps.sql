-- ============================================
-- Migration 023: Normalize stored Messenger timestamps
-- ============================================
-- Earlier Messenger paths stored Facebook/JS ISO UTC timestamps while newer
-- SQLite defaults use localtime. Normalize existing Messenger rows to the
-- same SQLite local datetime format so ordering is stable.

UPDATE fb_messages
SET created_at = datetime(substr(replace(created_at, 'T', ' '), 1, 19), 'localtime')
WHERE created_at GLOB '????-??-??T??:??:??*';

UPDATE fb_conversations
SET last_message_time = datetime(substr(replace(last_message_time, 'T', ' '), 1, 19), 'localtime')
WHERE last_message_time GLOB '????-??-??T??:??:??*';
