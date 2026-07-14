import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { decrypt } from '../services/encryption.js';
import { readMetaResponse, sendMetaFailure } from '../services/metaHttp.js';

const router = express.Router();

const resolvePageCredentials = (linkedPageId, tenantId = null) => {
    const page = tenantId
        ? db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND tenant_id = ? AND is_active = 1')
            .get(linkedPageId, tenantId)
        : db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
    if (!page) return { error: 'الصفحة غير موجودة أو غير مفعلة', status: 404 };
    const accessToken = decrypt(page.page_access_token_encrypted);
    if (!accessToken) return { error: 'رمز الوصول غير صالح', status: 400 };
    return { page, accessToken };
};

const safeMetricValue = (insightsData, metricName, period = 'days_28') => {
    const metric = (insightsData || []).find(m => m.name === metricName);
    if (!metric || !metric.values || metric.values.length === 0) return null;
    const periodValue = metric.values.find(v => v.period === period) || metric.values[0];
    return periodValue?.value ?? null;
};

const normalizeMetricNumber = (value) => {
    if (typeof value === 'number') return value;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + (Number(item) || 0), 0);
    return null;
};

const POST_ENGAGEMENT_FIELDS = [
    'id',
    'message',
    'created_time',
    'full_picture',
    'permalink_url',
    'likes.limit(0).summary(true)',
    'comments.limit(0).summary(true)',
    'reactions.limit(0).summary(true)',
    'shares',
].join(',');

const summaryCount = (edge) => Number(edge?.summary?.total_count || 0);

const extractPostEngagement = (post) => ({
    likes: summaryCount(post.likes),
    comments: summaryCount(post.comments),
    reactions: summaryCount(post.reactions),
    shares: Number(post.shares?.count || 0),
});

const fetchRecentPostEngagement = async (pageId, accessToken, days = 28) => {
    const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const response = await fetch(
        `${META_API_BASE}/${pageId}/posts?fields=${encodeURIComponent(POST_ENGAGEMENT_FIELDS)}&limit=100&since=${since}&access_token=${accessToken}`
    );
    const metaResult = await readMetaResponse(response);
    const data = metaResult.data || {};

    if (!metaResult.ok) {
        return {
            totals: { likes: null, comments: null, reactions: null, shares: null, posts: 0 },
            error: metaResult.error?.message || 'تعذر جلب تفاعل المنشورات من Meta',
        };
    }

    const totals = (data.data || []).reduce((acc, post) => {
        const engagement = extractPostEngagement(post);
        acc.likes += engagement.likes;
        acc.comments += engagement.comments;
        acc.reactions += engagement.reactions;
        acc.shares += engagement.shares;
        acc.posts += 1;
        return acc;
    }, { likes: 0, comments: 0, reactions: 0, shares: 0, posts: 0 });

    return { totals, error: null };
};

// ============================================
// Page KPI overview
// ============================================
router.get('/:linkedPageId/overview', async (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        // Fetch page metadata
        const metaResponse = await fetch(
            `${META_API_BASE}/${page.page_id}?fields=name,followers_count,fan_count,talking_about_count,picture.width(100).height(100)&access_token=${accessToken}`
        );
        const pageResult = await readMetaResponse(metaResponse);
        const metaData = pageResult.data || {};

        if (!pageResult.ok) {
            return sendMetaFailure(res, pageResult, 'فشل جلب بيانات الصفحة');
        }

        // Fetch 28-day insights
        const insightsResponse = await fetch(
            `${META_API_BASE}/${page.page_id}/insights?metric=page_views_total,page_actions_post_reactions_total,page_video_views&period=days_28&access_token=${accessToken}`
        );
        const insightsResult = await readMetaResponse(insightsResponse);
        const insightsData = insightsResult.data || {};
        const insightsError = insightsResult.ok
            ? null
            : (insightsResult.error?.message || 'تعذر جلب بعض مؤشرات الصفحة من Meta');

        const insights = insightsResult.ok ? (insightsData.data || []) : [];
        const recentEngagement = await fetchRecentPostEngagement(page.page_id, accessToken, 28);
        const insightReactions = safeMetricValue(insights, 'page_actions_post_reactions_total', 'days_28');

        const metrics = {
            views_28d: safeMetricValue(insights, 'page_views_total', 'days_28'),
            reactions_28d: insightReactions ?? recentEngagement.totals.reactions,
            video_views_28d: safeMetricValue(insights, 'page_video_views', 'days_28'),
            post_likes_28d: recentEngagement.totals.likes,
            post_comments_28d: recentEngagement.totals.comments,
            post_shares_28d: recentEngagement.totals.shares,
            posts_count_28d: recentEngagement.totals.posts,
        };

        res.json({
            page: {
                name: metaData.name || page.page_name,
                followers_count: metaData.followers_count ?? metaData.fan_count ?? 0,
                talking_about_count: metaData.talking_about_count ?? 0,
                picture: metaData.picture?.data?.url || page.page_picture_url || null,
            },
            metrics,
            insights_error: insightsError || recentEngagement.error,
        });
    } catch (err) {
        console.error('[FBInsights] Overview error:', err);
        res.status(500).json({ error: 'فشل جلب بيانات التحليلات' });
    }
});

// ============================================
// Daily metrics
// ============================================
router.get('/:linkedPageId/daily', async (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const { since, until } = req.query;

        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        const untilDate = until || new Date().toISOString().split('T')[0];
        const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/insights?metric=page_views_total,page_actions_post_reactions_total,page_video_views&period=day&since=${sinceDate}&until=${untilDate}&access_token=${accessToken}`
        );
        const metaResult = await readMetaResponse(response);
        const data = metaResult.data || {};

        if (!metaResult.ok) {
            return res.json({
                daily: [],
                insights_error: metaResult.error?.message || 'تعذر جلب البيانات اليومية من Meta',
                details: metaResult.error,
            });
        }

        // Normalize: Meta returns one array per metric, we merge by date
        const dailyMap = {};

        for (const metric of (data.data || [])) {
            for (const entry of (metric.values || [])) {
                const date = (entry.end_time || entry.value?.end_time || '').split('T')[0];
                if (!date) continue;
                if (!dailyMap[date]) {
                    dailyMap[date] = { date, views: 0, reactions: 0, video_views: 0 };
                }
                const value = normalizeMetricNumber(entry.value);
                if (metric.name === 'page_views_total') dailyMap[date].views += value || 0;
                if (metric.name === 'page_actions_post_reactions_total') dailyMap[date].reactions += value || 0;
                if (metric.name === 'page_video_views') dailyMap[date].video_views += value || 0;
            }
        }

        const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

        res.json({ daily, insights_error: null });
    } catch (err) {
        console.error('[FBInsights] Daily error:', err);
        res.status(500).json({ error: 'فشل جلب البيانات اليومية' });
    }
});

// ============================================
// Per-post performance
// ============================================
router.get('/:linkedPageId/posts', async (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 25, 25);

        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId, req.user?.tenant_id);
        if (error) return res.status(status).json({ error });

        // Fetch posts
        const postsResponse = await fetch(
            `${META_API_BASE}/${page.page_id}/posts?fields=${encodeURIComponent(POST_ENGAGEMENT_FIELDS)}&limit=${limit}&access_token=${accessToken}`
        );
        const postsResult = await readMetaResponse(postsResponse);
        const postsData = postsResult.data || {};

        if (!postsResult.ok) {
            return sendMetaFailure(res, postsResult, 'فشل جلب المنشورات');
        }

        const posts = postsData.data || [];
        const insightsLimit = Math.min(posts.length, 10);

        // Fetch insights for the most recent posts (max 10)
        const postsWithInsights = await Promise.all(posts.map(async (post, i) => {
            const postEntry = {
                id: post.id,
                message: post.message || '',
                created_time: post.created_time || null,
                full_picture: post.full_picture || null,
                permalink_url: post.permalink_url || null,
                engagement: extractPostEngagement(post),
                insights: { clicks: null },
            };

            if (i < insightsLimit) {
                try {
                    const insightsResponse = await fetch(
                        `${META_API_BASE}/${post.id}/insights?metric=post_reactions_by_type_total,post_clicks&period=lifetime&access_token=${accessToken}`
                    );
                    const insightsResult = await readMetaResponse(insightsResponse);
                    const insightsData = insightsResult.data || {};

                    if (insightsResult.ok && insightsData.data) {
                        const clicksMetric = insightsData.data.find(m => m.name === 'post_clicks');

                        let clicks = null;
                        if (clicksMetric?.values?.[0]?.value) {
                            clicks = clicksMetric.values[0].value;
                        }

                        postEntry.insights = { clicks };
                    } else {
                        postEntry.insights_error = insightsResult.error?.message || 'تعذر جلب مؤشرات المنشور';
                    }
                } catch (e) {
                    postEntry.insights_error = e.message || 'تعذر جلب مؤشرات المنشور';
                }
            }

            return postEntry;
        }));

        res.json({ posts: postsWithInsights, paging: postsData.paging || null });
    } catch (err) {
        console.error('[FBInsights] Posts error:', err);
        res.status(500).json({ error: 'فشل جلب أداء المنشورات' });
    }
});

export default router;
