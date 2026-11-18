import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, Button, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, Stack, ThemeProvider, Typography } from '@mui/material';
import { createAppTheme } from '../src/theme';
import ConnectionsDataWorkspace from '../src/pages/TenantPortal/ConnectionsDataWorkspace';
import { emptyWorkspaceSelection, workspaceSelectionKey, workspaceSelectionSummary } from '../src/pages/TenantPortal/connectionsDataPresentation';
import WorkspaceProductEditor from '../src/pages/TenantPortal/WorkspaceProductEditor';
import { emptyWorkspaceProductDraft } from '../src/pages/TenantPortal/workspaceProductPresentation';

// Presentation fixtures only, not a proposed server API. No App/AuthProvider,
// credentials, backend, actual organization or external effect is involved.
const ar = new URLSearchParams(window.location.search).get('lang') !== 'en';
document.documentElement.lang = ar ? 'ar' : 'en';
document.documentElement.dir = ar ? 'rtl' : 'ltr';
window.fetch = async () => { throw new Error('Synthetic workspace prohibits network requests'); };
window.XMLHttpRequest = class { open() { throw new Error('Synthetic workspace prohibits network requests'); } };
navigator.sendBeacon = () => false;
const fixtureEvents = [];
window.__workspaceFixture = { events: fixtureEvents, externalEffects: 0 };
const option = (value, arabic, english, enabled = true, reason = null) => ({ value, label: ar ? arabic : english, enabled, reason });
const baseChoices = {
    activities: [option('synthetic-activity-city', 'متجر المدينة', 'City shop'), option('synthetic-activity-coast', 'متجر الساحل', 'Coast shop')],
    purposes: [option('synthetic-purpose-product-read', 'عرض منتجات الكتالوج داخل النشاط', 'Browse catalog products in this activity')],
    providers: [option('synthetic-account-city', 'كتالوج متجر المدينة', 'City shop catalog'), option('synthetic-account-other', 'كتالوج فرع آخر', 'Another branch catalog', false, ar ? 'لا يوجد تفويض لهذا الحساب ضمن النشاط المختار.' : 'This account is not authorized for the selected activity.')],
    fields: [option('synthetic-field-name', 'اسم المنتج', 'Product name'), option('synthetic-field-price', 'السعر المنشور', 'Published price'), option('synthetic-field-media', 'صور المنتج', 'Product photos')],
    people: [option('synthetic-person-sara', 'سارة', 'Sara'), option('synthetic-person-team', 'فريق المتجر', 'Shop team')],
};

export const WorkspaceFixture = () => {
    const [verified, setVerified] = useState(true);
    const [selection, setSelection] = useState(emptyWorkspaceSelection);
    const [review, setReview] = useState(null);
    const [held, setHeld] = useState(false);
    const [result, setResult] = useState(null);
    const [permission, setPermission] = useState(true);
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [notice, setNotice] = useState('');
    const [sourceWrite, setSourceWrite] = useState(false);
    const [productMode, setProductMode] = useState(null);
    const [productDraft, setProductDraft] = useState(emptyWorkspaceProductDraft);
    const [productReview, setProductReview] = useState(null);
    const productFields = [
        { key: 'name', label: ar ? 'اسم المنتج' : 'Product name', enabled: sourceWrite, required: true },
        { key: 'description', label: ar ? 'الوصف' : 'Description', enabled: sourceWrite, clearable: true },
        { key: 'sku', label: ar ? 'رمز المنتج' : 'Product code', enabled: sourceWrite, clearable: true },
        { key: 'barcodes', label: ar ? 'الباركود' : 'Barcodes', enabled: sourceWrite, clearable: true },
        { key: 'base_unit', label: ar ? 'وحدة المنتج' : 'Product unit', enabled: sourceWrite, clearable: true },
        { key: 'price', label: ar ? 'السعر' : 'Price', enabled: sourceWrite && permission, clearable: true },
        { key: 'media', label: ar ? 'صور المنتج' : 'Product photos', enabled: sourceWrite, clearable: true },
    ];
    const openProduct = mode => {
        setProductReview(null);
        setProductDraft(mode === 'change' ? { ...emptyWorkspaceProductDraft(), name: ar ? 'قهوة المدينة' : 'City coffee', description: ar ? 'وصف العبوة الحالي' : 'Current package description' } : emptyWorkspaceProductDraft());
        setProductMode(mode);
    };
    const choices = { ...baseChoices, fields: baseChoices.fields.map(field => field.value === 'synthetic-field-price' ? { ...field, enabled: permission } : field) };
    const record = {
        key: 'synthetic-private-record-key', label: ar ? 'قهوة المدينة' : 'City coffee', sourceLabel: ar ? 'كتالوج متجر المدينة' : 'City shop catalog',
        stateLabel: ar ? 'منتج متاح' : 'Available product', freshnessLabel: ar ? 'بيانات حديثة' : 'Current data',
        freshnessDescription: ar ? 'آخر تحقق من المصدر قبل دقائق.' : 'The source was checked a few minutes ago.',
        summary: ar ? 'عبوة 250 غرامًا' : '250 gram pack',
        fields: [
            { key: 'name', label: ar ? 'اسم المنتج' : 'Product name', displayValue: ar ? 'قهوة المدينة' : 'City coffee', sourceLabel: ar ? 'كتالوج متجر المدينة' : 'City shop catalog' },
            { key: 'price', label: ar ? 'السعر المنشور' : 'Published price', displayValue: ar ? '25 دينارًا ليبيًا' : '25 LYD', sourceLabel: ar ? 'كتالوج متجر المدينة' : 'City shop catalog' },
        ],
        actions: [{ key: 'synthetic-change', label: ar ? 'طلب تعديل في المصدر' : 'Request a source change', enabled: sourceWrite,
            reason: ar ? 'عرض هذا الحساب يسمح بالقراءة. يحتاج التعديل إلى صلاحية إدارة منتجات المصدر.' : 'This account has read access. A change requires product management permission at the source.' }],
    };
    const reset = () => { setSelection(emptyWorkspaceSelection()); setReview(null); setResult(null); };
    const log = event => { fixtureEvents.push(event); setNotice(ar ? 'سُجل إجراء واجهة تجريبي؛ لا توجد آثار خارجية.' : 'A synthetic UI action was recorded; no external effects occurred.'); };
    return <ThemeProvider theme={createAppTheme(ar ? 'ar' : 'en')}><CssBaseline />
        <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
            <Stack spacing={1} sx={{ mb: 3 }}>
                <Alert severity="warning">{ar ? 'اختبار واجهة ببيانات مصطنعة فقط. لا يتصل بأي خدمة أو حساب عمل.' : 'Synthetic UI acceptance only. No service or business account is contacted.'}</Alert>
                <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button onClick={() => { setVerified(value => !value); reset(); }}>{ar ? 'تبديل تحقق الحساب' : 'Toggle account verification'}</Button>
                    <Button onClick={() => setPermission(value => !value)}>{ar ? 'تبديل صلاحية السعر' : 'Toggle price permission'}</Button>
                    <Button onClick={() => setSourceWrite(value => !value)}>{ar ? 'تبديل صلاحية تعديل المصدر' : 'Toggle source change permission'}</Button>
                    <Button onClick={() => { setHeld(true); setResult({ state: 'unknown', title: ar ? 'بانتظار تأكيد نتيجة الطلب' : 'Request outcome awaiting confirmation' }); }}>{ar ? 'محاكاة نتيجة غير محسومة' : 'Simulate unknown outcome'}</Button>
                </Stack>
                <Typography id="workspace-fixture-status" variant="caption">{ar ? 'آثار خارجية: 0' : 'External effects: 0'} · {ar ? 'إجراءات الواجهة: ' : 'UI actions: '}{fixtureEvents.length}</Typography>
                {notice && <Alert severity="info">{notice}</Alert>}
            </Stack>
            <ConnectionsDataWorkspace language={ar ? 'ar' : 'en'} context={{ verified, viewKey: verified ? 'synthetic-verified' : 'synthetic-disconnected',
                organizationLabel: ar ? 'المؤسسة التجريبية' : 'Synthetic organization', actorLabel: ar ? 'سارة' : 'Sara' }}
                onConnect={() => { setVerified(true); reset(); log('connect'); }} onRefresh={() => log('refresh')}
                connection={{ choices, selection, onSelectionChange: setSelection, review, onCancelReview: () => setReview(null), held, result,
                    onReview: () => { setReview({ key: `synthetic-reviewed-${fixtureEvents.length}`, canSubmit: true, viewKey: 'synthetic-verified', valid_until: new Date(Date.now() + 180_000).toISOString(), selectionKey: workspaceSelectionKey(selection), summary: workspaceSelectionSummary(selection, choices, ar ? 'ar' : 'en'),
                        message: ar ? 'سيُقدم طلب بالاختيارات المحددة. لا تبدأ مشاركة جديدة قبل تأكيد الاعتماد.' : 'A request will be submitted for these choices. New sharing begins only after confirmed approval.',
                        removedFields: [ar ? 'الوصف السابق' : 'Previous description'], removedPeople: [ar ? 'عضو سابق' : 'Previous member'] }); log('review'); },
                    onSubmit: () => { log('submit'); setHeld(true); setResult({ state: 'unknown', title: ar ? 'لم تتأكد النتيجة بعد' : 'Outcome not confirmed yet', message: ar ? 'التحقق متاح دون إعادة تقديم الطلب.' : 'Check status without submitting again.' }); },
                    onReconcile: () => { log('reconcile'); setHeld(false); setReview(null); setResult({ state: 'completed', title: ar ? 'تأكدت نتيجة الطلب التجريبي' : 'Synthetic request outcome confirmed' }); },
                }}
                capabilities={{ held, onRefresh: () => log('refresh-capabilities'), onAction: (capability, action) => log({ capability, action }), onNextAction: (capability, action) => log({ capability, action }), capabilities: [
                    { key: 'synthetic-product-read', label: ar ? 'تصفح المنتجات المشتركة' : 'Browse shared products',
                        availability: { state: 'available', message: ar ? 'يمكنك عرض البيانات المشتركة الحالية لهذا النشاط.' : 'You can browse the current shared data for this activity.' },
                        actions: [{ key: 'open', effect: 'read', label: ar ? 'تصفح البيانات' : 'Browse data', enabled: true }] },
                    { key: 'synthetic-content', label: ar ? 'تجهيز محتوى للنشر' : 'Prepare content for publication',
                        availability: { state: 'provider_selection_required', message: ar ? 'لم يُختر حساب نشر جاهز ضمن النشاط.' : 'A ready publishing account has not been selected for the activity.',
                            next_action: { code: 'choose_provider', label: ar ? 'اختيار حساب النشر' : 'Choose publishing account' } } },
                ] }}
                sharedData={{ held, browseAction: { key: 'records.browse', label: ar ? 'تصفح المنتجات' : 'Browse products', enabled: verified, effect: 'read' }, query, onQueryChange: setQuery, onSearch: () => { setSearch(query); log('search'); }, records: !search || record.label.toLowerCase().includes(search.toLowerCase()) ? [record] : [],
                    onDetail: () => log('detail'), onCreate: () => openProduct('create'), onAction: () => openProduct('change'), createAction: { key: 'synthetic-create', label: ar ? 'إضافة منتج في المصدر' : 'Create a product at source', enabled: sourceWrite,
                        reason: ar ? 'يلزم تفويض إدارة منتجات المصدر لهذا الحساب.' : 'This account needs source product management permission.' },
                }} />
            <WorkspaceProductEditor open={Boolean(productMode) && !productReview} mode={productMode || 'create'} sourceLabel={record.sourceLabel} recordLabel={productMode === 'change' ? record.label : null}
                draft={productDraft} fields={productFields} verified={verified} held={held} onChange={setProductDraft} onClose={() => setProductMode(null)}
                units={[option('synthetic-unit-package', 'عبوة', 'Package')]}
                priceChoices={[option('synthetic-price-shop', 'سعر المتجر · دينار ليبي لكل عبوة', 'Shop price · LYD per package')]}
                mediaChoices={[option('synthetic-media-front', 'الصورة الأمامية للعبوة', 'Package front photo')]}
                onReview={selection => { setProductReview(selection); log('review-product'); }} language={ar ? 'ar' : 'en'} />
            <Dialog open={Boolean(productReview)} onClose={() => setProductReview(null)} fullWidth aria-labelledby="synthetic-product-review-title"><DialogTitle id="synthetic-product-review-title">{ar ? 'مراجعة تغيير المنتج' : 'Review product change'}</DialogTitle>
                <DialogContent><Stack spacing={2}><Alert severity="info">{ar ? 'مراجعة مصطنعة فقط. لا يوجد إرسال أو تعديل في مصدر.' : 'Synthetic review only. No source submission or change occurs.'}</Alert>
                    {(productReview?.summary || []).map(row => <Box key={row.key}><Typography fontWeight={700}>{row.label}</Typography><Typography sx={{ overflowWrap: 'anywhere' }}>{row.value}</Typography></Box>)}
                    {(productReview?.clearFields || []).map(key => <Typography key={key}>{ar ? 'سيُمسح: ' : 'Will clear: '}{productFields.find(field => field.key === key)?.label}</Typography>)}
                </Stack></DialogContent><DialogActions><Button onClick={() => setProductReview(null)}>{ar ? 'العودة للتعديل' : 'Back to editing'}</Button><Button onClick={() => { log('close-product-review'); setProductReview(null); setProductMode(null); }}>{ar ? 'إغلاق المراجعة المصطنعة' : 'Close synthetic review'}</Button></DialogActions>
            </Dialog>
        </Box>
    </ThemeProvider>;
};

createRoot(document.getElementById('root')).render(<WorkspaceFixture />);
