import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    Grid,
    IconButton,
    MenuItem,
    Paper,
    Snackbar,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    Delete as DeleteIcon,
    Edit as EditIcon,
    Inventory2 as ProductIcon,
    PlayArrow as TestIcon,
    Refresh as RefreshIcon,
    SmartToy as BotIcon,
    UploadFile as UploadIcon,
} from '@mui/icons-material';
import api from '../../api';

const emptyProduct = {
    sku: '',
    name: '',
    description: '',
    price: 0,
    currency: 'LYD',
    image_url: '',
    images: [],
    product_url: '',
    category: '',
    availability: 'available',
    is_active: true,
};

const nodeTypeLabels = {
    text: 'نص',
    quick_replies: 'أزرار سريعة',
    product_list: 'قائمة منتجات',
    product_detail: 'تفاصيل منتج',
    service_menu: 'قائمة خدمات',
    handoff: 'تحويل لموظف',
    end: 'إنهاء',
};

const triggerLabels = {
    welcome: 'أول رسالة',
    keyword: 'كلمة مفتاحية',
    postback: 'Postback',
    fallback: 'Fallback',
    menu: 'القائمة الرئيسية',
};

const triggerHelp = {
    welcome: 'يعمل عند أول رسالة من مستخدم جديد أو عند بداية جلسة جديدة.',
    keyword: 'يطابق النص المكتوب. يمكن إدخال عدة كلمات مفصولة بفواصل أو أسطر.',
    postback: 'يعمل عند وصول payload من زر Messenger أو من زر داخل مسار آخر.',
    fallback: 'يعمل عندما لا يوجد مسار أو منتج مطابق لرسالة المستخدم.',
    menu: 'يعمل عند ضغط زر القائمة الرئيسية داخل ردود البوت.',
};

const actionLabels = {
    products: 'فتح المنتجات',
    node: 'الانتقال لخطوة',
    handoff: 'تحويل لموظف',
    menu: 'القائمة الرئيسية',
    custom: 'Payload مخصص',
};

const emptyNode = (index = 0) => ({
    node_key: index === 0 ? 'start' : `step_${index + 1}`,
    node_type: 'text',
    title: '',
    body: '',
    category: '',
    empty_text: '',
    limit: 10,
    include_menu: true,
    include_products_reply: false,
    include_handoff_reply: true,
    reply_display: 'quick_replies',
    menu_label: 'القائمة الرئيسية',
    products_reply_label: 'منتجات أخرى',
    handoff_reply_label: 'موظف بشري',
    card_action_label: 'اختيار',
    card_show_image: true,
    card_show_price: true,
    card_show_description: true,
    card_show_category: false,
    card_show_sku: false,
    card_show_details_button: true,
    card_show_inquiry_button: true,
    card_show_link_button: true,
    card_details_label: 'تفاصيل',
    card_inquiry_label: 'استفسار',
    card_link_label: 'فتح الرابط',
    detail_show_images: true,
    detail_show_price: true,
    detail_show_description: true,
    detail_show_category: false,
    detail_show_sku: false,
    detail_show_link_text: true,
    detail_show_link_button: true,
    detail_show_inquiry_button: true,
    detail_include_menu: true,
    detail_include_products_reply: true,
    detail_menu_label: 'القائمة الرئيسية',
    detail_products_label: 'منتجات أخرى',
    detail_inquiry_label: 'استفسار',
    detail_link_label: 'فتح الرابط',
    buttons: [],
});

const emptyButton = {
    title: '',
    subtitle: '',
    action: 'menu',
    category: '',
    node_key: '',
    custom_payload: '',
    image_url: '',
};

const emptyFlow = {
    id: null,
    name: '',
    linked_page_id: '',
    trigger_type: 'keyword',
    trigger_value: '',
    priority: 100,
    status: 'draft',
    description: '',
    nodes: [emptyNode(0)],
    diagnostics: null,
};

function parseConfig(value) {
    if (!value) return {};
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return {};
    }
}

function normalizePayloadAction(item = {}) {
    if (item.action) {
        return {
            title: item.title || '',
            subtitle: item.subtitle || item.description || '',
            action: item.action,
            category: item.category || '',
            node_key: item.node_key || '',
            custom_payload: item.custom_payload || item.payload || '',
            image_url: item.image_url || '',
        };
    }

    const payload = String(item.payload || '').trim();
    if (payload === 'BOT:PRODUCTS') return { ...emptyButton, title: item.title || '', subtitle: item.subtitle || '', action: 'products' };
    if (payload.startsWith('BOT:PRODUCTS:')) {
        return { ...emptyButton, title: item.title || '', subtitle: item.subtitle || '', action: 'products', category: payload.split(':').slice(2).join(':'), image_url: item.image_url || '' };
    }
    if (payload.startsWith('BOT:NODE:')) {
        return { ...emptyButton, title: item.title || '', subtitle: item.subtitle || '', action: 'node', node_key: payload.split(':')[2] || '', image_url: item.image_url || '' };
    }
    if (payload.startsWith('BOT:HANDOFF')) return { ...emptyButton, title: item.title || '', subtitle: item.subtitle || '', action: 'handoff', image_url: item.image_url || '' };
    if (payload === 'BOT:MENU') return { ...emptyButton, title: item.title || '', subtitle: item.subtitle || '', action: 'menu', image_url: item.image_url || '' };
    return { ...emptyButton, title: item.title || '', subtitle: item.subtitle || '', action: 'custom', custom_payload: payload, image_url: item.image_url || '' };
}

function nodeToForm(node, index = 0) {
    const config = parseConfig(node?.config_json || node?.config);
    const buttons = config.quick_replies || config.items || [];
    return {
        ...emptyNode(index),
        node_key: node?.node_key || (index === 0 ? 'start' : `step_${index + 1}`),
        node_type: node?.node_type || 'text',
        title: node?.title || '',
        body: node?.body || '',
        category: config.category || '',
        empty_text: config.empty_text || '',
        limit: config.limit || 10,
        include_menu: config.include_menu !== false,
        include_products_reply: node?.node_type === 'service_menu'
            ? config.include_products_reply !== false
            : config.include_products_reply === true,
        include_handoff_reply: config.include_handoff_reply !== false,
        reply_display: config.reply_display === 'cards' ? 'cards' : 'quick_replies',
        menu_label: config.menu_label || 'القائمة الرئيسية',
        products_reply_label: config.products_reply_label || 'منتجات أخرى',
        handoff_reply_label: config.handoff_reply_label || 'موظف بشري',
        card_action_label: config.card_action_label || 'اختيار',
        card_show_image: config.card_show_image !== false,
        card_show_price: config.card_show_price !== false,
        card_show_description: config.card_show_description !== false,
        card_show_category: config.card_show_category === true,
        card_show_sku: config.card_show_sku === true,
        card_show_details_button: config.card_show_details_button !== false,
        card_show_inquiry_button: config.card_show_inquiry_button !== false,
        card_show_link_button: config.card_show_link_button !== false,
        card_details_label: config.card_details_label || 'تفاصيل',
        card_inquiry_label: config.card_inquiry_label || 'استفسار',
        card_link_label: config.card_link_label || 'فتح الرابط',
        detail_show_images: config.detail_show_images !== false,
        detail_show_price: config.detail_show_price !== false,
        detail_show_description: config.detail_show_description !== false,
        detail_show_category: config.detail_show_category === true,
        detail_show_sku: config.detail_show_sku === true,
        detail_show_link_text: config.detail_show_link_text !== false,
        detail_show_link_button: config.detail_show_link_button !== false,
        detail_show_inquiry_button: config.detail_show_inquiry_button !== false,
        detail_include_menu: config.detail_include_menu !== false,
        detail_include_products_reply: config.detail_include_products_reply !== false,
        detail_menu_label: config.detail_menu_label || 'القائمة الرئيسية',
        detail_products_label: config.detail_products_label || 'منتجات أخرى',
        detail_inquiry_label: config.detail_inquiry_label || 'استفسار',
        detail_link_label: config.detail_link_label || 'فتح الرابط',
        buttons: buttons.map(normalizePayloadAction),
    };
}

function flowToForm(flow) {
    const nodes = Array.isArray(flow?.nodes) && flow.nodes.length > 0
        ? flow.nodes
        : [flow?.node || {
            node_key: 'start',
            node_type: flow?.node_type || 'text',
            body: flow?.body || '',
            config_json: flow?.config_json,
        }];

    return {
        ...emptyFlow,
        id: flow?.id || null,
        name: flow?.name || '',
        linked_page_id: flow?.linked_page_id || '',
        trigger_type: flow?.trigger_type || 'keyword',
        trigger_value: flow?.trigger_value || '',
        priority: flow?.priority || 100,
        status: flow?.status || 'draft',
        description: flow?.description || '',
        nodes: nodes.map(nodeToForm),
        diagnostics: flow?.diagnostics || null,
    };
}

function buttonToPayload(button) {
    const title = String(button.title || '').trim();
    if (!title) return null;
    const action = button.action || 'menu';
    const result = { title, action };
    if (button.subtitle) result.subtitle = String(button.subtitle || '').trim();
    if (action === 'products') result.category = String(button.category || '').trim() || null;
    if (action === 'node') result.node_key = String(button.node_key || '').trim();
    if (action === 'custom') result.custom_payload = String(button.custom_payload || '').trim();
    if (button.image_url) result.image_url = String(button.image_url || '').trim();
    return result;
}

function buildFlowPayload(form) {
    return {
        name: form.name,
        linked_page_id: form.linked_page_id || null,
        trigger_type: form.trigger_type,
        trigger_value: form.trigger_value,
        priority: Number(form.priority) || 100,
        status: form.status,
        description: form.description,
        nodes: form.nodes.map((node, index) => {
            const buttons = node.buttons.map(buttonToPayload).filter(Boolean);
            const config = {
                include_menu: node.include_menu,
                include_products_reply: node.include_products_reply,
                include_handoff_reply: node.include_handoff_reply,
                reply_display: node.reply_display,
                menu_label: node.menu_label,
                products_reply_label: node.products_reply_label,
                handoff_reply_label: node.handoff_reply_label,
                card_action_label: node.card_action_label,
            };
            if (node.node_type === 'product_list') {
                config.category = node.category || null;
                config.limit = Number(node.limit) || 10;
                config.empty_text = node.empty_text || 'لا توجد منتجات متاحة حاليا.';
                config.card_show_image = node.card_show_image;
                config.card_show_price = node.card_show_price;
                config.card_show_description = node.card_show_description;
                config.card_show_category = node.card_show_category;
                config.card_show_sku = node.card_show_sku;
                config.card_show_details_button = node.card_show_details_button;
                config.card_show_inquiry_button = node.card_show_inquiry_button;
                config.card_show_link_button = node.card_show_link_button;
                config.card_details_label = node.card_details_label;
                config.card_inquiry_label = node.card_inquiry_label;
                config.card_link_label = node.card_link_label;
                config.detail_show_images = node.detail_show_images;
                config.detail_show_price = node.detail_show_price;
                config.detail_show_description = node.detail_show_description;
                config.detail_show_category = node.detail_show_category;
                config.detail_show_sku = node.detail_show_sku;
                config.detail_show_link_text = node.detail_show_link_text;
                config.detail_show_link_button = node.detail_show_link_button;
                config.detail_show_inquiry_button = node.detail_show_inquiry_button;
                config.detail_include_menu = node.detail_include_menu;
                config.detail_include_products_reply = node.detail_include_products_reply;
                config.detail_menu_label = node.detail_menu_label;
                config.detail_products_label = node.detail_products_label;
                config.detail_inquiry_label = node.detail_inquiry_label;
                config.detail_link_label = node.detail_link_label;
            }
            if (node.node_type === 'service_menu') {
                config.items = buttons;
            } else if (buttons.length > 0) {
                config.quick_replies = buttons;
            }

            return {
                node_key: node.node_key || (index === 0 ? 'start' : `step_${index + 1}`),
                node_type: node.node_type,
                title: node.title,
                body: node.body,
                sort_order: index,
                config,
            };
        }),
    };
}

function buildTemplate(templateKey) {
    if (templateKey === 'products') {
        return {
            ...emptyFlow,
            name: 'عرض المنتجات',
            trigger_type: 'keyword',
            trigger_value: 'منتجات, المنتجات, كتالوج',
            description: 'يعرض أحدث المنتجات أو منتجات تصنيف محدد.',
            nodes: [{ ...emptyNode(0), node_type: 'product_list', body: 'هذه المنتجات المتاحة حاليا.' }],
        };
    }
    if (templateKey === 'services') {
        return {
            ...emptyFlow,
            name: 'الخدمات',
            trigger_type: 'keyword',
            trigger_value: 'خدمات, مساعدة',
            description: 'قائمة خدمات موجهة بأزرار واضحة.',
            nodes: [{
                ...emptyNode(0),
                node_type: 'service_menu',
                include_products_reply: true,
                body: 'اختر الخدمة المناسبة.',
                buttons: [
                    { ...emptyButton, title: 'عرض المنتجات', action: 'products' },
                    { ...emptyButton, title: 'موظف بشري', action: 'handoff' },
                ],
            }],
        };
    }
    if (templateKey === 'fallback') {
        return {
            ...emptyFlow,
            name: 'رد افتراضي',
            trigger_type: 'fallback',
            trigger_value: '',
            description: 'يظهر عندما لا يفهم البوت رسالة المستخدم.',
            nodes: [{
                ...emptyNode(0),
                node_type: 'quick_replies',
                body: 'لم أفهم طلبك بدقة. اختر أحد الخيارات.',
                buttons: [
                    { ...emptyButton, title: 'المنتجات', action: 'products' },
                    { ...emptyButton, title: 'موظف بشري', action: 'handoff' },
                ],
            }],
        };
    }
    if (templateKey === 'handoff') {
        return {
            ...emptyFlow,
            name: 'تحويل لموظف',
            trigger_type: 'keyword',
            trigger_value: 'موظف, دعم, تواصل',
            description: 'يوقف البوت ويحول المحادثة للموظف.',
            nodes: [{ ...emptyNode(0), node_type: 'handoff', body: 'تم تحويلك إلى أحد الموظفين.' }],
        };
    }
    return {
        ...emptyFlow,
        name: 'ترحيب',
        trigger_type: 'welcome',
        trigger_value: '',
        description: 'مسار البداية للمستخدم الجديد.',
        nodes: [{
            ...emptyNode(0),
            node_type: 'service_menu',
            include_products_reply: true,
            body: 'مرحبا، كيف يمكننا مساعدتك؟',
            buttons: [
                { ...emptyButton, title: 'عرض المنتجات', action: 'products' },
                { ...emptyButton, title: 'الخدمات', action: 'node', node_key: 'services' },
                { ...emptyButton, title: 'موظف بشري', action: 'handoff' },
            ],
        }, {
            ...emptyNode(1),
            node_key: 'services',
            node_type: 'quick_replies',
            body: 'اختر نوع الخدمة.',
            buttons: [
                { ...emptyButton, title: 'المنتجات', action: 'products' },
                { ...emptyButton, title: 'موظف بشري', action: 'handoff' },
            ],
        }],
    };
}

function getClientDiagnostics(form, pages, flows, products) {
    const errors = [];
    const warnings = [];
    const nodeKeys = form.nodes.map(node => String(node.node_key || '').trim()).filter(Boolean);
    const duplicateKeys = nodeKeys.filter((key, index) => nodeKeys.indexOf(key) !== index);

    if (!form.name.trim()) errors.push('اسم المسار مطلوب.');
    if (!nodeKeys.includes('start')) errors.push('يجب وجود خطوة start.');
    if (duplicateKeys.length > 0) errors.push(`يوجد تكرار في مفاتيح الخطوات: ${[...new Set(duplicateKeys)].join(', ')}`);
    if (form.status === 'active' && form.linked_page_id && !pages.some(page => String(page.id) === String(form.linked_page_id))) {
        errors.push('الصفحة المحددة غير مفعلة أو غير موجودة.');
    }
    if (form.status === 'active' && form.trigger_type === 'keyword' && !form.trigger_value.trim()) {
        errors.push('المسار النشط بالكلمة المفتاحية يحتاج كلمة أو أكثر.');
    }
    if (form.status === 'active' && form.trigger_type === 'postback' && !form.trigger_value.trim()) {
        errors.push('مسار postback النشط يحتاج payload واضح.');
    }
    if (pages.length === 0) warnings.push('لا توجد صفحات Messenger مفعلة لهذا العميل.');

    form.nodes.forEach(node => {
        if (node.node_type === 'product_list') {
            const hasProducts = products.some(product => {
                if (!product.is_active || product.availability !== 'available') return false;
                return !node.category || String(product.category || '').toLowerCase() === String(node.category).toLowerCase();
            });
            if (!hasProducts) warnings.push(`الخطوة ${node.node_key} تعرض منتجات لكن لا توجد منتجات متاحة مطابقة.`);
        }
        node.buttons.forEach(button => {
            if (!button.title.trim()) warnings.push(`يوجد زر بدون عنوان في الخطوة ${node.node_key}.`);
            if (button.action === 'node' && !nodeKeys.includes(button.node_key)) {
                errors.push(`زر "${button.title || 'بدون عنوان'}" يشير إلى خطوة غير موجودة: ${button.node_key || 'غير محدد'}.`);
            }
            if (button.action === 'custom' && !button.custom_payload.trim()) {
                errors.push(`زر "${button.title || 'بدون عنوان'}" يحتاج payload مخصص.`);
            }
        });
    });

    const normalizedTrigger = ['welcome', 'fallback', 'menu'].includes(form.trigger_type)
        ? ''
        : form.trigger_value.trim().toLowerCase();
    const conflict = flows.find(flow => (
        String(flow.id) !== String(form.id || '')
        && flow.status === 'active'
        && form.status === 'active'
        && flow.trigger_type === form.trigger_type
        && String(flow.trigger_value || '').trim().toLowerCase() === normalizedTrigger
        && String(flow.linked_page_id || '') === String(form.linked_page_id || '')
        && Number(flow.priority || 100) === Number(form.priority || 100)
    ));
    if (conflict) warnings.push(`تعارض محتمل مع المسار النشط: ${conflict.name}.`);

    return { ready: errors.length === 0, errors, warnings };
}

const StatBox = ({ title, value, color = 'primary' }) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
        <Typography variant="caption" color="text.secondary">{title}</Typography>
        <Typography variant="h5" fontWeight={800} color={`${color}.main`}>{value}</Typography>
    </Paper>
);

const DiagnosticsPanel = ({ diagnostics }) => (
    <Stack spacing={1}>
        <Alert severity={diagnostics.ready ? 'success' : 'error'}>
            {diagnostics.ready ? 'المسار قابل للحفظ والتفعيل من ناحية البنية.' : 'يجب معالجة الأخطاء قبل التفعيل.'}
        </Alert>
        {diagnostics.errors.map(error => <Alert key={error} severity="error">{error}</Alert>)}
        {diagnostics.warnings.map(warning => <Alert key={warning} severity="warning">{warning}</Alert>)}
    </Stack>
);

const MessengerBotManager = ({ tenantMode = false }) => {
    const [tab, setTab] = useState(0);
    const [tenants, setTenants] = useState([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [summary, setSummary] = useState(null);
    const [products, setProducts] = useState([]);
    const [flows, setFlows] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [flowEvents, setFlowEvents] = useState([]);
    const [selectedEventsFlow, setSelectedEventsFlow] = useState(null);
    const [loading, setLoading] = useState(true);
    const [productDialog, setProductDialog] = useState(false);
    const [flowDialog, setFlowDialog] = useState(false);
    const [productForm, setProductForm] = useState(emptyProduct);
    const [flowForm, setFlowForm] = useState(emptyFlow);
    const [preview, setPreview] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const tenantId = tenantMode ? null : selectedTenantId;
    const pages = useMemo(() => summary?.pages || [], [summary?.pages]);
    const performance = summary?.performance || {};
    const selectedTenantReady = tenantMode || Boolean(selectedTenantId);
    const diagnostics = useMemo(
        () => getClientDiagnostics(flowForm, pages, flows, products),
        [flowForm, pages, flows, products]
    );

    useEffect(() => {
        if (tenantMode) return;
        api.getTenants()
            .then(data => {
                const rows = Array.isArray(data) ? data : [];
                setTenants(rows);
                if (rows.length > 0) setSelectedTenantId(String(rows[0].id));
            })
            .catch(err => setSnackbar({ open: true, message: err.message || 'فشل جلب العملاء', severity: 'error' }));
    }, [tenantMode]);

    const botApi = useMemo(() => ({
        summary: () => tenantMode ? api.getPortalMessengerBotSummary() : api.getMessengerBotSummary(tenantId),
        products: () => tenantMode ? api.getPortalMessengerBotProducts() : api.getMessengerBotProducts(tenantId),
        flows: () => tenantMode ? api.getPortalMessengerBotFlows() : api.getMessengerBotFlows(tenantId),
        sessions: () => tenantMode ? api.getPortalMessengerBotSessions() : api.getMessengerBotSessions(tenantId),
        flowEvents: flowId => tenantMode ? api.getPortalMessengerBotFlowEvents(flowId) : api.getMessengerBotFlowEvents(tenantId, flowId),
    }), [tenantMode, tenantId]);

    const loadAll = useCallback(async () => {
        if (!selectedTenantReady) return;
        try {
            setLoading(true);
            const [summaryData, productData, flowData, sessionData] = await Promise.all([
                botApi.summary(),
                botApi.products(),
                botApi.flows(),
                botApi.sessions(),
            ]);
            setSummary(summaryData);
            setProducts(Array.isArray(productData) ? productData : []);
            setFlows(Array.isArray(flowData) ? flowData : []);
            setSessions(Array.isArray(sessionData) ? sessionData : []);
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تحميل بيانات البوت', severity: 'error' });
        } finally {
            setLoading(false);
        }
    }, [botApi, selectedTenantReady]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const loadFlowEvents = async (flow) => {
        try {
            const events = await botApi.flowEvents(flow.id);
            setSelectedEventsFlow(flow);
            setFlowEvents(Array.isArray(events) ? events : []);
            setTab(3);
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل جلب سجل المسار', severity: 'error' });
        }
    };

    const saveProduct = async () => {
        try {
            if (!productForm.name.trim()) {
                setSnackbar({ open: true, message: 'اسم المنتج مطلوب', severity: 'warning' });
                return;
            }
            if (productForm.id) {
                if (tenantMode) await api.updatePortalMessengerBotProduct(productForm.id, productForm);
                else await api.updateMessengerBotProduct(tenantId, productForm.id, productForm);
            } else if (tenantMode) {
                await api.createPortalMessengerBotProduct(productForm);
            } else {
                await api.createMessengerBotProduct(tenantId, productForm);
            }
            setProductDialog(false);
            setSnackbar({ open: true, message: 'تم حفظ المنتج', severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حفظ المنتج', severity: 'error' });
        }
    };

    const deleteProduct = async (product) => {
        try {
            if (tenantMode) await api.deletePortalMessengerBotProduct(product.id);
            else await api.deleteMessengerBotProduct(tenantId, product.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حذف المنتج', severity: 'error' });
        }
    };

    const importProducts = async (file) => {
        if (!file) return;
        try {
            const result = tenantMode
                ? await api.importPortalMessengerBotProducts(file)
                : await api.importMessengerBotProducts(tenantId, file);
            setSnackbar({ open: true, message: `تم استيراد ${result.imported || 0} منتج`, severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل استيراد المنتجات', severity: 'error' });
        }
    };

    const uploadAsset = async (file) => {
        if (!file) return null;
        const result = tenantMode
            ? await api.uploadPortalMessengerBotAsset(file)
            : await api.uploadMessengerBotAsset(tenantId, file);
        return result.url;
    };

    const uploadProductImages = async (files) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        try {
            const uploaded = await Promise.all(list.map(file => uploadAsset(file)));
            setProductForm(prev => {
                const current = prev.images || [];
                const images = [
                    ...current,
                    ...uploaded.filter(Boolean).map((url, index) => ({
                        image_url: url,
                        alt_text: prev.name || '',
                        sort_order: current.length + index,
                    })),
                ];
                return { ...prev, image_url: images[0]?.image_url || prev.image_url, images };
            });
            setSnackbar({ open: true, message: `تم رفع ${uploaded.filter(Boolean).length} صورة`, severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل رفع الصور', severity: 'error' });
        }
    };

    const addProductImageUrl = () => {
        const imageUrl = String(productForm.image_url || '').trim();
        if (!imageUrl) return;
        setProductForm(prev => {
            const exists = (prev.images || []).some(image => image.image_url === imageUrl);
            const images = exists
                ? prev.images
                : [...(prev.images || []), { image_url: imageUrl, alt_text: prev.name || '', sort_order: prev.images?.length || 0 }];
            return { ...prev, image_url: images[0]?.image_url || imageUrl, images };
        });
    };

    const removeProductImage = (index) => {
        setProductForm(prev => {
            const images = (prev.images || []).filter((_, imageIndex) => imageIndex !== index);
            return { ...prev, image_url: images[0]?.image_url || '', images };
        });
    };

    const setPrimaryProductImage = (index) => {
        setProductForm(prev => {
            const images = [...(prev.images || [])];
            const [selected] = images.splice(index, 1);
            if (!selected) return prev;
            const nextImages = [selected, ...images].map((image, imageIndex) => ({ ...image, sort_order: imageIndex }));
            return { ...prev, image_url: nextImages[0]?.image_url || '', images: nextImages };
        });
    };

    const uploadButtonImage = async (nodeIndex, buttonIndex, file) => {
        try {
            const url = await uploadAsset(file);
            if (!url) return;
            updateButton(nodeIndex, buttonIndex, { image_url: url });
            setSnackbar({ open: true, message: 'تم رفع صورة الخيار', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل رفع صورة الخيار', severity: 'error' });
        }
    };

    const saveFlow = async () => {
        try {
            if (!diagnostics.ready && flowForm.status === 'active') {
                setSnackbar({ open: true, message: 'لا يمكن تفعيل المسار قبل معالجة الأخطاء', severity: 'warning' });
                return;
            }
            const payload = buildFlowPayload(flowForm);
            if (flowForm.id) {
                if (tenantMode) await api.updatePortalMessengerBotFlow(flowForm.id, payload);
                else await api.updateMessengerBotFlow(tenantId, flowForm.id, payload);
            } else if (tenantMode) {
                await api.createPortalMessengerBotFlow(payload);
            } else {
                await api.createMessengerBotFlow(tenantId, payload);
            }
            setFlowDialog(false);
            setPreview(null);
            setSnackbar({ open: true, message: 'تم حفظ المسار', severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حفظ المسار', severity: 'error' });
        }
    };

    const toggleFlow = async (flow) => {
        try {
            if (tenantMode) await api.togglePortalMessengerBotFlow(flow.id);
            else await api.toggleMessengerBotFlow(tenantId, flow.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تغيير حالة المسار', severity: 'error' });
        }
    };

    const deleteFlow = async (flow) => {
        try {
            if (tenantMode) await api.deletePortalMessengerBotFlow(flow.id);
            else await api.deleteMessengerBotFlow(tenantId, flow.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حذف المسار', severity: 'error' });
        }
    };

    const testFlow = async (flow) => {
        try {
            const result = tenantMode
                ? await api.testPortalMessengerBotFlow(flow.id)
                : await api.testMessengerBotFlow(tenantId, flow.id);
            setPreview(result.preview);
            setFlowDialog(true);
            setFlowForm(flowToForm(flow));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل اختبار المسار', severity: 'error' });
        }
    };

    const updateSession = async (session, status) => {
        try {
            if (tenantMode) await api.updatePortalMessengerBotSession(session.id, status);
            else await api.updateMessengerBotSession(tenantId, session.id, status);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تحديث الجلسة', severity: 'error' });
        }
    };

    const openProductDialog = (product = null) => {
        const images = product?.images?.length
            ? product.images
            : (product?.image_url ? [{ image_url: product.image_url, alt_text: product.name || '', sort_order: 0 }] : []);
        setProductForm(product ? { ...emptyProduct, ...product, images, image_url: images[0]?.image_url || product.image_url || '', is_active: Boolean(product.is_active) } : emptyProduct);
        setProductDialog(true);
    };

    const openFlowDialog = (flow = null) => {
        setPreview(null);
        setFlowForm(flow ? flowToForm(flow) : buildTemplate('welcome'));
        setFlowDialog(true);
    };

    const updateNode = (index, changes) => {
        setFlowForm(prev => ({
            ...prev,
            nodes: prev.nodes.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...changes } : node),
        }));
    };

    const addNode = () => {
        setFlowForm(prev => ({ ...prev, nodes: [...prev.nodes, emptyNode(prev.nodes.length)] }));
    };

    const removeNode = (index) => {
        setFlowForm(prev => ({
            ...prev,
            nodes: prev.nodes.filter((_, nodeIndex) => nodeIndex !== index),
        }));
    };

    const updateButton = (nodeIndex, buttonIndex, changes) => {
        setFlowForm(prev => ({
            ...prev,
            nodes: prev.nodes.map((node, index) => {
                if (index !== nodeIndex) return node;
                return {
                    ...node,
                    buttons: node.buttons.map((button, innerIndex) => (
                        innerIndex === buttonIndex ? { ...button, ...changes } : button
                    )),
                };
            }),
        }));
    };

    const addButton = (nodeIndex) => {
        setFlowForm(prev => ({
            ...prev,
            nodes: prev.nodes.map((node, index) => (
                index === nodeIndex
                    ? { ...node, buttons: [...node.buttons, { ...emptyButton }] }
                    : node
            )),
        }));
    };

    const removeButton = (nodeIndex, buttonIndex) => {
        setFlowForm(prev => ({
            ...prev,
            nodes: prev.nodes.map((node, index) => (
                index === nodeIndex
                    ? { ...node, buttons: node.buttons.filter((_, innerIndex) => innerIndex !== buttonIndex) }
                    : node
            )),
        }));
    };

    if (!tenantMode && tenants.length === 0) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="info">اختر عميلا أولا من إدارة العملاء لاستخدام Messenger Bot.</Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1500, mx: 'auto' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="h5" fontWeight={800} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <BotIcon color="primary" /> Messenger Bot
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        مسارات موجهة لعرض المنتجات والخدمات والتحويل لموظف عند الحاجة.
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                    {!tenantMode && (
                        <TextField
                            select
                            size="small"
                            label="العميل"
                            value={selectedTenantId}
                            onChange={e => setSelectedTenantId(e.target.value)}
                            sx={{ minWidth: 220 }}
                        >
                            {tenants.map(tenant => (
                                <MenuItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</MenuItem>
                            ))}
                        </TextField>
                    )}
                    <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadAll}>
                        تحديث
                    </Button>
                </Stack>
            </Stack>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>
            ) : (
                <>
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title="المنتجات النشطة" value={summary?.products?.active || 0} /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title="Flows فعالة" value={summary?.flows?.active || 0} color="success" /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title="Handoffs آخر 30 يوم" value={performance.handoffs || 0} color="warning" /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title="فشل إرسال البوت" value={performance.failed_sends || 0} color="error" /></Grid>
                    </Grid>

                    <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
                            <Tab label="المنتجات" />
                            <Tab label="المسارات" />
                            <Tab label="الجلسات" />
                            <Tab label="الأداء" />
                        </Tabs>
                        <Divider />

                        {tab === 0 && (
                            <Box sx={{ p: 2 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 2 }}>
                                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => openProductDialog()}>
                                        إضافة منتج
                                    </Button>
                                    <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                                        استيراد CSV
                                        <input hidden type="file" accept=".csv,text/csv" onChange={e => importProducts(e.target.files?.[0])} />
                                    </Button>
                                </Stack>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المنتج</TableCell>
                                            <TableCell>التصنيف</TableCell>
                                            <TableCell>السعر</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell align="right">إجراءات</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {products.map(product => (
                                            <TableRow key={product.id}>
                                                <TableCell>
                                                    <Stack direction="row" spacing={1} alignItems="center">
                                                        <ProductIcon fontSize="small" color="action" />
                                                        <Box>
                                                            <Typography variant="body2" fontWeight={700}>{product.name}</Typography>
                                                            <Typography variant="caption" color="text.secondary">{product.sku || product.description || 'بدون وصف'}</Typography>
                                                        </Box>
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>{product.category || 'عام'}</TableCell>
                                                <TableCell>{Number(product.price || 0).toLocaleString('ar-LY')} {product.currency}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        label={product.is_active ? product.availability : 'inactive'}
                                                        color={product.is_active && product.availability === 'available' ? 'success' : 'default'}
                                                    />
                                                </TableCell>
                                                <TableCell align="right">
                                                    <IconButton size="small" onClick={() => openProductDialog(product)}><EditIcon fontSize="small" /></IconButton>
                                                    <IconButton size="small" color="error" onClick={() => deleteProduct(product)}><DeleteIcon fontSize="small" /></IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {products.length === 0 && (
                                            <TableRow><TableCell colSpan={5} align="center">لا توجد منتجات بعد</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 1 && (
                            <Box sx={{ p: 2 }}>
                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }} alignItems={{ xs: 'stretch', md: 'center' }}>
                                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => openFlowDialog()}>
                                        إضافة مسار
                                    </Button>
                                    {['welcome', 'products', 'services', 'fallback', 'handoff'].map(templateKey => (
                                        <Button
                                            key={templateKey}
                                            variant="outlined"
                                            size="small"
                                            onClick={() => {
                                                setPreview(null);
                                                setFlowForm(buildTemplate(templateKey));
                                                setFlowDialog(true);
                                            }}
                                        >
                                            قالب {buildTemplate(templateKey).name}
                                        </Button>
                                    ))}
                                </Stack>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المسار</TableCell>
                                            <TableCell>المشغل</TableCell>
                                            <TableCell>الخطوات</TableCell>
                                            <TableCell>الصفحة</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell>الفحص</TableCell>
                                            <TableCell align="right">إجراءات</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {flows.map(flow => (
                                            <TableRow key={flow.id}>
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={700}>{flow.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">{flow.description || flow.body || '—'}</Typography>
                                                </TableCell>
                                                <TableCell>{triggerLabels[flow.trigger_type] || flow.trigger_type}{flow.trigger_value ? `: ${flow.trigger_value}` : ''}</TableCell>
                                                <TableCell>{flow.nodes_count || flow.nodes?.length || 1}</TableCell>
                                                <TableCell>{flow.page_name || 'كل الصفحات'}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={flow.status} color={flow.status === 'active' ? 'success' : 'default'} />
                                                </TableCell>
                                                <TableCell>
                                                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                                        {(flow.errors || []).length > 0 && <Chip size="small" color="error" label={`${flow.errors.length} خطأ`} />}
                                                        {(flow.warnings || []).length > 0 && <Chip size="small" color="warning" label={`${flow.warnings.length} تحذير`} />}
                                                        {!(flow.errors || []).length && !(flow.warnings || []).length && <Chip size="small" color="success" label="جاهز" />}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Button size="small" onClick={() => loadFlowEvents(flow)}>الأداء</Button>
                                                    <IconButton size="small" onClick={() => testFlow(flow)}><TestIcon fontSize="small" /></IconButton>
                                                    <IconButton size="small" onClick={() => openFlowDialog(flow)}><EditIcon fontSize="small" /></IconButton>
                                                    <Button size="small" onClick={() => toggleFlow(flow)}>{flow.status === 'active' ? 'إيقاف' : 'تفعيل'}</Button>
                                                    <IconButton size="small" color="error" onClick={() => deleteFlow(flow)}><DeleteIcon fontSize="small" /></IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {flows.length === 0 && (
                                            <TableRow><TableCell colSpan={7} align="center">لا توجد مسارات بعد</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 2 && (
                            <Box sx={{ p: 2 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المستخدم</TableCell>
                                            <TableCell>الصفحة</TableCell>
                                            <TableCell>Flow</TableCell>
                                            <TableCell>الخطوة</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell>آخر تحديث</TableCell>
                                            <TableCell align="right">إجراءات</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {sessions.map(session => (
                                            <TableRow key={session.id}>
                                                <TableCell>{session.user_name || session.user_psid}</TableCell>
                                                <TableCell>{session.page_name || session.linked_page_id}</TableCell>
                                                <TableCell>{session.flow_name || '—'}</TableCell>
                                                <TableCell>{session.current_node_key || '—'}</TableCell>
                                                <TableCell><Chip size="small" label={session.status} color={session.status === 'handoff' ? 'warning' : 'success'} /></TableCell>
                                                <TableCell>{session.updated_at}</TableCell>
                                                <TableCell align="right">
                                                    <Button size="small" onClick={() => updateSession(session, session.status === 'handoff' ? 'active' : 'handoff')}>
                                                        {session.status === 'handoff' ? 'إرجاع للبوت' : 'تحويل لموظف'}
                                                    </Button>
                                                    <Button size="small" color="inherit" onClick={() => updateSession(session, 'closed')}>إغلاق</Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {sessions.length === 0 && (
                                            <TableRow><TableCell colSpan={7} align="center">لا توجد جلسات بوت بعد</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 3 && (
                            <Box sx={{ p: 2 }}>
                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title="Handoffs" value={performance.handoffs || 0} color="warning" /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title="فشل الإرسال" value={performance.failed_sends || 0} color="error" /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title="فتح تفاصيل منتجات" value={performance.product_details || 0} color="info" /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title="صفحات Messenger" value={pages.length} color="secondary" /></Grid>
                                </Grid>
                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 5 }}>
                                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>أكثر المسارات استخداما</Typography>
                                            <Table size="small">
                                                <TableBody>
                                                    {(performance.top_flows || []).map(row => (
                                                        <TableRow key={`${row.flow_id}-${row.flow_name}`}>
                                                            <TableCell>{row.flow_name}</TableCell>
                                                            <TableCell align="right">{row.count}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                    {!(performance.top_flows || []).length && (
                                                        <TableRow><TableCell align="center">لا توجد بيانات بعد</TableCell></TableRow>
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </Paper>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 7 }}>
                                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                                                سجل المسار {selectedEventsFlow ? `- ${selectedEventsFlow.name}` : ''}
                                            </Typography>
                                            {!selectedEventsFlow && <Alert severity="info">اختر زر الأداء من جدول المسارات لعرض سجل تشغيل مسار محدد.</Alert>}
                                            {selectedEventsFlow && (
                                                <Table size="small">
                                                    <TableHead>
                                                        <TableRow>
                                                            <TableCell>الوقت</TableCell>
                                                            <TableCell>النوع</TableCell>
                                                            <TableCell>الحالة</TableCell>
                                                            <TableCell>المستخدم</TableCell>
                                                        </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                        {flowEvents.map(event => (
                                                            <TableRow key={event.id}>
                                                                <TableCell>{event.created_at}</TableCell>
                                                                <TableCell>{event.event_type}</TableCell>
                                                                <TableCell><Chip size="small" label={event.status} color={event.status === 'error' ? 'error' : 'default'} /></TableCell>
                                                                <TableCell>{event.user_name || event.user_psid || '—'}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                        {flowEvents.length === 0 && (
                                                            <TableRow><TableCell colSpan={4} align="center">لا يوجد سجل لهذا المسار</TableCell></TableRow>
                                                        )}
                                                    </TableBody>
                                                </Table>
                                            )}
                                        </Paper>
                                    </Grid>
                                </Grid>
                            </Box>
                        )}
                    </Paper>
                </>
            )}

            <Dialog open={productDialog} onClose={() => setProductDialog(false)} maxWidth="md" fullWidth>
                <DialogTitle>{productForm.id ? 'تعديل منتج' : 'إضافة منتج'}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="الاسم" value={productForm.name} onChange={e => setProductForm(prev => ({ ...prev, name: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="SKU" value={productForm.sku} onChange={e => setProductForm(prev => ({ ...prev, sku: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12 }}><TextField fullWidth multiline minRows={2} label="الوصف" value={productForm.description} onChange={e => setProductForm(prev => ({ ...prev, description: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth type="number" label="السعر" value={productForm.price} onChange={e => setProductForm(prev => ({ ...prev, price: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="العملة" value={productForm.currency} onChange={e => setProductForm(prev => ({ ...prev, currency: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label="التصنيف" value={productForm.category} onChange={e => setProductForm(prev => ({ ...prev, category: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12, md: 3 }}>
                            <TextField select fullWidth label="التوفر" value={productForm.availability} onChange={e => setProductForm(prev => ({ ...prev, availability: e.target.value }))}>
                                <MenuItem value="available">متاح</MenuItem>
                                <MenuItem value="out_of_stock">غير متوفر</MenuItem>
                                <MenuItem value="hidden">مخفي</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <TextField fullWidth label="رابط صورة" value={productForm.image_url} onChange={e => setProductForm(prev => ({ ...prev, image_url: e.target.value }))} />
                                <Button variant="outlined" onClick={addProductImageUrl} sx={{ minWidth: 96 }}>
                                    إضافة
                                </Button>
                                <Button variant="outlined" component="label" sx={{ minWidth: 120 }}>
                                    رفع صور
                                    <input hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadProductImages(e.target.files)} />
                                </Button>
                            </Stack>
                            {(productForm.images || []).length > 0 && (
                                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                                    {productForm.images.map((image, index) => (
                                        <Paper key={`${image.image_url}-${index}`} variant="outlined" sx={{ p: 0.5, borderRadius: 1, width: 118 }}>
                                            <Box component="img" src={image.image_url} alt="" sx={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 1 }} />
                                            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                                                <Button size="small" disabled={index === 0} onClick={() => setPrimaryProductImage(index)}>أولى</Button>
                                                <IconButton size="small" color="error" onClick={() => removeProductImage(index)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Stack>
                                        </Paper>
                                    ))}
                                </Stack>
                            )}
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="رابط المنتج" value={productForm.product_url} onChange={e => setProductForm(prev => ({ ...prev, product_url: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12 }}>
                            <FormControlLabel
                                control={<Switch checked={Boolean(productForm.is_active)} onChange={e => setProductForm(prev => ({ ...prev, is_active: e.target.checked }))} />}
                                label="منتج نشط"
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setProductDialog(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={saveProduct}>حفظ</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={flowDialog} onClose={() => setFlowDialog(false)} maxWidth="lg" fullWidth>
                <DialogTitle>{flowForm.id ? 'تعديل مسار' : 'إضافة مسار'}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
                                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>بيانات التشغيل</Typography>
                                <Stack spacing={2}>
                                    <TextField fullWidth label="اسم المسار" value={flowForm.name} onChange={e => setFlowForm(prev => ({ ...prev, name: e.target.value }))} />
                                    <TextField fullWidth multiline minRows={2} label="وصف داخلي" value={flowForm.description} onChange={e => setFlowForm(prev => ({ ...prev, description: e.target.value }))} />
                                    <TextField select fullWidth label="صفحة Facebook" value={flowForm.linked_page_id} onChange={e => setFlowForm(prev => ({ ...prev, linked_page_id: e.target.value }))}>
                                        <MenuItem value="">كل الصفحات</MenuItem>
                                        {pages.map(page => <MenuItem key={page.id} value={page.id}>{page.page_name || page.page_id}</MenuItem>)}
                                    </TextField>
                                    <Grid container spacing={1}>
                                        <Grid size={{ xs: 6 }}><TextField fullWidth type="number" label="الأولوية" value={flowForm.priority} onChange={e => setFlowForm(prev => ({ ...prev, priority: e.target.value }))} /></Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <TextField select fullWidth label="الحالة" value={flowForm.status} onChange={e => setFlowForm(prev => ({ ...prev, status: e.target.value }))}>
                                                <MenuItem value="draft">Draft</MenuItem>
                                                <MenuItem value="active">Active</MenuItem>
                                                <MenuItem value="paused">Paused</MenuItem>
                                            </TextField>
                                        </Grid>
                                    </Grid>
                                </Stack>
                            </Paper>
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
                                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>المشغل Trigger</Typography>
                                <Stack spacing={2}>
                                    <TextField select fullWidth label="Trigger" value={flowForm.trigger_type} onChange={e => setFlowForm(prev => ({ ...prev, trigger_type: e.target.value }))}>
                                        {Object.entries(triggerLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                                    </TextField>
                                    <Alert severity="info">{triggerHelp[flowForm.trigger_type]}</Alert>
                                    <TextField
                                        fullWidth
                                        label="قيمة Trigger"
                                        value={flowForm.trigger_value}
                                        onChange={e => setFlowForm(prev => ({ ...prev, trigger_value: e.target.value }))}
                                        disabled={['welcome', 'fallback', 'menu'].includes(flowForm.trigger_type)}
                                        helperText="للكلمات المفتاحية استخدم فاصلة أو سطر لكل كلمة"
                                    />
                                </Stack>
                            </Paper>
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
                                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>Validation</Typography>
                                <DiagnosticsPanel diagnostics={diagnostics} />
                                {preview && (
                                    <Alert severity="info" sx={{ mt: 1 }}>
                                        {preview.message}
                                        {preview.products?.length > 0 && (
                                            <Box sx={{ mt: 1 }}>{preview.products.map(product => product.name).join('، ')}</Box>
                                        )}
                                    </Alert>
                                )}
                            </Paper>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight={800}>الرد والخطوات</Typography>
                                        <Typography variant="caption" color="text.secondary">كل خطوة لها مفتاح ثابت. الأزرار يمكنها فتح منتجات، الانتقال لخطوة أخرى، أو تحويل المحادثة لموظف.</Typography>
                                    </Box>
                                    <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addNode}>إضافة خطوة</Button>
                                </Stack>

                                <Stack spacing={2}>
                                    {flowForm.nodes.map((node, nodeIndex) => (
                                        <Paper key={`${node.node_key}-${nodeIndex}`} variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                            <Grid container spacing={2}>
                                                <Grid size={{ xs: 12, md: 2 }}>
                                                    <TextField
                                                        fullWidth
                                                        label="مفتاح الخطوة"
                                                        value={node.node_key}
                                                        onChange={e => updateNode(nodeIndex, { node_key: e.target.value })}
                                                        disabled={nodeIndex === 0}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 3 }}>
                                                    <TextField select fullWidth label="نوع الخطوة" value={node.node_type} onChange={e => updateNode(nodeIndex, { node_type: e.target.value })}>
                                                        {Object.entries(nodeTypeLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 6 }}>
                                                    <TextField fullWidth label="عنوان داخلي" value={node.title} onChange={e => updateNode(nodeIndex, { title: e.target.value })} />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 1 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <IconButton disabled={nodeIndex === 0} color="error" onClick={() => removeNode(nodeIndex)}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Grid>
                                                <Grid size={{ xs: 12 }}>
                                                    <TextField fullWidth multiline minRows={2} label="نص الرد" value={node.body} onChange={e => updateNode(nodeIndex, { body: e.target.value })} />
                                                </Grid>

                                                {node.node_type === 'product_list' && (
                                                    <>
                                                        <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth label="تصنيف المنتجات" value={node.category} onChange={e => updateNode(nodeIndex, { category: e.target.value })} helperText="اتركه فارغا لعرض أحدث المنتجات" /></Grid>
                                                        <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth type="number" label="العدد" value={node.limit} onChange={e => updateNode(nodeIndex, { limit: e.target.value })} /></Grid>
                                                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="رسالة عدم توفر منتجات" value={node.empty_text} onChange={e => updateNode(nodeIndex, { empty_text: e.target.value })} /></Grid>
                                                        <Grid size={{ xs: 12 }}>
                                                            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                                                                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>بطاقة المنتج</Typography>
                                                                <Grid container spacing={1}>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_image)} onChange={e => updateNode(nodeIndex, { card_show_image: e.target.checked })} />} label="الصورة" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_price)} onChange={e => updateNode(nodeIndex, { card_show_price: e.target.checked })} />} label="السعر" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_description)} onChange={e => updateNode(nodeIndex, { card_show_description: e.target.checked })} />} label="الوصف" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_category)} onChange={e => updateNode(nodeIndex, { card_show_category: e.target.checked })} />} label="التصنيف" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_sku)} onChange={e => updateNode(nodeIndex, { card_show_sku: e.target.checked })} />} label="SKU" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_details_button)} onChange={e => updateNode(nodeIndex, { card_show_details_button: e.target.checked })} />} label="زر التفاصيل" />
                                                                        <TextField fullWidth size="small" label="نص زر التفاصيل" value={node.card_details_label} onChange={e => updateNode(nodeIndex, { card_details_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_inquiry_button)} onChange={e => updateNode(nodeIndex, { card_show_inquiry_button: e.target.checked })} />} label="زر الاستفسار" />
                                                                        <TextField fullWidth size="small" label="نص زر الاستفسار" value={node.card_inquiry_label} onChange={e => updateNode(nodeIndex, { card_inquiry_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_link_button)} onChange={e => updateNode(nodeIndex, { card_show_link_button: e.target.checked })} />} label="زر الرابط" />
                                                                        <TextField fullWidth size="small" label="نص زر الرابط" value={node.card_link_label} onChange={e => updateNode(nodeIndex, { card_link_label: e.target.value })} />
                                                                    </Grid>
                                                                </Grid>
                                                            </Paper>
                                                        </Grid>
                                                        <Grid size={{ xs: 12 }}>
                                                            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                                                                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>تفاصيل المنتج عند الضغط على تفاصيل</Typography>
                                                                <Grid container spacing={1}>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_images)} onChange={e => updateNode(nodeIndex, { detail_show_images: e.target.checked })} />} label="الصور" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_price)} onChange={e => updateNode(nodeIndex, { detail_show_price: e.target.checked })} />} label="السعر" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_description)} onChange={e => updateNode(nodeIndex, { detail_show_description: e.target.checked })} />} label="الوصف" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_category)} onChange={e => updateNode(nodeIndex, { detail_show_category: e.target.checked })} />} label="التصنيف" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_sku)} onChange={e => updateNode(nodeIndex, { detail_show_sku: e.target.checked })} />} label="SKU" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_link_text)} onChange={e => updateNode(nodeIndex, { detail_show_link_text: e.target.checked })} />} label="رابط كنص" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_include_menu)} onChange={e => updateNode(nodeIndex, { detail_include_menu: e.target.checked })} />} label="القائمة الرئيسية" />
                                                                        <TextField fullWidth size="small" label="نص القائمة" value={node.detail_menu_label} onChange={e => updateNode(nodeIndex, { detail_menu_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_include_products_reply)} onChange={e => updateNode(nodeIndex, { detail_include_products_reply: e.target.checked })} />} label="منتجات أخرى" />
                                                                        <TextField fullWidth size="small" label="نص المنتجات" value={node.detail_products_label} onChange={e => updateNode(nodeIndex, { detail_products_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_inquiry_button)} onChange={e => updateNode(nodeIndex, { detail_show_inquiry_button: e.target.checked })} />} label="استفسار" />
                                                                        <TextField fullWidth size="small" label="نص الاستفسار" value={node.detail_inquiry_label} onChange={e => updateNode(nodeIndex, { detail_inquiry_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_link_button)} onChange={e => updateNode(nodeIndex, { detail_show_link_button: e.target.checked })} />} label="زر الرابط" />
                                                                        <TextField fullWidth size="small" label="نص الرابط" value={node.detail_link_label} onChange={e => updateNode(nodeIndex, { detail_link_label: e.target.value })} />
                                                                    </Grid>
                                                                </Grid>
                                                            </Paper>
                                                        </Grid>
                                                    </>
                                                )}

                                                {node.node_type !== 'handoff' && node.node_type !== 'end' && (
                                                    <Grid size={{ xs: 12 }}>
                                                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                                                            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>قائمة الردود الافتراضية</Typography>
                                                            <Grid container spacing={1}>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <TextField
                                                                        select
                                                                        fullWidth
                                                                        size="small"
                                                                        label="طريقة عرض الردود"
                                                                        value={node.reply_display}
                                                                        onChange={e => updateNode(nodeIndex, { reply_display: e.target.value })}
                                                                    >
                                                                        <MenuItem value="quick_replies">Quick Replies</MenuItem>
                                                                        <MenuItem value="cards">بطاقات</MenuItem>
                                                                    </TextField>
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label="نص زر البطاقة"
                                                                        value={node.card_action_label}
                                                                        onChange={e => updateNode(nodeIndex, { card_action_label: e.target.value })}
                                                                        disabled={node.reply_display !== 'cards'}
                                                                    />
                                                                </Grid>
                                                                <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <FormControlLabel control={<Switch checked={Boolean(node.include_menu)} onChange={e => updateNode(nodeIndex, { include_menu: e.target.checked })} />} label="إظهار القائمة الرئيسية" />
                                                                    <TextField fullWidth size="small" label="نص القائمة الرئيسية" value={node.menu_label} onChange={e => updateNode(nodeIndex, { menu_label: e.target.value })} />
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <FormControlLabel control={<Switch checked={Boolean(node.include_products_reply)} onChange={e => updateNode(nodeIndex, { include_products_reply: e.target.checked })} />} label="إظهار المنتجات" />
                                                                    <TextField fullWidth size="small" label="نص زر المنتجات" value={node.products_reply_label} onChange={e => updateNode(nodeIndex, { products_reply_label: e.target.value })} />
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <FormControlLabel control={<Switch checked={Boolean(node.include_handoff_reply)} onChange={e => updateNode(nodeIndex, { include_handoff_reply: e.target.checked })} />} label="إظهار موظف بشري" />
                                                                    <TextField fullWidth size="small" label="نص زر الموظف" value={node.handoff_reply_label} onChange={e => updateNode(nodeIndex, { handoff_reply_label: e.target.value })} />
                                                                </Grid>
                                                            </Grid>
                                                        </Paper>
                                                    </Grid>
                                                )}

                                                {node.node_type !== 'product_list' && node.node_type !== 'handoff' && node.node_type !== 'end' && (
                                                    <Grid size={{ xs: 12 }}>
                                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1 }}>
                                                            <Typography variant="subtitle2" fontWeight={800}>الأزرار</Typography>
                                                            <Stack direction="row" spacing={1} alignItems="center">
                                                                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addButton(nodeIndex)}>إضافة زر</Button>
                                                            </Stack>
                                                        </Stack>
                                                        <Stack spacing={1}>
                                                            {node.buttons.map((button, buttonIndex) => (
                                                                <Grid container spacing={1} key={`${buttonIndex}-${button.title}`}>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <TextField fullWidth size="small" label="عنوان الزر" value={button.title} onChange={e => updateButton(nodeIndex, buttonIndex, { title: e.target.value })} />
                                                                    </Grid>
                                                                    {node.reply_display === 'cards' && (
                                                                        <Grid size={{ xs: 12, md: 3 }}>
                                                                            <TextField fullWidth size="small" label="وصف البطاقة" value={button.subtitle} onChange={e => updateButton(nodeIndex, buttonIndex, { subtitle: e.target.value })} />
                                                                        </Grid>
                                                                    )}
                                                                    <Grid size={{ xs: 12, md: 2 }}>
                                                                        <TextField select fullWidth size="small" label="الفعل" value={button.action} onChange={e => updateButton(nodeIndex, buttonIndex, { action: e.target.value })}>
                                                                            {Object.entries(actionLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                                                                        </TextField>
                                                                    </Grid>
                                                                    {button.action === 'products' && (
                                                                        <Grid size={{ xs: 12, md: 3 }}>
                                                                            <TextField fullWidth size="small" label="تصنيف اختياري" value={button.category} onChange={e => updateButton(nodeIndex, buttonIndex, { category: e.target.value })} />
                                                                        </Grid>
                                                                    )}
                                                                    {button.action === 'node' && (
                                                                        <Grid size={{ xs: 12, md: 3 }}>
                                                                            <TextField select fullWidth size="small" label="الخطوة" value={button.node_key} onChange={e => updateButton(nodeIndex, buttonIndex, { node_key: e.target.value })}>
                                                                                {flowForm.nodes.map(target => <MenuItem key={target.node_key} value={target.node_key}>{target.node_key}</MenuItem>)}
                                                                            </TextField>
                                                                        </Grid>
                                                                    )}
                                                                    {button.action === 'custom' && (
                                                                        <Grid size={{ xs: 12, md: 3 }}>
                                                                            <TextField fullWidth size="small" label="Payload" value={button.custom_payload} onChange={e => updateButton(nodeIndex, buttonIndex, { custom_payload: e.target.value })} />
                                                                        </Grid>
                                                                    )}
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                                                            <TextField
                                                                                fullWidth
                                                                                size="small"
                                                                                label="صورة الخيار"
                                                                                value={button.image_url}
                                                                                onChange={e => updateButton(nodeIndex, buttonIndex, { image_url: e.target.value })}
                                                                            />
                                                                            <Button variant="outlined" size="small" component="label" sx={{ minWidth: 72 }}>
                                                                                رفع
                                                                                <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadButtonImage(nodeIndex, buttonIndex, e.target.files?.[0])} />
                                                                            </Button>
                                                                        </Stack>
                                                                    </Grid>
                                                                    {button.image_url && (
                                                                        <Grid size={{ xs: 12, md: 1 }}>
                                                                            <Box component="img" src={button.image_url} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }} />
                                                                        </Grid>
                                                                    )}
                                                                    <Grid size={{ xs: 12, md: 1 }}>
                                                                        <IconButton size="small" color="error" onClick={() => removeButton(nodeIndex, buttonIndex)}>
                                                                            <DeleteIcon fontSize="small" />
                                                                        </IconButton>
                                                                    </Grid>
                                                                </Grid>
                                                            ))}
                                                            {node.buttons.length === 0 && (
                                                                <Typography variant="caption" color="text.secondary">لا توجد أزرار مخصصة لهذه الخطوة.</Typography>
                                                            )}
                                                        </Stack>
                                                    </Grid>
                                                )}
                                            </Grid>
                                        </Paper>
                                    ))}
                                </Stack>
                            </Paper>
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFlowDialog(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={saveFlow}>حفظ</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MessengerBotManager;
