import React, { useState, useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
    Box,
    Container,
    Typography,
    Button,
    Grid,
    Card,
    CardContent,
    Chip,
    Divider,
    IconButton,
    Tooltip,
} from '@mui/material';
import {
    WhatsApp as WhatsAppIcon,
    Send as SendIcon,
    Dashboard as DashboardIcon,
    People as PeopleIcon,
    Assessment as AssessmentIcon,
    Description as TemplateIcon,
    Security as SecurityIcon,
    Speed as SpeedIcon,
    Api as ApiIcon,
    CheckCircle as CheckCircleIcon,
    ArrowBack as ArrowBackIcon,
    KeyboardArrowDown as ArrowDownIcon,
    Bolt as BoltIcon,
    PrivacyTip as PrivacyTipIcon,
} from '@mui/icons-material';

// ─── Data ────────────────────────────────────────────────────────────────────

const features = [
    {
        icon: <DashboardIcon sx={{ fontSize: 32 }} />,
        title: 'لوحة تحكم مركزية',
        desc: 'أدر جميع عملائك وحساباتهم على واتساب من مكان واحد بواجهة سهلة الاستخدام.',
        color: '#008069',
    },
    {
        icon: <SendIcon sx={{ fontSize: 32 }} />,
        title: 'إرسال جماعي ذكي',
        desc: 'أرسل رسائل مُجمَّعة باستخدام قوالب معتمدة من Meta مع تتبع فوري للحالة.',
        color: '#1976d2',
    },
    {
        icon: <PeopleIcon sx={{ fontSize: 32 }} />,
        title: 'إدارة عدة عملاء',
        desc: 'دعم نموذج SaaS متعدد المستأجرين (Multi-Tenant) مع عزل تام للبيانات.',
        color: '#9c27b0',
    },
    {
        icon: <TemplateIcon sx={{ fontSize: 32 }} />,
        title: 'قوالب رسائل',
        desc: 'أنشئ وأدر قوالب رسائل واتساب المعتمدة لحملاتك التسويقية والتشغيلية.',
        color: '#ed6c02',
    },
    {
        icon: <AssessmentIcon sx={{ fontSize: 32 }} />,
        title: 'تقارير وسجلات',
        desc: 'تتبع كل حدث ورسالة بسجلات تفصيلية فورية مع إحصائيات الأداء.',
        color: '#2e7d32',
    },
    {
        icon: <ApiIcon sx={{ fontSize: 32 }} />,
        title: 'تكامل API',
        desc: 'واجهة برمجية RESTful تُمكّن عملاءك من الربط مع أنظمتهم الداخلية بسهولة.',
        color: '#c62828',
    },
    {
        icon: <SecurityIcon sx={{ fontSize: 32 }} />,
        title: 'أمان عالي المستوى',
        desc: 'تشفير كامل للبيانات، مصادقة JWT، وحماية متقدمة لرموز الوصول.',
        color: '#0288d1',
    },
    {
        icon: <SpeedIcon sx={{ fontSize: 32 }} />,
        title: 'أداء فائق السرعة',
        desc: 'بنية تحتية محسّنة تضمن استجابة فائقة وموثوقية تشغيل عالية.',
        color: '#558b2f',
    },
];

const capabilities = [
    { icon: '☁️', title: 'Cloud API رسمي', desc: 'مبنية على واجهة Meta WhatsApp Cloud API الرسمية لضمان الاستقرار والامتثال.' },
    { icon: '🏢', title: 'Multi-Tenant جاهز', desc: 'بنية معزولة لكل عميل — بياناته ومحادثاته وإعداداته منفصلة تماماً.' },
    { icon: '⚡', title: 'استجابة فورية', desc: 'Webhook مباشر يضمن وصول الرسائل الواردة وتحديث الحالات في الوقت الفعلي.' },
    { icon: '🔒', title: 'أمان بالتصميم', desc: 'تشفير رموز الوصول، مصادقة JWT، وعزل تام بين بيانات المستأجرين.' },
];

const steps = [
    {
        num: '01',
        title: 'سجّل نشاطك التجاري',
        desc: 'أنشئ حسابك على المنصة وأضف بيانات شركتك خلال دقائق.',
        color: '#008069',
    },
    {
        num: '02',
        title: 'اربط حساب واتساب',
        desc: 'أدخل رمز الوصول (Access Token) واربط أرقام واتساب للأعمال الخاصة بك.',
        color: '#1976d2',
    },
    {
        num: '03',
        title: 'أضف عملاءك',
        desc: 'سجّل عملاءك في المنصة وامنحهم صلاحيات الوصول لبواباتهم المخصصة.',
        color: '#9c27b0',
    },
    {
        num: '04',
        title: 'ابدأ التواصل',
        desc: 'أرسل رسائل، أدر محادثات، وتابع التقارير في الوقت الفعلي.',
        color: '#ed6c02',
    },
];

const useCases = [
    {
        emoji: '🛒',
        title: 'التجارة الإلكترونية',
        desc: 'أرسل تأكيدات الطلبات، تحديثات الشحن، وإشعارات التوصيل لعملائك تلقائياً عبر واتساب.',
        tags: ['تأكيد الطلب', 'تتبع الشحن', 'إشعارات فورية'],
    },
    {
        emoji: '🏥',
        title: 'العيادات والمستشفيات',
        desc: 'تذكير بالمواعيد، نتائج الفحوصات، وإرشادات ما بعد الزيارة — كل ذلك عبر رسائل واتساب آمنة.',
        tags: ['تذكير المواعيد', 'نتائج الفحوص', 'خدمة المرضى'],
    },
    {
        emoji: '🏦',
        title: 'الخدمات المالية',
        desc: 'إشعارات المعاملات، تنبيهات الأمان، والتواصل مع العملاء بقناة موثوقة وفورية.',
        tags: ['إشعارات المعاملات', 'تنبيهات أمنية', 'دعم العملاء'],
    },
];



const FeatureCard = ({ icon, title, desc, color, delay = 0 }) => {
    const [hovered, setHovered] = useState(false);
    const [visible, setVisible] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const timer = setTimeout(() => {
            const observer = new IntersectionObserver(
                ([entry]) => { if (entry.isIntersecting) setVisible(true); },
                { threshold: 0.1 }
            );
            if (ref.current) observer.observe(ref.current);
            return () => observer.disconnect();
        }, delay);
        return () => clearTimeout(timer);
    }, [delay]);

    return (
        <Card
            ref={ref}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            elevation={0}
            sx={{
                height: '100%',
                border: '1px solid',
                borderColor: hovered ? color : 'rgba(0,0,0,0.07)',
                borderRadius: 3,
                cursor: 'default',
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(30px)',
                transition: `all 0.6s ease ${delay}ms`,
                '&:hover': {
                    boxShadow: `0 8px 32px ${color}25`,
                    transform: 'translateY(-6px)',
                },
            }}
        >
            <CardContent sx={{ p: 3.5 }}>
                <Box
                    sx={{
                        width: 64,
                        height: 64,
                        borderRadius: 3,
                        bgcolor: `${color}15`,
                        color: color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mb: 2.5,
                        transition: 'transform 0.3s',
                        transform: hovered ? 'scale(1.1) rotate(-5deg)' : 'scale(1)',
                    }}
                >
                    {icon}
                </Box>
                <Typography variant="h6" fontWeight={700} gutterBottom>
                    {title}
                </Typography>
                <Typography variant="body2" color="text.secondary" lineHeight={1.8}>
                    {desc}
                </Typography>
            </CardContent>
        </Card>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const LandingPage = () => {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 50);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const scrollTo = (id) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <Box sx={{ overflowX: 'hidden', bgcolor: '#fff', fontFamily: 'Cairo, sans-serif' }}>
            {/* Google Font */}
            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />

            {/* ── Navbar ─────────────────────────────────────── */}
            <Box
                component="nav"
                sx={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    left: 0,
                    zIndex: 1100,
                    transition: 'all 0.3s ease',
                    bgcolor: scrolled ? 'rgba(255,255,255,0.95)' : 'transparent',
                    backdropFilter: scrolled ? 'blur(20px)' : 'none',
                    boxShadow: scrolled ? '0 2px 16px rgba(0,0,0,0.09)' : 'none',
                    py: scrolled ? 1 : 2,
                }}
            >
                <Container maxWidth="lg">
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        {/* Logo */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box
                                sx={{
                                    width: 40,
                                    height: 40,
                                    bgcolor: '#008069',
                                    borderRadius: 2,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 4px 12px #00806940',
                                }}
                            >
                                <WhatsAppIcon sx={{ color: 'white', fontSize: 24 }} />
                            </Box>
                            <Typography
                                variant="h6"
                                fontWeight={800}
                                sx={{
                                    color: scrolled ? '#111' : 'white',
                                    fontFamily: 'Cairo, sans-serif',
                                    letterSpacing: 0.5,
                                }}
                            >
                                Wa Savana
                            </Typography>
                        </Box>

                        {/* Nav Links */}
                        <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 3, alignItems: 'center' }}>
                            {[
                                { label: 'المميزات', id: 'features' },
                                { label: 'كيف يعمل', id: 'how-it-works' },
                                { label: 'استخدامات المنصة', id: 'use-cases' },
                            ].map((item) => (
                                <Button
                                    key={item.id}
                                    onClick={() => scrollTo(item.id)}
                                    sx={{
                                        color: scrolled ? '#333' : 'rgba(255,255,255,0.9)',
                                        fontFamily: 'Cairo, sans-serif',
                                        fontWeight: 600,
                                        textTransform: 'none',
                                        fontSize: '0.95rem',
                                        '&:hover': { color: '#008069', bgcolor: 'transparent' },
                                    }}
                                >
                                    {item.label}
                                </Button>
                            ))}
                        </Box>

                        {/* CTA */}
                        <Button
                            component={RouterLink}
                            to="/login"
                            variant="contained"
                            endIcon={<ArrowBackIcon />}
                            sx={{
                                bgcolor: '#008069',
                                '&:hover': { bgcolor: '#005c4b', transform: 'translateY(-2px)' },
                                borderRadius: 2.5,
                                fontFamily: 'Cairo, sans-serif',
                                fontWeight: 700,
                                px: 3,
                                py: 1,
                                transition: 'all 0.2s',
                                boxShadow: '0 4px 12px #00806960',
                                textTransform: 'none',
                                fontSize: '0.95rem',
                            }}
                        >
                            ابدأ الآن
                        </Button>
                    </Box>
                </Container>
            </Box>

            {/* ── Hero Section ───────────────────────────────── */}
            <Box
                id="hero"
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'linear-gradient(135deg, #003d33 0%, #005c4b 40%, #008069 70%, #00a884 100%)',
                    pt: 10,
                    pb: 8,
                }}
            >
                {/* Decorative circles */}
                {[
                    { size: 500, top: -150, right: -100, opacity: 0.08 },
                    { size: 300, bottom: -80, left: -60, opacity: 0.06 },
                    { size: 180, top: '30%', left: '15%', opacity: 0.05 },
                ].map((c, i) => (
                    <Box
                        key={i}
                        sx={{
                            position: 'absolute',
                            width: c.size,
                            height: c.size,
                            borderRadius: '50%',
                            bgcolor: 'white',
                            opacity: c.opacity,
                            top: c.top,
                            bottom: c.bottom,
                            right: c.right,
                            left: c.left,
                            pointerEvents: 'none',
                        }}
                    />
                ))}

                {/* Floating WhatsApp icons */}
                {[
                    { top: '15%', left: '8%', size: 36, delay: '0s', opacity: 0.15 },
                    { top: '60%', left: '5%', size: 24, delay: '1s', opacity: 0.1 },
                    { top: '25%', right: '6%', size: 28, delay: '2s', opacity: 0.12 },
                    { bottom: '20%', right: '10%', size: 40, delay: '0.5s', opacity: 0.1 },
                ].map((f, i) => (
                    <WhatsAppIcon
                        key={i}
                        sx={{
                            position: 'absolute',
                            fontSize: f.size,
                            top: f.top,
                            bottom: f.bottom,
                            left: f.left,
                            right: f.right,
                            color: 'white',
                            opacity: f.opacity,
                            animation: `float 4s ease-in-out ${f.delay} infinite`,
                            '@keyframes float': {
                                '0%, 100%': { transform: 'translateY(0px)' },
                                '50%': { transform: 'translateY(-12px)' },
                            },
                        }}
                    />
                ))}

                <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
                    <Grid container spacing={6} alignItems="center">
                        <Grid size={{ xs: 12, md: 7 }}>
                            <Chip
                                icon={<BoltIcon sx={{ color: '#ffd700 !important', fontSize: 16 }} />}
                                label="منصة واتساب للأعمال — الجيل القادم"
                                sx={{
                                    bgcolor: 'rgba(255,255,255,0.12)',
                                    color: 'white',
                                    fontFamily: 'Cairo, sans-serif',
                                    fontWeight: 600,
                                    mb: 3,
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    backdropFilter: 'blur(10px)',
                                    px: 1,
                                }}
                            />
                            <Typography
                                variant="h2"
                                fontWeight={900}
                                sx={{
                                    color: 'white',
                                    fontFamily: 'Cairo, sans-serif',
                                    lineHeight: 1.25,
                                    mb: 2.5,
                                    fontSize: { xs: '2.2rem', md: '3rem', lg: '3.5rem' },
                                    textShadow: '0 2px 20px rgba(0,0,0,0.2)',
                                }}
                            >
                                أدر تواصل عملائك عبر
                                <Box
                                    component="span"
                                    sx={{
                                        display: 'block',
                                        background: 'linear-gradient(90deg, #ffd700, #fff)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                    }}
                                >
                                    واتساب للأعمال
                                </Box>
                                بكفاءة لا مثيل لها
                            </Typography>
                            <Typography
                                variant="h6"
                                sx={{
                                    color: 'rgba(255,255,255,0.82)',
                                    fontFamily: 'Cairo, sans-serif',
                                    fontWeight: 400,
                                    lineHeight: 1.9,
                                    mb: 4,
                                    maxWidth: 540,
                                }}
                            >
                                منصة SaaS متكاملة تُمكّنك من إدارة عدة حسابات واتساب للأعمال،
                                إرسال رسائل جماعية، وتتبع المحادثات — كل ذلك من لوحة تحكم مركزية واحدة.
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                <Button
                                    component={RouterLink}
                                    to="/login"
                                    variant="contained"
                                    size="large"
                                    endIcon={<ArrowBackIcon />}
                                    sx={{
                                        bgcolor: 'white',
                                        color: '#008069',
                                        fontFamily: 'Cairo, sans-serif',
                                        fontWeight: 800,
                                        textTransform: 'none',
                                        px: 4,
                                        py: 1.5,
                                        borderRadius: 3,
                                        fontSize: '1rem',
                                        '&:hover': {
                                            bgcolor: '#f0faf8',
                                            transform: 'translateY(-3px)',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                                        },
                                        transition: 'all 0.3s ease',
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                    }}
                                >
                                    سجّل الدخول وابدأ
                                </Button>
                                <Button
                                    onClick={() => scrollTo('features')}
                                    variant="outlined"
                                    size="large"
                                    endIcon={<ArrowDownIcon />}
                                    sx={{
                                        borderColor: 'rgba(255,255,255,0.5)',
                                        color: 'white',
                                        fontFamily: 'Cairo, sans-serif',
                                        fontWeight: 600,
                                        textTransform: 'none',
                                        px: 3,
                                        py: 1.5,
                                        borderRadius: 3,
                                        fontSize: '1rem',
                                        '&:hover': {
                                            borderColor: 'white',
                                            bgcolor: 'rgba(255,255,255,0.1)',
                                        },
                                    }}
                                >
                                    اكتشف المميزات
                                </Button>
                            </Box>

                            {/* Key facts */}
                            <Box sx={{ display: 'flex', gap: 3, mt: 4, flexWrap: 'wrap' }}>
                                {[
                                    'مبني على Meta Cloud API',
                                    'بيانات معزولة لكل عميل',
                                    'لوحة تحكم عربية بالكامل',
                                ].map((fact) => (
                                    <Box key={fact} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        <CheckCircleIcon sx={{ color: '#4ade80', fontSize: 18 }} />
                                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)', fontFamily: 'Cairo, sans-serif' }}>
                                            {fact}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Grid>

                        {/* Hero Visual */}
                        <Grid size={{ xs: 12, md: 5 }} sx={{ display: { xs: 'none', md: 'block' } }}>
                            <Box
                                sx={{
                                    position: 'relative',
                                    animation: 'heroFloat 6s ease-in-out infinite',
                                    '@keyframes heroFloat': {
                                        '0%, 100%': { transform: 'translateY(0)' },
                                        '50%': { transform: 'translateY(-18px)' },
                                    },
                                }}
                            >
                                {/* Mock Dashboard Card */}
                                <Box
                                    sx={{
                                        bgcolor: 'rgba(255,255,255,0.95)',
                                        borderRadius: 4,
                                        p: 3,
                                        boxShadow: '0 40px 80px rgba(0,0,0,0.3)',
                                        backdropFilter: 'blur(20px)',
                                        border: '1px solid rgba(255,255,255,0.3)',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                                        <Box sx={{ width: 40, height: 40, bgcolor: '#008069', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <WhatsAppIcon sx={{ color: 'white', fontSize: 22 }} />
                                        </Box>
                                        <Box>
                                            <Typography variant="subtitle2" fontWeight={700} color="#111">Wa Savana</Typography>
                                            <Typography variant="caption" color="text.secondary">لوحة التحكم</Typography>
                                        </Box>
                                        <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                                            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                                                <Box key={c} sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: c }} />
                                            ))}
                                        </Box>
                                    </Box>
                                    {/* Status row */}
                                    <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
                                        {[
                                            { label: 'إدارة العملاء', icon: '🏢', color: '#008069' },
                                            { label: 'إرسال الرسائل', icon: '💬', color: '#1976d2' },
                                            { label: 'تتبع الحالة', icon: '📊', color: '#2e7d32' },
                                        ].map((s) => (
                                            <Grid size={{ xs: 4 }} key={s.label}>
                                                <Box sx={{ bgcolor: `${s.color}10`, borderRadius: 2, p: 1.5, textAlign: 'center' }}>
                                                    <Typography sx={{ fontSize: '1.4rem', lineHeight: 1.4 }}>{s.icon}</Typography>
                                                    <Typography variant="caption" color="text.secondary" display="block">{s.label}</Typography>
                                                </Box>
                                            </Grid>
                                        ))}
                                    </Grid>
                                    {/* Mock message bubbles */}
                                    {[
                                        { text: 'مرحباً! طلبك جاهز للشحن 📦', dir: 'right', bg: '#dcf8c6' },
                                        { text: 'شكراً! متى سيصل؟', dir: 'left', bg: '#f0f0f0' },
                                        { text: 'سيصل خلال 24 ساعة ✅', dir: 'right', bg: '#dcf8c6' },
                                    ].map((m, i) => (
                                        <Box key={i} sx={{ display: 'flex', justifyContent: m.dir === 'right' ? 'flex-end' : 'flex-start', mb: 1 }}>
                                            <Box
                                                sx={{
                                                    bgcolor: m.bg,
                                                    px: 2,
                                                    py: 1,
                                                    borderRadius: 2.5,
                                                    maxWidth: '80%',
                                                    animation: `fadeIn 0.5s ease ${i * 0.2}s both`,
                                                    '@keyframes fadeIn': { from: { opacity: 0, transform: 'scale(0.9)' }, to: { opacity: 1, transform: 'scale(1)' } },
                                                }}
                                            >
                                                <Typography variant="caption" color="#111" sx={{ fontFamily: 'Cairo, sans-serif' }}>
                                                    {m.text}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>

                                {/* Floating badge */}
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        bottom: -20,
                                        left: -20,
                                        bgcolor: '#1976d2',
                                        color: 'white',
                                        px: 2,
                                        py: 1.5,
                                        borderRadius: 3,
                                        boxShadow: '0 4px 20px rgba(25,118,210,0.4)',
                                        animation: 'pulse 2s ease infinite',
                                        '@keyframes pulse': {
                                            '0%, 100%': { boxShadow: '0 4px 20px rgba(25,118,210,0.4)' },
                                            '50%': { boxShadow: '0 4px 30px rgba(25,118,210,0.7)' },
                                        },
                                    }}
                                >
                                    <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'Cairo, sans-serif', display: 'block' }}>
                                        ✓ رسالة جديدة
                                    </Typography>
                                    <Typography variant="caption" sx={{ opacity: 0.8, fontFamily: 'Cairo, sans-serif' }}>
                                        تم الإرسال بنجاح
                                    </Typography>
                                </Box>
                            </Box>
                        </Grid>
                    </Grid>
                </Container>
            </Box>

            {/* ── Capabilities Section ────────────────────────── */}
            <Box sx={{ bgcolor: '#111827', py: 8 }}>
                <Container maxWidth="lg">
                    <Typography
                        variant="overline"
                        sx={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 3, display: 'block', textAlign: 'center', mb: 4 }}
                    >
                        ما الذي يميّز المنصة تقنياً
                    </Typography>
                    <Grid container spacing={4}>
                        {capabilities.map((c, i) => (
                            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                                <Box sx={{ textAlign: 'center', px: 1 }}>
                                    <Typography sx={{ fontSize: '2.5rem', mb: 1.5 }}>{c.icon}</Typography>
                                    <Typography variant="subtitle1" fontWeight={700} color="white" sx={{ fontFamily: 'Cairo, sans-serif', mb: 1 }}>
                                        {c.title}
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Cairo, sans-serif', lineHeight: 1.8 }}>
                                        {c.desc}
                                    </Typography>
                                </Box>
                            </Grid>
                        ))}
                    </Grid>
                </Container>
            </Box>

            {/* ── Features Section ─────────────────────────────── */}
            <Box id="features" sx={{ py: { xs: 8, md: 12 }, bgcolor: '#f8fafb' }}>
                <Container maxWidth="lg">
                    {/* Section Header */}
                    <Box sx={{ textAlign: 'center', mb: 8 }}>
                        <Chip
                            label="المميزات"
                            sx={{ bgcolor: '#00806915', color: '#008069', fontFamily: 'Cairo, sans-serif', fontWeight: 700, mb: 2 }}
                        />
                        <Typography variant="h3" fontWeight={800} sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                            كل ما تحتاجه في منصة واحدة
                        </Typography>
                        <Typography variant="h6" color="text.secondary" sx={{ fontFamily: 'Cairo, sans-serif', fontWeight: 400, maxWidth: 600, mx: 'auto', lineHeight: 1.8 }}>
                            منصة شاملة مصممة لتبسيط إدارة واتساب للأعمال وتحقيق أقصى كفاءة تشغيلية.
                        </Typography>
                    </Box>

                    <Grid container spacing={3}>
                        {features.map((f, i) => (
                            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                                <FeatureCard {...f} delay={i * 60} />
                            </Grid>
                        ))}
                    </Grid>
                </Container>
            </Box>

            {/* ── How It Works ─────────────────────────────────── */}
            <Box id="how-it-works" sx={{ py: { xs: 8, md: 12 } }}>
                <Container maxWidth="md">
                    <Box sx={{ textAlign: 'center', mb: 8 }}>
                        <Chip
                            label="كيف يعمل"
                            sx={{ bgcolor: '#1976d215', color: '#1976d2', fontFamily: 'Cairo, sans-serif', fontWeight: 700, mb: 2 }}
                        />
                        <Typography variant="h3" fontWeight={800} sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                            ابدأ في 4 خطوات بسيطة
                        </Typography>
                        <Typography variant="h6" color="text.secondary" sx={{ fontFamily: 'Cairo, sans-serif', fontWeight: 400 }}>
                            الإعداد سريع ولا يتطلب خبرة تقنية متقدمة.
                        </Typography>
                    </Box>

                    <Box sx={{ position: 'relative' }}>
                        {/* Connecting line */}
                        <Box
                            sx={{
                                position: 'absolute',
                                right: { md: '50%' },
                                top: 0,
                                bottom: 0,
                                width: 2,
                                bgcolor: 'divider',
                                display: { xs: 'none', md: 'block' },
                                transform: 'translateX(50%)',
                            }}
                        />
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {steps.map((step, i) => (
                                <Box
                                    key={i}
                                    sx={{
                                        display: 'flex',
                                        gap: 3,
                                        flexDirection: { xs: 'column', md: i % 2 === 0 ? 'row' : 'row-reverse' },
                                        alignItems: { md: 'center' },
                                    }}
                                >
                                    <Box sx={{ flex: 1, textAlign: { md: i % 2 === 0 ? 'right' : 'left' } }}>
                                        <Typography
                                            variant="h1"
                                            fontWeight={900}
                                            sx={{
                                                color: `${step.color}18`,
                                                fontSize: '5rem',
                                                lineHeight: 1,
                                                fontFamily: 'monospace',
                                                mb: -1,
                                            }}
                                        >
                                            {step.num}
                                        </Typography>
                                        <Typography variant="h5" fontWeight={800} sx={{ fontFamily: 'Cairo, sans-serif', mb: 1, color: step.color }}>
                                            {step.title}
                                        </Typography>
                                        <Typography variant="body1" color="text.secondary" sx={{ fontFamily: 'Cairo, sans-serif', lineHeight: 1.9 }}>
                                            {step.desc}
                                        </Typography>
                                    </Box>

                                    {/* Center dot */}
                                    <Box
                                        sx={{
                                            width: 56,
                                            height: 56,
                                            borderRadius: '50%',
                                            bgcolor: step.color,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            boxShadow: `0 4px 16px ${step.color}50`,
                                            border: '4px solid white',
                                            zIndex: 1,
                                        }}
                                    >
                                        <Typography variant="subtitle1" fontWeight={800} color="white">
                                            {i + 1}
                                        </Typography>
                                    </Box>

                                    <Box sx={{ flex: 1 }} />
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </Container>
            </Box>

            {/* ── Use Cases ────────────────────────────────────── */}
            <Box id="use-cases" sx={{ py: { xs: 8, md: 12 }, bgcolor: '#f8fafb' }}>
                <Container maxWidth="lg">
                    <Box sx={{ textAlign: 'center', mb: 8 }}>
                        <Chip
                            label="استخدامات المنصة"
                            sx={{ bgcolor: '#9c27b015', color: '#9c27b0', fontFamily: 'Cairo, sans-serif', fontWeight: 700, mb: 2 }}
                        />
                        <Typography variant="h3" fontWeight={800} sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                            مناسبة لمختلف القطاعات
                        </Typography>
                        <Typography variant="h6" color="text.secondary" sx={{ fontFamily: 'Cairo, sans-serif', fontWeight: 400, maxWidth: 500, mx: 'auto' }}>
                            سواء كنت تدير متجراً أو عيادة أو خدمة مالية — المنصة مرنة لتلائم احتياجك.
                        </Typography>
                    </Box>
                    <Grid container spacing={3}>
                        {useCases.map((u, i) => (
                            <Grid size={{ xs: 12, md: 4 }} key={i}>
                                <Card
                                    elevation={0}
                                    sx={{
                                        height: '100%',
                                        border: '1px solid rgba(0,0,0,0.07)',
                                        borderRadius: 3,
                                        transition: 'all 0.3s',
                                        '&:hover': { boxShadow: '0 8px 32px rgba(0,0,0,0.1)', transform: 'translateY(-4px)', borderColor: '#008069' },
                                    }}
                                >
                                    <CardContent sx={{ p: 3.5 }}>
                                        <Typography sx={{ fontSize: '3rem', mb: 2, display: 'block', lineHeight: 1 }}>
                                            {u.emoji}
                                        </Typography>
                                        <Typography variant="h6" fontWeight={800} sx={{ fontFamily: 'Cairo, sans-serif', mb: 1.5 }}>
                                            {u.title}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'Cairo, sans-serif', lineHeight: 1.9, mb: 2.5 }}>
                                            {u.desc}
                                        </Typography>
                                        <Divider sx={{ mb: 2 }} />
                                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                            {u.tags.map((tag) => (
                                                <Chip
                                                    key={tag}
                                                    label={tag}
                                                    size="small"
                                                    sx={{ bgcolor: '#00806910', color: '#008069', fontFamily: 'Cairo, sans-serif', fontSize: '0.7rem' }}
                                                />
                                            ))}
                                        </Box>
                                    </CardContent>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                </Container>
            </Box>

            {/* ── CTA Section ──────────────────────────────────── */}
            <Box
                sx={{
                    py: { xs: 10, md: 14 },
                    background: 'linear-gradient(135deg, #003d33 0%, #005c4b 40%, #008069 100%)',
                    position: 'relative',
                    overflow: 'hidden',
                    textAlign: 'center',
                }}
            >
                <Box sx={{ position: 'absolute', top: -60, right: -60, width: 250, height: 250, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.05)' }} />
                <Box sx={{ position: 'absolute', bottom: -80, left: -40, width: 300, height: 300, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.04)' }} />
                <Container maxWidth="md" sx={{ position: 'relative', zIndex: 1 }}>
                    <Typography variant="h3" fontWeight={900} color="white" sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                        هل أنت مهتم بالمنصة؟
                    </Typography>
                    <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.8)', fontFamily: 'Cairo, sans-serif', fontWeight: 400, mb: 5 }}>
                        المنصة في مرحلة الإطلاق المبكر — سجّل الدخول وابدأ تجربتها واكتشف إمكاناتها بنفسك.
                    </Typography>
                    <Button
                        component={RouterLink}
                        to="/login"
                        variant="contained"
                        size="large"
                        endIcon={<ArrowBackIcon />}
                        sx={{
                            bgcolor: 'white',
                            color: '#008069',
                            fontFamily: 'Cairo, sans-serif',
                            fontWeight: 800,
                            textTransform: 'none',
                            px: 5,
                            py: 2,
                            borderRadius: 3,
                            fontSize: '1.1rem',
                            '&:hover': { bgcolor: '#f0faf8', transform: 'translateY(-3px)', boxShadow: '0 12px 30px rgba(0,0,0,0.25)' },
                            transition: 'all 0.3s ease',
                            boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
                        }}
                    >
                        سجّل الدخول وجرّب المنصة
                    </Button>
                </Container>
            </Box>

            {/* ── Footer ───────────────────────────────────────── */}
            <Box sx={{ bgcolor: '#0d1117', py: 6 }}>
                <Container maxWidth="lg">
                    <Grid container spacing={4} sx={{ mb: 4 }}>
                        <Grid size={{ xs: 2, md: 4 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                                <Box sx={{ width: 36, height: 36, bgcolor: '#008069', borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <WhatsAppIcon sx={{ color: 'white', fontSize: 20 }} />
                                </Box>
                                <Typography variant="h6" fontWeight={800} color="white" sx={{ fontFamily: 'Cairo, sans-serif' }}>
                                    Wa Savana
                                </Typography>
                            </Box>
                            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Cairo, sans-serif', lineHeight: 1.9 }}>
                                منصة متكاملة لإدارة واتساب للأعمال، تمكّنك من توسيع نطاق تواصلك مع عملائك بكفاءة واحترافية.
                            </Typography>
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <Typography variant="subtitle2" color="white" fontWeight={700} sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                                المنصة
                            </Typography>
                            {['المميزات', 'كيف يعمل', 'الأمان'].map((l) => (
                                <Typography key={l} variant="body2" sx={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'Cairo, sans-serif', mb: 1, cursor: 'pointer', '&:hover': { color: '#008069' }, transition: 'color 0.2s' }}>
                                    {l}
                                </Typography>
                            ))}
                        </Grid>
                        <Grid size={{ xs: 6, md: 2 }}>
                            <Typography variant="subtitle2" color="white" fontWeight={700} sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                                قانوني
                            </Typography>
                            <Typography
                                component={RouterLink}
                                to="/privacy-policy"
                                variant="body2"
                                sx={{
                                    color: 'rgba(255,255,255,0.45)',
                                    fontFamily: 'Cairo, sans-serif',
                                    display: 'block',
                                    mb: 1,
                                    textDecoration: 'none',
                                    '&:hover': { color: '#008069' },
                                    transition: 'color 0.2s',
                                }}
                            >
                                سياسة الخصوصية
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'Cairo, sans-serif', mb: 1 }}>
                                شروط الاستخدام
                            </Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Typography variant="subtitle2" color="white" fontWeight={700} sx={{ fontFamily: 'Cairo, sans-serif', mb: 2 }}>
                                جاهز للبدء؟
                            </Typography>
                            <Button
                                component={RouterLink}
                                to="/login"
                                variant="contained"
                                fullWidth
                                sx={{
                                    bgcolor: '#008069',
                                    '&:hover': { bgcolor: '#005c4b' },
                                    fontFamily: 'Cairo, sans-serif',
                                    fontWeight: 700,
                                    textTransform: 'none',
                                    borderRadius: 2,
                                    py: 1.2,
                                }}
                            >
                                تسجيل الدخول
                            </Button>
                        </Grid>
                    </Grid>

                    <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 3 }} />

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'Cairo, sans-serif' }}>
                            © {new Date().getFullYear()} Wa Savana. جميع الحقوق محفوظة.
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Tooltip title="واتساب">
                                <IconButton size="small" sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#25D366' } }}>
                                    <WhatsAppIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="سياسة الخصوصية">
                                <IconButton component={RouterLink} to="/privacy-policy" size="small" sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#008069' } }}>
                                    <PrivacyTipIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                </Container>
            </Box>
        </Box >
    );
};

export default LandingPage;
