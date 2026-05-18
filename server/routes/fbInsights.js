import express from 'express';
import db from '../db/database.js';
import { META_API_BASE } from '../config/index.js';
import { decrypt } from '../services/encryption.js';

const router = express.Router();

const resolvePageCredentials = (linkedPageId) => {
    const page = db.prepare('SELECT * FROM tenant_pages WHERE id = ? AND is_active = 1').get(linkedPageId);
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

const metaErrorMessage = (data, fallback) => data?.error?.message || fallback;

const normalizeMetricNumber = (value) => {
    if (typeof value === 'number') return value;
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + (Number(item) || 0), 0);
    return null;
};

// ============================================
// Page KPI overview
// ============================================
router.get('/:linkedPageId/overview', async (req, res) => {
    try {
        const { linkedPageId } = req.params;
        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId);
        if (error) return res.status(status).json({ error });

        // Fetch page metadata
        const metaResponse = await fetch(
            `${META_API_BASE}/${page.page_id}?fields=name,followers_count,fan_count,talking_about_count,picture.width(100).height(100)&access_token=${accessToken}`
        );
        const metaData = await metaResponse.json();

        if (!metaResponse.ok) {
            return res.status(metaResponse.status).json({ error: metaData.error?.message || 'فشل جلب بيانات الصفحة', details: metaData.error });
        }

        // Fetch 28-day insights
        const insightsResponse = await fetch(
            `${META_API_BASE}/${page.page_id}/insights?metric=page_views_total,page_actions_post_reactions_total,page_video_views&period=days_28&access_token=${accessToken}`
        );
        const insightsData = await insightsResponse.json();
        const insightsError = insightsResponse.ok
            ? null
            : metaErrorMessage(insightsData, 'تعذر جلب بعض مؤشرات الصفحة من Meta');

        const insights = insightsResponse.ok ? (insightsData.data || []) : [];

        const metrics = {
            views_28d: safeMetricValue(insights, 'page_views_total', 'days_28'),
            reactions_28d: safeMetricValue(insights, 'page_actions_post_reactions_total', 'days_28'),
            video_views_28d: safeMetricValue(insights, 'page_video_views', 'days_28'),
        };

        res.json({
            page: {
                name: metaData.name || page.page_name,
                followers_count: metaData.followers_count ?? metaData.fan_count ?? 0,
                talking_about_count: metaData.talking_about_count ?? 0,
                picture: metaData.picture?.data?.url || page.page_picture_url || null,
            },
            metrics,
            insights_error: insightsError,
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

        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId);
        if (error) return res.status(status).json({ error });

        const untilDate = until || new Date().toISOString().split('T')[0];
        const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const response = await fetch(
            `${META_API_BASE}/${page.page_id}/insights?metric=page_views_total,page_actions_post_reactions_total,page_video_views&period=day&since=${sinceDate}&until=${untilDate}&access_token=${accessToken}`
        );
        const data = await response.json();

        if (!response.ok) {
            return res.json({
                daily: [],
                insights_error: metaErrorMessage(data, 'تعذر جلب البيانات اليومية من Meta'),
                details: data.error || null,
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

        const { page, accessToken, error, status } = resolvePageCredentials(linkedPageId);
        if (error) return res.status(status).json({ error });

        // Fetch posts
        const postsResponse = await fetch(
            `${META_API_BASE}/${page.page_id}/posts?fields=id,message,created_time,full_picture,permalink_url&limit=${limit}&access_token=${accessToken}`
        );
        const postsData = await postsResponse.json();

        if (!postsResponse.ok) {
            return res.status(postsResponse.status).json({ error: postsData.error?.message || 'فشل جلب المنشورات', details: postsData.error });
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
                insights: null,
            };

            if (i < insightsLimit) {
                try {
                    const insightsResponse = await fetch(
                        `${META_API_BASE}/${post.id}/insights?metric=post_reactions_by_type_total,post_clicks&period=lifetime&access_token=${accessToken}`
                    );
                    const insightsData = await insightsResponse.json();

                    if (insightsResponse.ok && insightsData.data) {
                        const reactionsMetric = insightsData.data.find(m => m.name === 'post_reactions_by_type_total');
                        const clicksMetric = insightsData.data.find(m => m.name === 'post_clicks');

                        let reactions = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0, total: 0 };
                        if (reactionsMetric?.values?.[0]?.value) {
                            const rv = reactionsMetric.values[0].value;
                            reactions = {
                                like: rv.like || 0,
                                love: rv.love || 0,
                                haha: rv.haha || 0,
                                wow: rv.wow || 0,
                                sad: rv.sad || 0,
                                angry: rv.angry || 0,
                                total: Object.values(rv).reduce((s, v) => s + (v || 0), 0),
                            };
                        }

                        let clicks = 0;
                        if (clicksMetric?.values?.[0]?.value) {
                            clicks = clicksMetric.values[0].value;
                        }

                        postEntry.insights = { reactions, clicks };
                    } else {
                        postEntry.insights_error = metaErrorMessage(insightsData, 'تعذر جلب مؤشرات المنشور');
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
