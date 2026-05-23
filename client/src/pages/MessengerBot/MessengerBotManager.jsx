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
import { useLanguage } from '../../context/LanguageContext';

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

const textFor = (t, key, fallback, values) => (typeof t === 'function' ? t(key, values) : fallback);

const emptyNode = (index = 0, t) => ({
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
    menu_label: textFor(t, 'messengerBot.defaults.mainMenu', 'القائمة الرئيسية'),
    products_reply_label: textFor(t, 'messengerBot.defaults.moreProducts', 'منتجات أخرى'),
    handoff_reply_label: textFor(t, 'messengerBot.defaults.humanAgent', 'موظف بشري'),
    reply_cards_text: textFor(t, 'messengerBot.defaults.nextStepText', 'اختر الخطوة التالية.'),
    card_action_label: textFor(t, 'messengerBot.defaults.choose', 'اختيار'),
    card_title_template: '{name}',
    card_subtitle_template: '',
    card_show_image: true,
    card_show_price: true,
    card_show_description: true,
    card_show_category: false,
    card_show_sku: false,
    card_show_details_button: true,
    card_show_inquiry_button: true,
    card_show_link_button: true,
    card_details_label: textFor(t, 'messengerBot.defaults.details', 'تفاصيل'),
    card_inquiry_label: textFor(t, 'messengerBot.defaults.inquiry', 'استفسار'),
    card_link_label: textFor(t, 'messengerBot.defaults.openLink', 'فتح الرابط'),
    detail_title_template: '{name}',
    detail_subtitle_template: '',
    detail_body_template: '',
    detail_not_found_text: textFor(t, 'messengerBot.defaults.noProduct', 'لم يتم العثور على هذا المنتج أو لم يعد متاحا.'),
    detail_handoff_text_template: textFor(t, 'messengerBot.defaults.handoffProduct', 'تم تحويل استفسارك عن "{name}" إلى أحد الموظفين.'),
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
    detail_menu_label: textFor(t, 'messengerBot.defaults.mainMenu', 'القائمة الرئيسية'),
    detail_products_label: textFor(t, 'messengerBot.defaults.moreProducts', 'منتجات أخرى'),
    detail_inquiry_label: textFor(t, 'messengerBot.defaults.inquiry', 'استفسار'),
    detail_link_label: textFor(t, 'messengerBot.defaults.openLink', 'فتح الرابط'),
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

function nodeToForm(node, index = 0, t) {
    const config = parseConfig(node?.config_json || node?.config);
    const buttons = config.quick_replies || config.items || [];
    return {
        ...emptyNode(index, t),
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
        menu_label: config.menu_label || textFor(t, 'messengerBot.defaults.mainMenu', 'القائمة الرئيسية'),
        products_reply_label: config.products_reply_label || textFor(t, 'messengerBot.defaults.moreProducts', 'منتجات أخرى'),
        handoff_reply_label: config.handoff_reply_label || textFor(t, 'messengerBot.defaults.humanAgent', 'موظف بشري'),
        reply_cards_text: config.reply_cards_text || textFor(t, 'messengerBot.defaults.nextStepText', 'اختر الخطوة التالية.'),
        card_action_label: config.card_action_label || textFor(t, 'messengerBot.defaults.choose', 'اختيار'),
        card_title_template: config.card_title_template || '{name}',
        card_subtitle_template: config.card_subtitle_template || '',
        card_show_image: config.card_show_image !== false,
        card_show_price: config.card_show_price !== false,
        card_show_description: config.card_show_description !== false,
        card_show_category: config.card_show_category === true,
        card_show_sku: config.card_show_sku === true,
        card_show_details_button: config.card_show_details_button !== false,
        card_show_inquiry_button: config.card_show_inquiry_button !== false,
        card_show_link_button: config.card_show_link_button !== false,
        card_details_label: config.card_details_label || textFor(t, 'messengerBot.defaults.details', 'تفاصيل'),
        card_inquiry_label: config.card_inquiry_label || textFor(t, 'messengerBot.defaults.inquiry', 'استفسار'),
        card_link_label: config.card_link_label || textFor(t, 'messengerBot.defaults.openLink', 'فتح الرابط'),
        detail_title_template: config.detail_title_template || '{name}',
        detail_subtitle_template: config.detail_subtitle_template || '',
        detail_body_template: config.detail_body_template || '',
        detail_not_found_text: config.detail_not_found_text || textFor(t, 'messengerBot.defaults.noProduct', 'لم يتم العثور على هذا المنتج أو لم يعد متاحا.'),
        detail_handoff_text_template: config.detail_handoff_text_template || textFor(t, 'messengerBot.defaults.handoffProduct', 'تم تحويل استفسارك عن "{name}" إلى أحد الموظفين.'),
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
        detail_menu_label: config.detail_menu_label || textFor(t, 'messengerBot.defaults.mainMenu', 'القائمة الرئيسية'),
        detail_products_label: config.detail_products_label || textFor(t, 'messengerBot.defaults.moreProducts', 'منتجات أخرى'),
        detail_inquiry_label: config.detail_inquiry_label || textFor(t, 'messengerBot.defaults.inquiry', 'استفسار'),
        detail_link_label: config.detail_link_label || textFor(t, 'messengerBot.defaults.openLink', 'فتح الرابط'),
        buttons: buttons.map(normalizePayloadAction),
    };
}

function flowToForm(flow, t) {
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
        nodes: nodes.map((node, index) => nodeToForm(node, index, t)),
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

function buildFlowPayload(form, t) {
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
                reply_cards_text: node.reply_cards_text,
                card_action_label: node.card_action_label,
            };
            if (node.node_type === 'product_list') {
                config.category = node.category || null;
                config.limit = Number(node.limit) || 10;
                config.empty_text = node.empty_text || textFor(t, 'messengerBot.defaults.noProductsAvailable', 'لا توجد منتجات متاحة حاليا.');
                config.card_title_template = node.card_title_template;
                config.card_subtitle_template = node.card_subtitle_template;
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
                config.detail_title_template = node.detail_title_template;
                config.detail_subtitle_template = node.detail_subtitle_template;
                config.detail_body_template = node.detail_body_template;
                config.detail_not_found_text = node.detail_not_found_text;
                config.detail_handoff_text_template = node.detail_handoff_text_template;
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

function buildTemplate(templateKey, t) {
    const productBody = textFor(t, 'messengerBot.templateDefaults.productsBody', 'هذه المنتجات المتاحة حاليا.');
    if (templateKey === 'products') {
        return {
            ...emptyFlow,
            name: textFor(t, 'messengerBot.templateDefaults.productsName', 'عرض المنتجات'),
            trigger_type: 'keyword',
            trigger_value: textFor(t, 'messengerBot.templateDefaults.productsTrigger', 'منتجات, المنتجات, كتالوج'),
            description: textFor(t, 'messengerBot.templateDefaults.productsDescription', 'يعرض أحدث المنتجات أو منتجات تصنيف محدد.'),
            nodes: [{ ...emptyNode(0, t), node_type: 'product_list', body: productBody }],
        };
    }
    if (templateKey === 'services') {
        return {
            ...emptyFlow,
            name: textFor(t, 'messengerBot.templateDefaults.servicesName', 'الخدمات'),
            trigger_type: 'keyword',
            trigger_value: textFor(t, 'messengerBot.templateDefaults.servicesTrigger', 'خدمات, مساعدة'),
            description: textFor(t, 'messengerBot.templateDefaults.servicesDescription', 'قائمة خدمات موجهة بأزرار واضحة.'),
            nodes: [{
                ...emptyNode(0, t),
                node_type: 'service_menu',
                include_products_reply: false,
                body: textFor(t, 'messengerBot.templateDefaults.servicesBody', 'اختر الخدمة المناسبة.'),
                buttons: [
                    { ...emptyButton, title: textFor(t, 'messengerBot.templateDefaults.productsName', 'عرض المنتجات'), action: 'node', node_key: 'products' },
                    { ...emptyButton, title: textFor(t, 'messengerBot.defaults.humanAgent', 'موظف بشري'), action: 'handoff' },
                ],
            }, {
                ...emptyNode(1, t),
                node_key: 'products',
                node_type: 'product_list',
                body: productBody,
            }],
        };
    }
    if (templateKey === 'fallback') {
        return {
            ...emptyFlow,
            name: textFor(t, 'messengerBot.templateDefaults.fallbackName', 'رد افتراضي'),
            trigger_type: 'fallback',
            trigger_value: '',
            description: textFor(t, 'messengerBot.templateDefaults.fallbackDescription', 'يظهر عندما لا يفهم البوت رسالة المستخدم.'),
            nodes: [{
                ...emptyNode(0, t),
                node_type: 'quick_replies',
                body: textFor(t, 'messengerBot.templateDefaults.fallbackBody', 'لم أفهم طلبك بدقة. اختر أحد الخيارات.'),
                buttons: [
                    { ...emptyButton, title: textFor(t, 'messengerBot.diagnosticsText.productsFallbackTitle', 'المنتجات'), action: 'node', node_key: 'products' },
                    { ...emptyButton, title: textFor(t, 'messengerBot.defaults.humanAgent', 'موظف بشري'), action: 'handoff' },
                ],
            }, {
                ...emptyNode(1, t),
                node_key: 'products',
                node_type: 'product_list',
                body: productBody,
            }],
        };
    }
    if (templateKey === 'handoff') {
        return {
            ...emptyFlow,
            name: textFor(t, 'messengerBot.templateDefaults.handoffName', 'تحويل لموظف'),
            trigger_type: 'keyword',
            trigger_value: textFor(t, 'messengerBot.templateDefaults.handoffTrigger', 'موظف, دعم, تواصل'),
            description: textFor(t, 'messengerBot.templateDefaults.handoffDescription', 'يوقف البوت ويحول المحادثة للموظف.'),
            nodes: [{ ...emptyNode(0, t), node_type: 'handoff', body: textFor(t, 'messengerBot.templateDefaults.handoffBody', 'تم تحويلك إلى أحد الموظفين.') }],
        };
    }
    return {
        ...emptyFlow,
        name: textFor(t, 'messengerBot.templateDefaults.welcomeName', 'ترحيب'),
        trigger_type: 'welcome',
        trigger_value: '',
        description: textFor(t, 'messengerBot.templateDefaults.welcomeDescription', 'مسار البداية للمستخدم الجديد.'),
        nodes: [{
            ...emptyNode(0, t),
            node_type: 'service_menu',
            include_products_reply: false,
            body: textFor(t, 'messengerBot.templateDefaults.welcomeBody', 'مرحبا، كيف يمكننا مساعدتك؟'),
            buttons: [
                { ...emptyButton, title: textFor(t, 'messengerBot.templateDefaults.productsName', 'عرض المنتجات'), action: 'node', node_key: 'products' },
                { ...emptyButton, title: textFor(t, 'messengerBot.templateDefaults.servicesName', 'الخدمات'), action: 'node', node_key: 'services' },
                { ...emptyButton, title: textFor(t, 'messengerBot.defaults.humanAgent', 'موظف بشري'), action: 'handoff' },
            ],
        }, {
            ...emptyNode(1, t),
            node_key: 'services',
            node_type: 'quick_replies',
            body: textFor(t, 'messengerBot.templateDefaults.serviceTypeBody', 'اختر نوع الخدمة.'),
            buttons: [
                { ...emptyButton, title: textFor(t, 'messengerBot.diagnosticsText.productsFallbackTitle', 'المنتجات'), action: 'node', node_key: 'products' },
                { ...emptyButton, title: textFor(t, 'messengerBot.defaults.humanAgent', 'موظف بشري'), action: 'handoff' },
            ],
        }, {
            ...emptyNode(2, t),
            node_key: 'products',
            node_type: 'product_list',
            body: productBody,
        }],
    };
}

function getClientDiagnostics(form, pages, flows, products, t) {
    const errors = [];
    const warnings = [];
    const nodeKeys = form.nodes.map(node => String(node.node_key || '').trim()).filter(Boolean);
    const duplicateKeys = nodeKeys.filter((key, index) => nodeKeys.indexOf(key) !== index);
    const hasProductListNode = form.nodes.some(node => node.node_type === 'product_list');

    if (!form.name.trim()) errors.push(textFor(t, 'messengerBot.diagnosticsText.flowNameRequired', 'اسم المسار مطلوب.'));
    if (!nodeKeys.includes('start')) errors.push(textFor(t, 'messengerBot.diagnosticsText.startRequired', 'يجب وجود خطوة start.'));
    if (duplicateKeys.length > 0) errors.push(textFor(t, 'messengerBot.diagnosticsText.duplicateKeys', 'يوجد تكرار في مفاتيح الخطوات: {keys}', { keys: [...new Set(duplicateKeys)].join(', ') }));
    if (form.status === 'active' && form.linked_page_id && !pages.some(page => String(page.id) === String(form.linked_page_id))) {
        errors.push(textFor(t, 'messengerBot.diagnosticsText.invalidPage', 'الصفحة المحددة غير مفعلة أو غير موجودة.'));
    }
    if (form.status === 'active' && form.trigger_type === 'keyword' && !form.trigger_value.trim()) {
        errors.push(textFor(t, 'messengerBot.diagnosticsText.keywordRequired', 'المسار النشط بالكلمة المفتاحية يحتاج كلمة أو أكثر.'));
    }
    if (form.status === 'active' && form.trigger_type === 'postback' && !form.trigger_value.trim()) {
        errors.push(textFor(t, 'messengerBot.diagnosticsText.postbackRequired', 'مسار postback النشط يحتاج payload واضح.'));
    }
    if (pages.length === 0) warnings.push(textFor(t, 'messengerBot.diagnosticsText.noPages', 'لا توجد صفحات Messenger مفعلة لهذا العميل.'));

    form.nodes.forEach(node => {
        if (node.node_type === 'product_list') {
            const hasProducts = products.some(product => {
                if (!product.is_active || product.availability !== 'available') return false;
                return !node.category || String(product.category || '').toLowerCase() === String(node.category).toLowerCase();
            });
            if (!hasProducts) warnings.push(textFor(t, 'messengerBot.diagnosticsText.noProductsForStep', 'الخطوة {node} تعرض منتجات لكن لا توجد منتجات متاحة مطابقة.', { node: node.node_key }));
        }
        node.buttons.forEach(button => {
            if (!button.title.trim()) warnings.push(textFor(t, 'messengerBot.diagnosticsText.untitledButton', 'يوجد زر بدون عنوان في الخطوة {node}.', { node: node.node_key }));
            if (button.action === 'products' && !hasProductListNode) {
                warnings.push(textFor(t, 'messengerBot.diagnosticsText.productShortcut', 'زر "{title}" يستخدم اختصار فتح المنتجات بدون خطوة قائمة منتجات قابلة للتحكم.', { title: button.title || textFor(t, 'messengerBot.diagnosticsText.productsFallbackTitle', 'المنتجات') }));
            }
            if (button.action === 'node' && !nodeKeys.includes(button.node_key)) {
                errors.push(textFor(t, 'messengerBot.diagnosticsText.missingNode', 'زر "{title}" يشير إلى خطوة غير موجودة: {node}.', { title: button.title || textFor(t, 'messengerBot.diagnosticsText.untitledFallback', 'بدون عنوان'), node: button.node_key || textFor(t, 'messengerBot.diagnosticsText.unspecified', 'غير محدد') }));
            }
            if (button.action === 'custom' && !button.custom_payload.trim()) {
                errors.push(textFor(t, 'messengerBot.diagnosticsText.customPayloadRequired', 'زر "{title}" يحتاج payload مخصص.', { title: button.title || textFor(t, 'messengerBot.diagnosticsText.untitledFallback', 'بدون عنوان') }));
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
    if (conflict) warnings.push(textFor(t, 'messengerBot.diagnosticsText.conflict', 'تعارض محتمل مع المسار النشط: {name}.', { name: conflict.name }));

    return { ready: errors.length === 0, errors, warnings };
}

const StatBox = ({ title, value, color = 'primary' }) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
        <Typography variant="caption" color="text.secondary">{title}</Typography>
        <Typography variant="h5" fontWeight={800} color={`${color}.main`}>{value}</Typography>
    </Paper>
);

const DiagnosticsPanel = ({ diagnostics, t }) => (
    <Stack spacing={1}>
        <Alert severity={diagnostics.ready ? 'success' : 'error'}>
            {diagnostics.ready ? t('messengerBot.diagnosticsText.ready') : t('messengerBot.diagnosticsText.notReady')}
        </Alert>
        {diagnostics.errors.map(error => <Alert key={error} severity="error">{error}</Alert>)}
        {diagnostics.warnings.map(warning => <Alert key={warning} severity="warning">{warning}</Alert>)}
    </Stack>
);

const MessengerBotManager = ({ tenantMode = false }) => {
    const { locale, t } = useLanguage();
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
    const nodeTypeOptions = useMemo(() => ({
        text: t('messengerBot.nodeTypes.text'),
        quick_replies: t('messengerBot.nodeTypes.quick_replies'),
        product_list: t('messengerBot.nodeTypes.product_list'),
        product_detail: t('messengerBot.nodeTypes.product_detail'),
        service_menu: t('messengerBot.nodeTypes.service_menu'),
        handoff: t('messengerBot.nodeTypes.handoff'),
        end: t('messengerBot.nodeTypes.end'),
    }), [t]);
    const triggerOptions = useMemo(() => ({
        welcome: t('messengerBot.triggers.welcome'),
        keyword: t('messengerBot.triggers.keyword'),
        postback: t('messengerBot.triggers.postback'),
        fallback: t('messengerBot.triggers.fallback'),
        menu: t('messengerBot.triggers.menu'),
    }), [t]);
    const triggerHelpText = useMemo(() => ({
        welcome: t('messengerBot.triggerHelp.welcome'),
        keyword: t('messengerBot.triggerHelp.keyword'),
        postback: t('messengerBot.triggerHelp.postback'),
        fallback: t('messengerBot.triggerHelp.fallback'),
        menu: t('messengerBot.triggerHelp.menu'),
    }), [t]);
    const actionOptions = useMemo(() => ({
        products: t('messengerBot.actionsMap.products'),
        node: t('messengerBot.actionsMap.node'),
        handoff: t('messengerBot.actionsMap.handoff'),
        menu: t('messengerBot.actionsMap.menu'),
        custom: t('messengerBot.actionsMap.custom'),
    }), [t]);
    const productTemplateHelp = t('messengerBot.productTemplateHelp');
    const diagnostics = useMemo(
        () => getClientDiagnostics(flowForm, pages, flows, products, t),
        [flowForm, pages, flows, products, t]
    );

    useEffect(() => {
        if (tenantMode) return;
        api.getTenants()
            .then(data => {
                const rows = Array.isArray(data) ? data : [];
                setTenants(rows);
                if (rows.length > 0) setSelectedTenantId(String(rows[0].id));
            })
            .catch(err => setSnackbar({ open: true, message: err.message || t('messengerBot.messages.tenantsFetchFailed'), severity: 'error' }));
    }, [tenantMode, t]);

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
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.dataFetchFailed'), severity: 'error' });
        } finally {
            setLoading(false);
        }
    }, [botApi, selectedTenantReady, t]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const loadFlowEvents = async (flow) => {
        try {
            const events = await botApi.flowEvents(flow.id);
            setSelectedEventsFlow(flow);
            setFlowEvents(Array.isArray(events) ? events : []);
            setTab(3);
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.flowEventsFetchFailed'), severity: 'error' });
        }
    };

    const saveProduct = async () => {
        try {
            if (!productForm.name.trim()) {
                setSnackbar({ open: true, message: t('messengerBot.messages.productNameRequired'), severity: 'warning' });
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
            setSnackbar({ open: true, message: t('messengerBot.messages.productSaved'), severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.productSaveFailed'), severity: 'error' });
        }
    };

    const deleteProduct = async (product) => {
        try {
            if (tenantMode) await api.deletePortalMessengerBotProduct(product.id);
            else await api.deleteMessengerBotProduct(tenantId, product.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.productDeleteFailed'), severity: 'error' });
        }
    };

    const importProducts = async (file) => {
        if (!file) return;
        try {
            const result = tenantMode
                ? await api.importPortalMessengerBotProducts(file)
                : await api.importMessengerBotProducts(tenantId, file);
            setSnackbar({ open: true, message: t('messengerBot.messages.productsImported', { count: result.imported || 0 }), severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.productsImportFailed'), severity: 'error' });
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
            setSnackbar({ open: true, message: t('messengerBot.messages.imagesUploaded', { count: uploaded.filter(Boolean).length }), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.imagesUploadFailed'), severity: 'error' });
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
            setSnackbar({ open: true, message: t('messengerBot.messages.optionImageUploaded'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.optionImageUploadFailed'), severity: 'error' });
        }
    };

    const saveFlow = async () => {
        try {
            if (!diagnostics.ready && flowForm.status === 'active') {
                setSnackbar({ open: true, message: t('messengerBot.messages.fixErrorsBeforeActivation'), severity: 'warning' });
                return;
            }
            const payload = buildFlowPayload(flowForm, t);
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
            setSnackbar({ open: true, message: t('messengerBot.messages.flowSaved'), severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.flowSaveFailed'), severity: 'error' });
        }
    };

    const toggleFlow = async (flow) => {
        try {
            if (tenantMode) await api.togglePortalMessengerBotFlow(flow.id);
            else await api.toggleMessengerBotFlow(tenantId, flow.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.flowToggleFailed'), severity: 'error' });
        }
    };

    const deleteFlow = async (flow) => {
        try {
            if (tenantMode) await api.deletePortalMessengerBotFlow(flow.id);
            else await api.deleteMessengerBotFlow(tenantId, flow.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.flowDeleteFailed'), severity: 'error' });
        }
    };

    const testFlow = async (flow) => {
        try {
            const result = tenantMode
                ? await api.testPortalMessengerBotFlow(flow.id)
                : await api.testMessengerBotFlow(tenantId, flow.id);
            setPreview(result.preview);
            setFlowDialog(true);
            setFlowForm(flowToForm(flow, t));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.flowTestFailed'), severity: 'error' });
        }
    };

    const updateSession = async (session, status) => {
        try {
            if (tenantMode) await api.updatePortalMessengerBotSession(session.id, status);
            else await api.updateMessengerBotSession(tenantId, session.id, status);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('messengerBot.messages.sessionUpdateFailed'), severity: 'error' });
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
        setFlowForm(flow ? flowToForm(flow, t) : buildTemplate('welcome', t));
        setFlowDialog(true);
    };

    const updateNode = (index, changes) => {
        setFlowForm(prev => ({
            ...prev,
            nodes: prev.nodes.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...changes } : node),
        }));
    };

    const addNode = () => {
        setFlowForm(prev => ({ ...prev, nodes: [...prev.nodes, emptyNode(prev.nodes.length, t)] }));
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
                <Alert severity="info">{t('messengerBot.noTenant')}</Alert>
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
                        {t('messengerBot.subtitle')}
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                    {!tenantMode && (
                        <TextField
                            select
                            size="small"
                            label={t('messengerBot.tenant')}
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
                        {t('common.refresh')}
                    </Button>
                </Stack>
            </Stack>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>
            ) : (
                <>
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.activeProducts')} value={summary?.products?.active || 0} /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.activeFlows')} value={summary?.flows?.active || 0} color="success" /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.handoffs30d')} value={performance.handoffs || 0} color="warning" /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.failedBotSends')} value={performance.failed_sends || 0} color="error" /></Grid>
                    </Grid>

                    <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
                            <Tab label={t('messengerBot.tabs.products')} />
                            <Tab label={t('messengerBot.tabs.flows')} />
                            <Tab label={t('messengerBot.tabs.sessions')} />
                            <Tab label={t('messengerBot.tabs.performance')} />
                        </Tabs>
                        <Divider />

                        {tab === 0 && (
                            <Box sx={{ p: 2 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 2 }}>
                                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => openProductDialog()}>
                                        {t('messengerBot.addProduct')}
                                    </Button>
                                    <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                                        {t('messengerBot.importCsv')}
                                        <input hidden type="file" accept=".csv,text/csv" onChange={e => importProducts(e.target.files?.[0])} />
                                    </Button>
                                </Stack>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{t('messengerBot.product')}</TableCell>
                                            <TableCell>{t('messengerBot.category')}</TableCell>
                                            <TableCell>{t('messengerBot.price')}</TableCell>
                                            <TableCell>{t('common.status')}</TableCell>
                                            <TableCell align="right">{t('messengerBot.actions')}</TableCell>
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
                                                            <Typography variant="caption" color="text.secondary">{product.sku || product.description || t('messengerBot.noDescription')}</Typography>
                                                        </Box>
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>{product.category || t('messengerBot.general')}</TableCell>
                                                <TableCell>{Number(product.price || 0).toLocaleString(locale)} {product.currency}</TableCell>
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
                                            <TableRow><TableCell colSpan={5} align="center">{t('messengerBot.noProducts')}</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 1 && (
                            <Box sx={{ p: 2 }}>
                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }} alignItems={{ xs: 'stretch', md: 'center' }}>
                                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => openFlowDialog()}>
                                        {t('messengerBot.addFlow')}
                                    </Button>
                                    {['welcome', 'products', 'services', 'fallback', 'handoff'].map(templateKey => (
                                        <Button
                                            key={templateKey}
                                            variant="outlined"
                                            size="small"
                                            onClick={() => {
                                                setPreview(null);
                                                setFlowForm(buildTemplate(templateKey, t));
                                                setFlowDialog(true);
                                            }}
                                        >
                                            {t('messengerBot.template', { name: t(`messengerBot.templateNames.${templateKey}`) })}
                                        </Button>
                                    ))}
                                </Stack>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{t('messengerBot.flow')}</TableCell>
                                            <TableCell>{t('messengerBot.trigger')}</TableCell>
                                            <TableCell>{t('messengerBot.steps')}</TableCell>
                                            <TableCell>{t('messengerBot.page')}</TableCell>
                                            <TableCell>{t('common.status')}</TableCell>
                                            <TableCell>{t('messengerBot.diagnostics')}</TableCell>
                                            <TableCell align="right">{t('messengerBot.actions')}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {flows.map(flow => (
                                            <TableRow key={flow.id}>
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={700}>{flow.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">{flow.description || flow.body || '—'}</Typography>
                                                </TableCell>
                                                <TableCell>{triggerOptions[flow.trigger_type] || flow.trigger_type}{flow.trigger_value ? `: ${flow.trigger_value}` : ''}</TableCell>
                                                <TableCell>{flow.nodes_count || flow.nodes?.length || 1}</TableCell>
                                                <TableCell>{flow.page_name || t('messengerBot.allPages')}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={flow.status} color={flow.status === 'active' ? 'success' : 'default'} />
                                                </TableCell>
                                                <TableCell>
                                                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                                        {(flow.errors || []).length > 0 && <Chip size="small" color="error" label={t('messengerBot.errorCount', { count: flow.errors.length })} />}
                                                        {(flow.warnings || []).length > 0 && <Chip size="small" color="warning" label={t('messengerBot.warningCount', { count: flow.warnings.length })} />}
                                                        {!(flow.errors || []).length && !(flow.warnings || []).length && <Chip size="small" color="success" label={t('messengerBot.ready')} />}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Button size="small" onClick={() => loadFlowEvents(flow)}>{t('messengerBot.tabs.performance')}</Button>
                                                    <IconButton size="small" onClick={() => testFlow(flow)}><TestIcon fontSize="small" /></IconButton>
                                                    <IconButton size="small" onClick={() => openFlowDialog(flow)}><EditIcon fontSize="small" /></IconButton>
                                                    <Button size="small" onClick={() => toggleFlow(flow)}>{flow.status === 'active' ? t('messengerBot.deactivate') : t('messengerBot.activate')}</Button>
                                                    <IconButton size="small" color="error" onClick={() => deleteFlow(flow)}><DeleteIcon fontSize="small" /></IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {flows.length === 0 && (
                                            <TableRow><TableCell colSpan={7} align="center">{t('messengerBot.noFlows')}</TableCell></TableRow>
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
                                            <TableCell>{t('messengerBot.user')}</TableCell>
                                            <TableCell>{t('messengerBot.page')}</TableCell>
                                            <TableCell>Flow</TableCell>
                                            <TableCell>{t('messengerBot.steps')}</TableCell>
                                            <TableCell>{t('common.status')}</TableCell>
                                            <TableCell>{t('messengerBot.updatedAt')}</TableCell>
                                            <TableCell align="right">{t('messengerBot.actions')}</TableCell>
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
                                                        {session.status === 'handoff' ? t('messengerBot.resumeBot') : t('messengerBot.handoff')}
                                                    </Button>
                                                    <Button size="small" color="inherit" onClick={() => updateSession(session, 'closed')}>{t('messengerBot.close')}</Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {sessions.length === 0 && (
                                            <TableRow><TableCell colSpan={7} align="center">{t('messengerBot.noSessions')}</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 3 && (
                            <Box sx={{ p: 2 }}>
                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title="Handoffs" value={performance.handoffs || 0} color="warning" /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.failedSends')} value={performance.failed_sends || 0} color="error" /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.productDetailsOpened')} value={performance.product_details || 0} color="info" /></Grid>
                                    <Grid size={{ xs: 6, md: 3 }}><StatBox title={t('messengerBot.messengerPages')} value={pages.length} color="secondary" /></Grid>
                                </Grid>
                                <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 5 }}>
                                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.topFlows')}</Typography>
                                            <Table size="small">
                                                <TableBody>
                                                    {(performance.top_flows || []).map(row => (
                                                        <TableRow key={`${row.flow_id}-${row.flow_name}`}>
                                                            <TableCell>{row.flow_name}</TableCell>
                                                            <TableCell align="right">{row.count}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                    {!(performance.top_flows || []).length && (
                                                        <TableRow><TableCell align="center">{t('common.noData')}</TableCell></TableRow>
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </Paper>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 7 }}>
                                        <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
                                                {t('messengerBot.flowLog')} {selectedEventsFlow ? `- ${selectedEventsFlow.name}` : ''}
                                            </Typography>
                                            {!selectedEventsFlow && <Alert severity="info">{t('messengerBot.chooseFlowLog')}</Alert>}
                                            {selectedEventsFlow && (
                                                <Table size="small">
                                                    <TableHead>
                                                        <TableRow>
                                                            <TableCell>{t('common.time')}</TableCell>
                                                            <TableCell>{t('common.type')}</TableCell>
                                                            <TableCell>{t('common.status')}</TableCell>
                                                            <TableCell>{t('messengerBot.user')}</TableCell>
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
                                                            <TableRow><TableCell colSpan={4} align="center">{t('messengerBot.noFlowEvents')}</TableCell></TableRow>
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
                <DialogTitle>{productForm.id ? t('messengerBot.editProduct') : t('messengerBot.addProduct')}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label={t('messengerBot.name')} value={productForm.name} onChange={e => setProductForm(prev => ({ ...prev, name: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label="SKU" value={productForm.sku} onChange={e => setProductForm(prev => ({ ...prev, sku: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12 }}><TextField fullWidth multiline minRows={2} label={t('messengerBot.description')} value={productForm.description} onChange={e => setProductForm(prev => ({ ...prev, description: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth type="number" label={t('messengerBot.price')} value={productForm.price} onChange={e => setProductForm(prev => ({ ...prev, price: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label={t('messengerBot.fields.currency')} value={productForm.currency} onChange={e => setProductForm(prev => ({ ...prev, currency: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12, md: 3 }}><TextField fullWidth label={t('messengerBot.category')} value={productForm.category} onChange={e => setProductForm(prev => ({ ...prev, category: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12, md: 3 }}>
                            <TextField select fullWidth label={t('messengerBot.availability')} value={productForm.availability} onChange={e => setProductForm(prev => ({ ...prev, availability: e.target.value }))}>
                                <MenuItem value="available">{t('messengerBot.available')}</MenuItem>
                                <MenuItem value="out_of_stock">{t('messengerBot.outOfStock')}</MenuItem>
                                <MenuItem value="hidden">{t('messengerBot.hidden')}</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <TextField fullWidth label={t('messengerBot.imageUrl')} value={productForm.image_url} onChange={e => setProductForm(prev => ({ ...prev, image_url: e.target.value }))} />
                                <Button variant="outlined" onClick={addProductImageUrl} sx={{ minWidth: 96 }}>
                                    {t('messengerBot.add')}
                                </Button>
                                <Button variant="outlined" component="label" sx={{ minWidth: 120 }}>
                                    {t('messengerBot.uploadImages')}
                                    <input hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadProductImages(e.target.files)} />
                                </Button>
                            </Stack>
                            {(productForm.images || []).length > 0 && (
                                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                                    {productForm.images.map((image, index) => (
                                        <Paper key={`${image.image_url}-${index}`} variant="outlined" sx={{ p: 0.5, borderRadius: 1, width: 118 }}>
                                            <Box component="img" src={image.image_url} alt="" sx={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 1 }} />
                                            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                                                <Button size="small" disabled={index === 0} onClick={() => setPrimaryProductImage(index)}>{t('messengerBot.primary')}</Button>
                                                <IconButton size="small" color="error" onClick={() => removeProductImage(index)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Stack>
                                        </Paper>
                                    ))}
                                </Stack>
                            )}
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label={t('messengerBot.productUrl')} value={productForm.product_url} onChange={e => setProductForm(prev => ({ ...prev, product_url: e.target.value }))} /></Grid>
                        <Grid size={{ xs: 12 }}>
                            <FormControlLabel
                                control={<Switch checked={Boolean(productForm.is_active)} onChange={e => setProductForm(prev => ({ ...prev, is_active: e.target.checked }))} />}
                                label={t('messengerBot.activeProduct')}
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setProductDialog(false)}>{t('common.cancel')}</Button>
                    <Button variant="contained" onClick={saveProduct}>{t('common.save')}</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={flowDialog} onClose={() => setFlowDialog(false)} maxWidth="lg" fullWidth>
                <DialogTitle>{flowForm.id ? t('messengerBot.editFlowTitle') : t('messengerBot.addFlowTitle')}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
                                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.runtimeData')}</Typography>
                                <Stack spacing={2}>
                                    <TextField fullWidth label={t('messengerBot.flow')} value={flowForm.name} onChange={e => setFlowForm(prev => ({ ...prev, name: e.target.value }))} />
                                    <TextField fullWidth multiline minRows={2} label={t('messengerBot.internalDescription')} value={flowForm.description} onChange={e => setFlowForm(prev => ({ ...prev, description: e.target.value }))} />
                                    <TextField select fullWidth label={t('messengerBot.facebookPage')} value={flowForm.linked_page_id} onChange={e => setFlowForm(prev => ({ ...prev, linked_page_id: e.target.value }))}>
                                        <MenuItem value="">{t('messengerBot.allPages')}</MenuItem>
                                        {pages.map(page => <MenuItem key={page.id} value={page.id}>{page.page_name || page.page_id}</MenuItem>)}
                                    </TextField>
                                    <Grid container spacing={1}>
                                        <Grid size={{ xs: 6 }}><TextField fullWidth type="number" label={t('messengerBot.priority')} value={flowForm.priority} onChange={e => setFlowForm(prev => ({ ...prev, priority: e.target.value }))} /></Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <TextField select fullWidth label={t('messengerBot.fields.status')} value={flowForm.status} onChange={e => setFlowForm(prev => ({ ...prev, status: e.target.value }))}>
                                                <MenuItem value="draft">{t('messengerBot.statuses.draft')}</MenuItem>
                                                <MenuItem value="active">{t('messengerBot.statuses.active')}</MenuItem>
                                                <MenuItem value="paused">{t('messengerBot.statuses.paused')}</MenuItem>
                                            </TextField>
                                        </Grid>
                                    </Grid>
                                </Stack>
                            </Paper>
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
                                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.trigger')}</Typography>
                                <Stack spacing={2}>
                                    <TextField select fullWidth label="Trigger" value={flowForm.trigger_type} onChange={e => setFlowForm(prev => ({ ...prev, trigger_type: e.target.value }))}>
                                        {Object.entries(triggerOptions).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                                    </TextField>
                                    <Alert severity="info">{triggerHelpText[flowForm.trigger_type]}</Alert>
                                    <TextField
                                        fullWidth
                                        label={t('messengerBot.triggerValue')}
                                        value={flowForm.trigger_value}
                                        onChange={e => setFlowForm(prev => ({ ...prev, trigger_value: e.target.value }))}
                                        disabled={['welcome', 'fallback', 'menu'].includes(flowForm.trigger_type)}
                                        helperText={t('messengerBot.triggerHelper')}
                                    />
                                </Stack>
                            </Paper>
                        </Grid>

                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
                                <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.validation')}</Typography>
                                <DiagnosticsPanel diagnostics={diagnostics} t={t} />
                                {preview && (
                                    <Alert severity="info" sx={{ mt: 1 }}>
                                        {preview.message}
                                        {preview.products?.length > 0 && (
                                            <Box sx={{ mt: 1 }}>{preview.products.map(product => product.name).join(', ')}</Box>
                                        )}
                                    </Alert>
                                )}
                            </Paper>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight={800}>{t('messengerBot.replySteps')}</Typography>
                                        <Typography variant="caption" color="text.secondary">{t('messengerBot.replyStepsHint')}</Typography>
                                    </Box>
                                    <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={addNode}>{t('messengerBot.addStep')}</Button>
                                </Stack>

                                <Stack spacing={2}>
                                    {flowForm.nodes.map((node, nodeIndex) => (
                                        <Paper key={`node-${nodeIndex}`} variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                            <Grid container spacing={2}>
                                                <Grid size={{ xs: 12, md: 2 }}>
                                                    <TextField
                                                        fullWidth
                                                        label={t('messengerBot.nodeKey')}
                                                        value={node.node_key}
                                                        onChange={e => updateNode(nodeIndex, { node_key: e.target.value })}
                                                        disabled={nodeIndex === 0}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 3 }}>
                                                    <TextField select fullWidth label={t('messengerBot.nodeType')} value={node.node_type} onChange={e => updateNode(nodeIndex, { node_type: e.target.value })}>
                                                        {Object.entries(nodeTypeOptions).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 6 }}>
                                                    <TextField fullWidth label={t('messengerBot.internalTitle')} value={node.title} onChange={e => updateNode(nodeIndex, { title: e.target.value })} />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 1 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <IconButton disabled={nodeIndex === 0} color="error" onClick={() => removeNode(nodeIndex)}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Grid>
                                                <Grid size={{ xs: 12 }}>
                                                    <TextField fullWidth multiline minRows={2} label={t('messengerBot.replyText')} value={node.body} onChange={e => updateNode(nodeIndex, { body: e.target.value })} />
                                                </Grid>

                                                {node.node_type === 'product_list' && (
                                                    <>
                                                        <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth label={t('messengerBot.fields.productCategory')} value={node.category} onChange={e => updateNode(nodeIndex, { category: e.target.value })} helperText={t('messengerBot.fields.productCategoryHelp')} /></Grid>
                                                        <Grid size={{ xs: 12, md: 2 }}><TextField fullWidth type="number" label={t('messengerBot.fields.count')} value={node.limit} onChange={e => updateNode(nodeIndex, { limit: e.target.value })} /></Grid>
                                                        <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label={t('messengerBot.fields.emptyProductsText')} value={node.empty_text} onChange={e => updateNode(nodeIndex, { empty_text: e.target.value })} /></Grid>
                                                        <Grid size={{ xs: 12 }}>
                                                            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                                                                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.fields.productCard')}</Typography>
                                                                <Grid container spacing={1}>
                                                                    <Grid size={{ xs: 12, md: 6 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            size="small"
                                                                            label={t('messengerBot.fields.cardTitleTemplate')}
                                                                            value={node.card_title_template}
                                                                            onChange={e => updateNode(nodeIndex, { card_title_template: e.target.value })}
                                                                            helperText={productTemplateHelp}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 6 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            size="small"
                                                                            label={t('messengerBot.fields.cardSubtitleTemplate')}
                                                                            value={node.card_subtitle_template}
                                                                            onChange={e => updateNode(nodeIndex, { card_subtitle_template: e.target.value })}
                                                                            helperText={t('messengerBot.cardSubtitleHelp', { help: productTemplateHelp })}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_image)} onChange={e => updateNode(nodeIndex, { card_show_image: e.target.checked })} />} label={t('messengerBot.fields.image')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_price)} onChange={e => updateNode(nodeIndex, { card_show_price: e.target.checked })} />} label={t('messengerBot.price')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_description)} onChange={e => updateNode(nodeIndex, { card_show_description: e.target.checked })} />} label={t('messengerBot.description')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_category)} onChange={e => updateNode(nodeIndex, { card_show_category: e.target.checked })} />} label={t('messengerBot.category')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_sku)} onChange={e => updateNode(nodeIndex, { card_show_sku: e.target.checked })} />} label="SKU" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_details_button)} onChange={e => updateNode(nodeIndex, { card_show_details_button: e.target.checked })} />} label={t('messengerBot.fields.detailsButton')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.detailsButtonText')} value={node.card_details_label} onChange={e => updateNode(nodeIndex, { card_details_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_inquiry_button)} onChange={e => updateNode(nodeIndex, { card_show_inquiry_button: e.target.checked })} />} label={t('messengerBot.fields.inquiryButton')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.inquiryButtonText')} value={node.card_inquiry_label} onChange={e => updateNode(nodeIndex, { card_inquiry_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.card_show_link_button)} onChange={e => updateNode(nodeIndex, { card_show_link_button: e.target.checked })} />} label={t('messengerBot.fields.linkButton')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.linkButtonText')} value={node.card_link_label} onChange={e => updateNode(nodeIndex, { card_link_label: e.target.value })} />
                                                                    </Grid>
                                                                </Grid>
                                                            </Paper>
                                                        </Grid>
                                                        <Grid size={{ xs: 12 }}>
                                                            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                                                                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.fields.productDetails')}</Typography>
                                                                <Grid container spacing={1}>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            size="small"
                                                                            label={t('messengerBot.fields.detailTitleTemplate')}
                                                                            value={node.detail_title_template}
                                                                            onChange={e => updateNode(nodeIndex, { detail_title_template: e.target.value })}
                                                                            helperText={productTemplateHelp}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            size="small"
                                                                            label={t('messengerBot.fields.detailSubtitleTemplate')}
                                                                            value={node.detail_subtitle_template}
                                                                            onChange={e => updateNode(nodeIndex, { detail_subtitle_template: e.target.value })}
                                                                            helperText={t('messengerBot.detailCardSubtitleHelp', { help: productTemplateHelp })}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 4 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            multiline
                                                                            minRows={2}
                                                                            size="small"
                                                                            label={t('messengerBot.fields.detailBodyTemplate')}
                                                                            value={node.detail_body_template}
                                                                            onChange={e => updateNode(nodeIndex, { detail_body_template: e.target.value })}
                                                                            helperText={t('messengerBot.detailBodyHelp', { help: productTemplateHelp })}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 6 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            size="small"
                                                                            label={t('messengerBot.fields.unavailableProductText')}
                                                                            value={node.detail_not_found_text}
                                                                            onChange={e => updateNode(nodeIndex, { detail_not_found_text: e.target.value })}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 6 }}>
                                                                        <TextField
                                                                            fullWidth
                                                                            size="small"
                                                                            label={t('messengerBot.fields.handoffTemplate')}
                                                                            value={node.detail_handoff_text_template}
                                                                            onChange={e => updateNode(nodeIndex, { detail_handoff_text_template: e.target.value })}
                                                                            helperText={productTemplateHelp}
                                                                        />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_images)} onChange={e => updateNode(nodeIndex, { detail_show_images: e.target.checked })} />} label={t('messengerBot.fields.images')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_price)} onChange={e => updateNode(nodeIndex, { detail_show_price: e.target.checked })} />} label={t('messengerBot.price')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_description)} onChange={e => updateNode(nodeIndex, { detail_show_description: e.target.checked })} />} label={t('messengerBot.description')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_category)} onChange={e => updateNode(nodeIndex, { detail_show_category: e.target.checked })} />} label={t('messengerBot.category')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_sku)} onChange={e => updateNode(nodeIndex, { detail_show_sku: e.target.checked })} />} label="SKU" />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 6, md: 2 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_link_text)} onChange={e => updateNode(nodeIndex, { detail_show_link_text: e.target.checked })} />} label={t('messengerBot.fields.linkAsText')} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_include_menu)} onChange={e => updateNode(nodeIndex, { detail_include_menu: e.target.checked })} />} label={t('messengerBot.fields.mainMenu')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.mainMenuText')} value={node.detail_menu_label} onChange={e => updateNode(nodeIndex, { detail_menu_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_include_products_reply)} onChange={e => updateNode(nodeIndex, { detail_include_products_reply: e.target.checked })} />} label={t('messengerBot.fields.moreProducts')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.productsText')} value={node.detail_products_label} onChange={e => updateNode(nodeIndex, { detail_products_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_inquiry_button)} onChange={e => updateNode(nodeIndex, { detail_show_inquiry_button: e.target.checked })} />} label={t('messengerBot.fields.inquiry')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.inquiryText')} value={node.detail_inquiry_label} onChange={e => updateNode(nodeIndex, { detail_inquiry_label: e.target.value })} />
                                                                    </Grid>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <FormControlLabel control={<Switch checked={Boolean(node.detail_show_link_button)} onChange={e => updateNode(nodeIndex, { detail_show_link_button: e.target.checked })} />} label={t('messengerBot.fields.linkButton')} />
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.linkText')} value={node.detail_link_label} onChange={e => updateNode(nodeIndex, { detail_link_label: e.target.value })} />
                                                                    </Grid>
                                                                </Grid>
                                                            </Paper>
                                                        </Grid>
                                                    </>
                                                )}

                                                {node.node_type !== 'handoff' && node.node_type !== 'end' && (
                                                    <Grid size={{ xs: 12 }}>
                                                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                                                            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>{t('messengerBot.fields.defaultReplies')}</Typography>
                                                            <Grid container spacing={1}>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <TextField
                                                                        select
                                                                        fullWidth
                                                                        size="small"
                                                                        label={t('messengerBot.fields.replyDisplay')}
                                                                        value={node.reply_display}
                                                                        onChange={e => updateNode(nodeIndex, { reply_display: e.target.value })}
                                                                    >
                                                                        <MenuItem value="quick_replies">Quick Replies</MenuItem>
                                                                        <MenuItem value="cards">{t('messengerBot.fields.cards')}</MenuItem>
                                                                    </TextField>
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label={t('messengerBot.fields.cardButtonText')}
                                                                        value={node.card_action_label}
                                                                        onChange={e => updateNode(nodeIndex, { card_action_label: e.target.value })}
                                                                        disabled={node.reply_display !== 'cards'}
                                                                    />
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <TextField
                                                                        fullWidth
                                                                        size="small"
                                                                        label={t('messengerBot.fields.replyCardsText')}
                                                                        value={node.reply_cards_text}
                                                                        onChange={e => updateNode(nodeIndex, { reply_cards_text: e.target.value })}
                                                                        disabled={node.reply_display !== 'cards'}
                                                                    />
                                                                </Grid>
                                                                <Grid size={{ xs: 12 }}><Divider /></Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <FormControlLabel control={<Switch checked={Boolean(node.include_menu)} onChange={e => updateNode(nodeIndex, { include_menu: e.target.checked })} />} label={t('messengerBot.fields.showMainMenu')} />
                                                                    <TextField fullWidth size="small" label={t('messengerBot.fields.mainMenuButtonText')} value={node.menu_label} onChange={e => updateNode(nodeIndex, { menu_label: e.target.value })} />
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <FormControlLabel control={<Switch checked={Boolean(node.include_products_reply)} onChange={e => updateNode(nodeIndex, { include_products_reply: e.target.checked })} />} label={t('messengerBot.fields.showProducts')} />
                                                                    <TextField fullWidth size="small" label={t('messengerBot.fields.productsButtonText')} value={node.products_reply_label} onChange={e => updateNode(nodeIndex, { products_reply_label: e.target.value })} />
                                                                </Grid>
                                                                <Grid size={{ xs: 12, md: 4 }}>
                                                                    <FormControlLabel control={<Switch checked={Boolean(node.include_handoff_reply)} onChange={e => updateNode(nodeIndex, { include_handoff_reply: e.target.checked })} />} label={t('messengerBot.fields.showHumanAgent')} />
                                                                    <TextField fullWidth size="small" label={t('messengerBot.fields.humanAgentButtonText')} value={node.handoff_reply_label} onChange={e => updateNode(nodeIndex, { handoff_reply_label: e.target.value })} />
                                                                </Grid>
                                                            </Grid>
                                                        </Paper>
                                                    </Grid>
                                                )}

                                                {node.node_type !== 'product_list' && node.node_type !== 'handoff' && node.node_type !== 'end' && (
                                                    <Grid size={{ xs: 12 }}>
                                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1 }}>
                                                            <Typography variant="subtitle2" fontWeight={800}>{t('messengerBot.fields.buttons')}</Typography>
                                                            <Stack direction="row" spacing={1} alignItems="center">
                                                                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addButton(nodeIndex)}>{t('messengerBot.fields.addButton')}</Button>
                                                            </Stack>
                                                        </Stack>
                                                        <Stack spacing={1}>
                                                            {node.buttons.map((button, buttonIndex) => (
                                                                <Grid container spacing={1} key={`button-${nodeIndex}-${buttonIndex}`}>
                                                                    <Grid size={{ xs: 12, md: 3 }}>
                                                                        <TextField fullWidth size="small" label={t('messengerBot.fields.buttonTitle')} value={button.title} onChange={e => updateButton(nodeIndex, buttonIndex, { title: e.target.value })} />
                                                                    </Grid>
                                                                    {node.reply_display === 'cards' && (
                                                                        <Grid size={{ xs: 12, md: 3 }}>
                                                                            <TextField fullWidth size="small" label={t('messengerBot.fields.cardDescription')} value={button.subtitle} onChange={e => updateButton(nodeIndex, buttonIndex, { subtitle: e.target.value })} />
                                                                        </Grid>
                                                                    )}
                                                                    <Grid size={{ xs: 12, md: 2 }}>
                                                                        <TextField select fullWidth size="small" label={t('messengerBot.fields.action')} value={button.action} onChange={e => updateButton(nodeIndex, buttonIndex, { action: e.target.value })}>
                                                                            {Object.entries(actionOptions).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                                                                        </TextField>
                                                                    </Grid>
                                                                    {button.action === 'products' && (
                                                                        <>
                                                                            <Grid size={{ xs: 12, md: 3 }}>
                                                                                <TextField fullWidth size="small" label={t('messengerBot.fields.optionalCategory')} value={button.category} onChange={e => updateButton(nodeIndex, buttonIndex, { category: e.target.value })} />
                                                                            </Grid>
                                                                            <Grid size={{ xs: 12 }}>
                                                                                <Alert severity="info" sx={{ py: 0 }}>
                                                                                    {t('messengerBot.fields.shortcutWarning')}
                                                                                </Alert>
                                                                            </Grid>
                                                                        </>
                                                                    )}
                                                                    {button.action === 'node' && (
                                                                        <Grid size={{ xs: 12, md: 3 }}>
                                                                            <TextField select fullWidth size="small" label={t('messengerBot.fields.step')} value={button.node_key} onChange={e => updateButton(nodeIndex, buttonIndex, { node_key: e.target.value })}>
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
                                                                                label={t('messengerBot.fields.optionImage')}
                                                                                value={button.image_url}
                                                                                onChange={e => updateButton(nodeIndex, buttonIndex, { image_url: e.target.value })}
                                                                            />
                                                                            <Button variant="outlined" size="small" component="label" sx={{ minWidth: 72 }}>
                                                                                {t('messengerBot.fields.upload')}
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
                                                                <Typography variant="caption" color="text.secondary">{t('messengerBot.fields.noButtons')}</Typography>
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
                    <Button onClick={() => setFlowDialog(false)}>{t('common.cancel')}</Button>
                    <Button variant="contained" onClick={saveFlow}>{t('common.save')}</Button>
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
