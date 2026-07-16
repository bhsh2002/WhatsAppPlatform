import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildFacebookPostLibraryDraft,
  buildFacebookPostProductDraft,
} from './facebookContentConfig';

const futureLocalDateTime = (minutes = 60) => {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

const postText = (post, fallback = '') => {
  const attachment = Array.isArray(post?.attachments?.data)
    ? post.attachments.data[0]
    : null;
  return String(post?.message || attachment?.description || fallback || '').trim();
};

export const useFacebookPostWorkflows = ({
  adapter,
  linkedPageId,
  setSnackbar,
  t,
}) => {
  const [product, setProduct] = useState({
    open: false,
    post: null,
    draft: null,
    saving: false,
  });
  const [ai, setAi] = useState({
    open: false,
    post: null,
    action: 'rewrite',
    taskInstruction: '',
    variants: 1,
    result: null,
    loading: false,
  });
  const [campaign, setCampaign] = useState({
    open: false,
    post: null,
    name: '',
    scheduleTimes: '09:00',
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
    loading: false,
  });
  const [schedule, setSchedule] = useState({
    open: false,
    post: null,
    scheduledFor: futureLocalDateTime(),
    loading: false,
  });
  const [history, setHistory] = useState({
    open: false,
    post: null,
    rows: [],
    loading: false,
  });
  const [quickAction, setQuickAction] = useState('');

  const notify = useCallback((message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  }, [setSnackbar]);

  const importPost = useCallback(async (post, {
    duplicate = false,
    silent = false,
  } = {}) => {
    const payload = buildFacebookPostLibraryDraft(post, linkedPageId, {
      duplicate,
      fallbackTitle: t('facebookContent.defaultPostName'),
    });
    if (!payload.body) payload.body = payload.title;
    const item = await adapter.importPost(payload);
    if (!silent) {
      notify(
        item.reused
          ? t('facebookContent.messages.postAlreadyInLibrary')
          : duplicate
            ? t('facebookContent.messages.postCopyCreated')
            : t('facebookContent.messages.postAddedToLibrary'),
        'success',
      );
    }
    return item;
  }, [adapter, linkedPageId, notify, t]);

  const runQuickImport = useCallback(async (post, duplicate = false) => {
    try {
      setQuickAction(duplicate ? `copy:${post.id}` : `library:${post.id}`);
      await importPost(post, { duplicate });
    } catch (error) {
      notify(error.message || t('facebookContent.messages.postLibraryFailed'), 'error');
    } finally {
      setQuickAction('');
    }
  }, [importPost, notify, t]);

  const openProduct = useCallback(post => {
    setProduct({
      open: true,
      post,
      draft: buildFacebookPostProductDraft(
        post,
        t('facebookContent.productFromPostFallbackName'),
      ),
      saving: false,
    });
  }, [t]);

  const saveProduct = useCallback(async approve => {
    if (!product.post || !product.draft?.name?.trim()) return;
    try {
      setProduct(current => ({ ...current, saving: true }));
      await adapter.createProduct({
        ...product.draft,
        price: Number(product.draft.price) || 0,
        approval_status: approve ? 'approved' : 'draft',
        is_active: approve,
        source_linked_page_id: linkedPageId,
        source_post_id: product.post.id,
        source_post_url: product.post.permalink_url || null,
      });
      setProduct({ open: false, post: null, draft: null, saving: false });
      notify(
        approve
          ? t('facebookContent.messages.productApprovedFromPost')
          : t('facebookContent.messages.productDraftedFromPost'),
        'success',
      );
    } catch (error) {
      setProduct(current => ({ ...current, saving: false }));
      notify(error.message || t('facebookContent.messages.productCreateFromPostFailed'), 'error');
    }
  }, [adapter, linkedPageId, notify, product.draft, product.post, t]);

  const openAi = useCallback((post, action = 'rewrite') => {
    setAi({
      open: true,
      post,
      action,
      taskInstruction: '',
      variants: action === 'variants' ? 3 : 1,
      result: null,
      loading: false,
    });
  }, []);

  const runAi = useCallback(async () => {
    if (!ai.post) return;
    try {
      setAi(current => ({ ...current, loading: true, result: null }));
      const response = await adapter.generateAi({
        linked_page_id: linkedPageId,
        source_post_id: ai.post.id,
        source_post_url: ai.post.permalink_url || null,
        input_text: postText(ai.post, t('facebookContent.noText')),
        action: ai.action,
        task_instruction: ai.taskInstruction,
        variants: Number(ai.variants) || 1,
        create_items: true,
      });
      setAi(current => ({ ...current, loading: false, result: response }));
      notify(
        t('facebookContent.messages.aiDraftsCreated', {
          count: response.created_item_ids?.length || 0,
        }),
        'success',
      );
    } catch (error) {
      setAi(current => ({ ...current, loading: false }));
      notify(error.message || t('facebookContent.messages.aiPostToolFailed'), 'error');
    }
  }, [adapter, ai.action, ai.post, ai.taskInstruction, ai.variants, linkedPageId, notify, t]);

  const openCampaign = useCallback(post => {
    const draft = buildFacebookPostLibraryDraft(post, linkedPageId, {
      fallbackTitle: t('facebookContent.defaultPostName'),
    });
    setCampaign({
      open: true,
      post,
      name: `${t('facebookContent.campaignFromPostPrefix')} - ${draft.title}`.slice(0, 160),
      scheduleTimes: '09:00',
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
      loading: false,
    });
  }, [linkedPageId, t]);

  const createCampaign = useCallback(async () => {
    if (!campaign.post || !campaign.name.trim()) return;
    try {
      setCampaign(current => ({ ...current, loading: true }));
      const item = await importPost(campaign.post, { silent: true });
      await adapter.createCampaign({
        linked_page_id: linkedPageId,
        name: campaign.name,
        source_mode: 'library',
        rotation_mode: 'sequential',
        timezone: 'Africa/Tripoli',
        allowed_days: campaign.allowedDays,
        schedule_times: String(campaign.scheduleTimes)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),
        no_repeat_days: 14,
        max_posts_per_day: 1,
        approval_required: true,
        status: 'draft',
        content_item_ids: [item.id],
      });
      setCampaign(current => ({ ...current, open: false, loading: false }));
      notify(t('facebookContent.messages.campaignCreatedFromPost'), 'success');
    } catch (error) {
      setCampaign(current => ({ ...current, loading: false }));
      notify(error.message || t('facebookContent.messages.campaignFromPostFailed'), 'error');
    }
  }, [adapter, campaign, importPost, linkedPageId, notify, t]);

  const openSchedule = useCallback(post => {
    setSchedule({
      open: true,
      post,
      scheduledFor: futureLocalDateTime(),
      loading: false,
    });
  }, []);

  const scheduleAgain = useCallback(async () => {
    if (!schedule.post || !schedule.scheduledFor) return;
    try {
      setSchedule(current => ({ ...current, loading: true }));
      const item = await importPost(schedule.post, { silent: true });
      if (item.status !== 'approved') await adapter.approveItem(item.id);
      await adapter.schedulePublication({
        linked_page_id: linkedPageId,
        content_item_id: item.id,
        scheduled_for: new Date(schedule.scheduledFor).toISOString(),
      });
      setSchedule(current => ({ ...current, open: false, loading: false }));
      notify(t('facebookContent.messages.postScheduledAgain'), 'success');
    } catch (error) {
      setSchedule(current => ({ ...current, loading: false }));
      notify(error.message || t('facebookContent.messages.postScheduleAgainFailed'), 'error');
    }
  }, [adapter, importPost, linkedPageId, notify, schedule.post, schedule.scheduledFor, t]);

  const openHistory = useCallback(async post => {
    setHistory({ open: true, post, rows: [], loading: true });
    try {
      const response = await adapter.getPublications({
        linked_page_id: linkedPageId,
        source_post_id: post.id,
        limit: 100,
      });
      setHistory(current => ({
        ...current,
        rows: response.publications || [],
        loading: false,
      }));
    } catch (error) {
      setHistory(current => ({ ...current, loading: false }));
      notify(error.message || t('facebookContent.messages.postHistoryFailed'), 'error');
    }
  }, [adapter, linkedPageId, notify, t]);

  return useMemo(() => ({
    quickAction,
    runQuickImport,
    product,
    setProduct,
    openProduct,
    saveProduct,
    ai,
    setAi,
    openAi,
    runAi,
    campaign,
    setCampaign,
    openCampaign,
    createCampaign,
    schedule,
    setSchedule,
    openSchedule,
    scheduleAgain,
    history,
    setHistory,
    openHistory,
  }), [
    ai,
    campaign,
    createCampaign,
    history,
    openAi,
    openCampaign,
    openHistory,
    openProduct,
    openSchedule,
    product,
    quickAction,
    runAi,
    runQuickImport,
    saveProduct,
    schedule,
    scheduleAgain,
  ]);
};

export const useFacebookCommentWorkflows = ({
  adapter,
  linkedPageId,
  setReplyTexts,
  setSnackbar,
  t,
}) => {
  const [templates, setTemplates] = useState([]);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateForm, setTemplateForm] = useState({ id: null, name: '', body: '' });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [followups, setFollowups] = useState({});
  const [suggesting, setSuggesting] = useState({});

  const notify = useCallback((message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  }, [setSnackbar]);

  const loadTemplates = useCallback(async () => {
    if (!linkedPageId) return setTemplates([]);
    try {
      const rows = await adapter.getTemplates(linkedPageId);
      setTemplates(Array.isArray(rows) ? rows : []);
    } catch {
      setTemplates([]);
    }
  }, [adapter, linkedPageId]);

  const loadFollowups = useCallback(async () => {
    if (!linkedPageId) return setFollowups({});
    try {
      const response = await adapter.getFollowups({
        linked_page_id: linkedPageId,
        status: 'open',
        limit: 200,
      });
      setFollowups(Object.fromEntries(
        (response.followups || []).map(row => [row.comment_id, row])
      ));
    } catch {
      setFollowups({});
    }
  }, [adapter, linkedPageId]);

  useEffect(() => {
    loadTemplates();
    loadFollowups();
  }, [loadFollowups, loadTemplates]);

  const applyTemplate = useCallback((commentId, body) => {
    setReplyTexts(current => ({ ...current, [commentId]: body }));
  }, [setReplyTexts]);

  const suggestReply = useCallback(async (comment, post) => {
    try {
      setSuggesting(current => ({ ...current, [comment.id]: true }));
      const response = await adapter.generateAi({
        linked_page_id: linkedPageId,
        source_post_id: post.id,
        source_post_url: post.permalink_url || null,
        input_text: [
          `${t('facebookContent.commentForSuggestion')}: ${comment.message || ''}`,
          `${t('facebookContent.postContextForSuggestion')}: ${post.message || ''}`,
        ].join('\n'),
        action: 'comment_reply',
        variants: 1,
        create_items: false,
      });
      const variant = response.variants?.[0];
      const reply = [variant?.body, variant?.cta].filter(Boolean).join(' ').trim();
      if (reply) applyTemplate(comment.id, reply);
      notify(t('facebookContent.messages.replySuggested'), 'success');
    } catch (error) {
      notify(error.message || t('facebookContent.messages.replySuggestionFailed'), 'error');
    } finally {
      setSuggesting(current => ({ ...current, [comment.id]: false }));
    }
  }, [adapter, applyTemplate, linkedPageId, notify, t]);

  const toggleFollowup = useCallback(async (comment, post) => {
    const current = followups[comment.id];
    try {
      const row = await adapter.updateFollowup(comment.id, {
        linked_page_id: linkedPageId,
        post_id: post.id,
        status: current ? 'resolved' : 'open',
      });
      setFollowups(values => {
        const next = { ...values };
        if (row.status === 'open') next[comment.id] = row;
        else delete next[comment.id];
        return next;
      });
      notify(
        current
          ? t('facebookContent.messages.followupResolved')
          : t('facebookContent.messages.followupAdded'),
        'success',
      );
    } catch (error) {
      notify(error.message || t('facebookContent.messages.followupFailed'), 'error');
    }
  }, [adapter, followups, linkedPageId, notify, t]);

  const saveTemplate = useCallback(async () => {
    if (!templateForm.name.trim() || !templateForm.body.trim()) return;
    try {
      setTemplateSaving(true);
      if (templateForm.id) {
        await adapter.updateTemplate(templateForm.id, {
          linked_page_id: linkedPageId,
          name: templateForm.name,
          body: templateForm.body,
        });
      } else {
        await adapter.createTemplate({
          linked_page_id: linkedPageId,
          name: templateForm.name,
          body: templateForm.body,
        });
      }
      setTemplateForm({ id: null, name: '', body: '' });
      await loadTemplates();
      notify(t('facebookContent.messages.replyTemplateSaved'), 'success');
    } catch (error) {
      notify(error.message || t('facebookContent.messages.replyTemplateFailed'), 'error');
    } finally {
      setTemplateSaving(false);
    }
  }, [adapter, linkedPageId, loadTemplates, notify, t, templateForm]);

  const deleteTemplate = useCallback(async template => {
    try {
      await adapter.deleteTemplate(template.id);
      await loadTemplates();
      notify(t('facebookContent.messages.replyTemplateDeleted'), 'success');
    } catch (error) {
      notify(error.message || t('facebookContent.messages.replyTemplateDeleteFailed'), 'error');
    }
  }, [adapter, loadTemplates, notify, t]);

  return {
    templates,
    templateDialog,
    setTemplateDialog,
    templateForm,
    setTemplateForm,
    templateSaving,
    followups,
    suggesting,
    applyTemplate,
    suggestReply,
    toggleFollowup,
    saveTemplate,
    deleteTemplate,
  };
};
