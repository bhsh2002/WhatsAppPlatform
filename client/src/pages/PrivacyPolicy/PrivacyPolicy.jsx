import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Container,
    Typography,
    Paper,
    Divider,
    Button,
    Grid,
    Chip
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    Security as SecurityIcon,
    Info as InfoIcon,
    Share as ShareIcon,
    Shield as ShieldIcon,
    ManageAccounts as ManageAccountsIcon,
    Update as UpdateIcon,
    ContactMail as ContactMailIcon,
    CheckCircle as CheckCircleIcon
} from '@mui/icons-material';

const sections = [
    {
        id: 'collection',
        icon: <InfoIcon />,
        title: 'أولاً: البيانات التي نجمعها',
        color: '#008069',
        content: [
            {
                subtitle: 'بيانات الحساب',
                points: [
                    'اسم المستخدم وكلمة المرور المشفرة.',
                    'الاسم الكامل وعنوان البريد الإلكتروني.',
                    'نوع الحساب (مسؤول أو عميل).',
                ],
            },
            {
                subtitle: 'بيانات الاتصال عبر واتساب',
                points: [
                    'أرقام الهاتف المرتبطة بحسابات واتساب للأعمال.',
                    'رموز التحقق (Access Tokens) الخاصة بتطبيق واتساب للأعمال.',
                    'معرفات الأرقام الهاتفية وحسابات الأعمال.',
                ],
            },
            {
                subtitle: 'بيانات الرسائل والمحادثات',
                points: [
                    'الرسائل المرسلة والمستقبلة عبر المنصة.',
                    'سجلات المحادثات وتواريخها.',
                    'قوالب الرسائل المنشأة والمستخدمة.',
                    'بيانات جهات الاتصال الخارجية التي يتم التواصل معها.',
                ],
            },
            {
                subtitle: 'بيانات الاستخدام التقني',
                points: [
                    'سجلات النظام (System Logs) لأغراض المراقبة واستكشاف الأخطاء.',
                    'بيانات الجلسة وعناوين IP.',
                    'إحصائيات استخدام المنصة (عدد الرسائل، معدلات النجاح).',
                ],
            },
        ],
    },
    {
        id: 'usage',
        icon: <CheckCircleIcon />,
        title: 'ثانياً: كيف نستخدم بياناتك',
        color: '#1976d2',
        content: [
            {
                subtitle: 'تشغيل الخدمة',
                points: [
                    'توفير خدمة إرسال واستقبال الرسائل عبر واتساب للأعمال.',
                    'إدارة حسابات المستخدمين والمصادقة والتحقق من الهوية.',
                    'عرض المحادثات وسجلات الرسائل في لوحة التحكم.',
                ],
            },
            {
                subtitle: 'تحسين الخدمة',
                points: [
                    'مراقبة أداء المنصة وتحديد الأعطال التقنية.',
                    'تحليل أنماط الاستخدام لتطوير الميزات.',
                    'الاحتفاظ بسجلات التدقيق لأغراض الأمان.',
                ],
            },
            {
                subtitle: 'التواصل',
                points: [
                    'إرسال إشعارات تقنية عند الضرورة.',
                    'التواصل بشأن تحديثات الخدمة أو سياسة الاستخدام.',
                ],
            },
        ],
    },
    {
        id: 'sharing',
        icon: <ShareIcon />,
        title: 'ثالثاً: مشاركة البيانات مع الأطراف الثالثة',
        color: '#ed6c02',
        content: [
            {
                subtitle: 'لا نبيع بياناتك',
                points: [
                    'نؤكد بشكل قاطع أننا لا نبيع بياناتك الشخصية أو بيانات أعمالك لأي طرف ثالث.',
                ],
            },
            {
                subtitle: 'مشاركة محدودة وضرورية',
                points: [
                    'واتساب للأعمال (Meta): نتواصل مع واجهة برمجة تطبيقات واتساب (Cloud API) لإرسال واستقبال الرسائل، وتخضع هذه البيانات لسياسة خصوصية Meta.',
                    'مزودو الخوادم: قد تُخزَّن بياناتك على خوادم سحابية لأغراض التشغيل، ويلتزم هؤلاء المزودون بمعايير أمان صارمة.',
                    'الامتثال القانوني: قد نكشف عن بيانات إذا طلب ذلك قانونياً أو بموجب أمر قضائي.',
                ],
            },
        ],
    },
    {
        id: 'security',
        icon: <ShieldIcon />,
        title: 'رابعاً: أمن البيانات',
        color: '#9c27b0',
        content: [
            {
                subtitle: 'التدابير الأمنية المتخذة',
                points: [
                    'تشفير كلمات المرور باستخدام خوارزميات آمنة (bcrypt).',
                    'استخدام بروتوكول HTTPS لتشفير جميع الاتصالات.',
                    'المصادقة بالرمز المميز (JWT) لحماية جلسات المستخدمين.',
                    'تشفير رموز الوصول (Access Tokens) المخزنة في قاعدة البيانات.',
                    'مراقبة مستمرة للسجلات للكشف عن أي نشاط مشبوه.',
                ],
            },
            {
                subtitle: 'تنبيه هام',
                points: [
                    'لا يوجد نظام رقمي آمن بنسبة 100%. ننصحك باستخدام كلمة مرور قوية وعدم مشاركة بيانات دخولك مع أي شخص.',
                ],
            },
        ],
    },
    {
        id: 'rights',
        icon: <ManageAccountsIcon />,
        title: 'خامساً: حقوقك كمستخدم',
        color: '#2e7d32',
        content: [
            {
                subtitle: 'حقوقك المكفولة',
                points: [
                    'الوصول: يحق لك طلب الاطلاع على البيانات الشخصية التي نحتفظ بها عنك.',
                    'التصحيح: يحق لك طلب تصحيح أي بيانات غير دقيقة.',
                    'الحذف: يحق لك طلب حذف حسابك وبياناتك، مع مراعاة متطلبات الاحتفاظ القانونية.',
                    'الاعتراض: يحق لك الاعتراض على معالجة بياناتك في حالات معينة.',
                    'قابلية النقل: يحق لك طلب نسخة من بياناتك بتنسيق قابل للقراءة.',
                ],
            },
        ],
    },
    {
        id: 'retention',
        icon: <UpdateIcon />,
        title: 'سادساً: مدة الاحتفاظ بالبيانات',
        color: '#0288d1',
        content: [
            {
                subtitle: 'مبادئ الاحتفاظ',
                points: [
                    'بيانات الحساب: يتم الاحتفاظ بها طوال فترة نشاط الحساب.',
                    'سجلات الرسائل: يتم الاحتفاظ بها لمدة تشغيلية كافية لخدمة المستخدم.',
                    'سجلات النظام: يتم الاحتفاظ بها لفترة محدودة تكفي للتدقيق الأمني.',
                    'عند إغلاق الحساب أو انتهاء العقد، يتم حذف البيانات أو إخفاء هويتها خلال مدة معقولة.',
                ],
            },
        ],
    },
    {
        id: 'contact',
        icon: <ContactMailIcon />,
        title: 'سابعاً: التواصل معنا',
        color: '#c62828',
        content: [
            {
                subtitle: 'للاستفسارات والطلبات',
                points: [
                    'إذا كان لديك أي أسئلة حول هذه السياسة أو ترغب في ممارسة حقوقك، يرجى التواصل مع مسؤول النظام لديك.',
                    'يمكنك أيضاً التواصل مع فريق الدعم التقني.',
                ],
            },
        ],
    },
];

const PrivacyPolicy = () => {
    const navigate = useNavigate();

    return (
        <Box
            sx={{
                minHeight: '100vh',
                bgcolor: '#f4f6f8',
                py: { xs: 4, md: 6 },
            }}
        >
            <Container maxWidth="md">
                {/* Header */}
                <Paper
                    elevation={0}
                    sx={{
                        background: 'linear-gradient(135deg, #008069 0%, #005c4b 100%)',
                        color: 'white',
                        borderRadius: 4,
                        p: { xs: 3, md: 5 },
                        mb: 4,
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                >
                    <Box
                        sx={{
                            position: 'absolute',
                            top: -30,
                            left: -30,
                            width: 150,
                            height: 150,
                            borderRadius: '50%',
                            bgcolor: 'rgba(255,255,255,0.07)',
                        }}
                    />
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: -50,
                            right: -20,
                            width: 200,
                            height: 200,
                            borderRadius: '50%',
                            bgcolor: 'rgba(255,255,255,0.05)',
                        }}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                        <Box
                            sx={{
                                bgcolor: 'rgba(255,255,255,0.15)',
                                borderRadius: 2,
                                p: 1,
                                display: 'flex',
                            }}
                        >
                            <SecurityIcon sx={{ fontSize: 32 }} />
                        </Box>
                        <Typography variant="h4" fontWeight={700}>
                            سياسة الخصوصية
                        </Typography>
                    </Box>
                    <Typography variant="body1" sx={{ opacity: 0.9, maxWidth: 600, lineHeight: 1.8 }}>
                        نحن في منصة مراقب واتساب نلتزم بحماية خصوصيتك وبياناتك. توضح هذه الوثيقة
                        كيفية جمع معلوماتك، واستخدامها، وحمايتها، وحقوقك كمستخدم للمنصة.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 3, flexWrap: 'wrap' }}>
                        <Chip
                            label="آخر تحديث: أبريل 2025"
                            size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
                        />
                        <Chip
                            label="الإصدار 1.0"
                            size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
                        />
                    </Box>
                </Paper>

                {/* Sections */}
                {sections.map((section, idx) => (
                    <Paper
                        key={section.id}
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            mb: 3,
                            overflow: 'hidden',
                            border: '1px solid rgba(0,0,0,0.06)',
                            transition: 'box-shadow 0.2s',
                            '&:hover': { boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
                        }}
                    >
                        {/* Section Header */}
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                px: 3,
                                py: 2.5,
                                bgcolor: `${section.color}10`,
                                borderBottom: `3px solid ${section.color}`,
                            }}
                        >
                            <Box
                                sx={{
                                    color: section.color,
                                    display: 'flex',
                                    background: `${section.color}18`,
                                    borderRadius: '50%',
                                    p: 1,
                                }}
                            >
                                {section.icon}
                            </Box>
                            <Typography variant="h6" fontWeight={700} color={section.color}>
                                {section.title}
                            </Typography>
                        </Box>

                        {/* Section Content */}
                        <Box sx={{ p: { xs: 2.5, md: 3.5 }, bgcolor: 'white' }}>
                            <Grid container spacing={3}>
                                {section.content.map((block, bIdx) => (
                                    <Grid size={{ xs: 12 }} key={bIdx}>
                                        <Typography
                                            variant="subtitle1"
                                            fontWeight={600}
                                            color="text.primary"
                                            gutterBottom
                                        >
                                            {block.subtitle}
                                        </Typography>
                                        <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
                                            {block.points.map((point, pIdx) => (
                                                <Box
                                                    component="li"
                                                    key={pIdx}
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: 1.5,
                                                        mb: 1,
                                                    }}
                                                >
                                                    <Box
                                                        sx={{
                                                            width: 7,
                                                            height: 7,
                                                            borderRadius: '50%',
                                                            bgcolor: section.color,
                                                            mt: '7px',
                                                            flexShrink: 0,
                                                        }}
                                                    />
                                                    <Typography
                                                        variant="body2"
                                                        color="text.secondary"
                                                        lineHeight={1.75}
                                                    >
                                                        {point}
                                                    </Typography>
                                                </Box>
                                            ))}
                                        </Box>
                                        {bIdx < section.content.length - 1 && (
                                            <Divider sx={{ mt: 2 }} />
                                        )}
                                    </Grid>
                                ))}
                            </Grid>
                        </Box>
                    </Paper>
                ))}

                {/* Footer */}
                <Paper
                    elevation={0}
                    sx={{
                        borderRadius: 3,
                        p: 3,
                        textAlign: 'center',
                        bgcolor: 'white',
                        border: '1px solid rgba(0,0,0,0.06)',
                        mb: 4,
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        باستخدامك لمنصة مراقب واتساب، فإنك توافق على سياسة الخصوصية هذه.
                        نحتفظ بحق تعديل هذه السياسة في أي وقت، وسيتم إخطارك بأي تغييرات جوهرية.
                    </Typography>
                </Paper>

                {/* Back Button */}
                <Box sx={{ textAlign: 'center' }}>
                    <Button
                        variant="contained"
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate(-1)}
                        sx={{
                            bgcolor: '#008069',
                            '&:hover': { bgcolor: '#005c4b' },
                            borderRadius: 2,
                            px: 4,
                            py: 1.2,
                        }}
                    >
                        العودة
                    </Button>
                </Box>
            </Container>
        </Box>
    );
};

export default PrivacyPolicy;
