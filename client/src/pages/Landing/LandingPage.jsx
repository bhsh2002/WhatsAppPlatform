import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
    Box,
    Button,
    Chip,
    Container,
    Divider,
    IconButton,
    Stack,
    Typography,
} from '@mui/material';
import {
    AllInbox as InboxIcon,
    ArrowBack as ArrowBackIcon,
    ArrowOutward as ArrowOutwardIcon,
    AutoAwesome as AutomationIcon,
    Bolt as BoltIcon,
    Campaign as CampaignIcon,
    CheckRounded as CheckIcon,
    Facebook as FacebookIcon,
    Hub as HubIcon,
    ImportExport as ImportExportIcon,
    Insights as InsightsIcon,
    Language as LanguageIcon,
    Payments as PaymentsIcon,
    PeopleAltOutlined as PeopleIcon,
    QrCode2 as QrCodeIcon,
    SecurityOutlined as SecurityIcon,
    SmartToyOutlined as BotIcon,
    WhatsApp as WhatsAppIcon,
} from '@mui/icons-material';
import { useLanguage } from '../../context/LanguageContext';

const palette = {
    ink: '#16352f',
    dark: '#0f2723',
    paper: '#f7f2e8',
    paperDeep: '#eee5d5',
    green: '#087f5b',
    greenSoft: '#d9eadf',
    coral: '#e56b4f',
    coralSoft: '#f8ddd3',
    gold: '#d6a746',
    line: '#d7ccba',
    muted: '#5d6d68',
};

const outcomeIcons = [InboxIcon, CampaignIcon, AutomationIcon, InsightsIcon];
const outcomeAccents = [palette.green, '#296c78', palette.coral, '#8b6325'];
const supportingFeatureIcons = [
    ImportExportIcon,
    FacebookIcon,
    BotIcon,
    QrCodeIcon,
    HubIcon,
    PaymentsIcon,
    SecurityIcon,
    PeopleIcon,
];

const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const SectionHeading = ({ eyebrow, title, description, align = 'start', light = false }) => (
    <Box sx={{ maxWidth: 760, mx: align === 'center' ? 'auto' : 0, textAlign: align }}>
        <Typography
            variant="overline"
            sx={{
                color: light ? '#9bd8bd' : palette.coral,
                fontWeight: 800,
                letterSpacing: '0.08em',
            }}
        >
            {eyebrow}
        </Typography>
        <Typography
            component="h2"
            sx={{
                mt: 1,
                color: light ? '#fffdf8' : palette.ink,
                fontSize: { xs: '2rem', md: '3.35rem' },
                fontWeight: 780,
                lineHeight: 1.25,
                letterSpacing: '-0.035em',
            }}
        >
            {title}
        </Typography>
        {description && (
            <Typography
                sx={{
                    mt: 2,
                    color: light ? 'rgba(255,255,255,0.72)' : palette.muted,
                    fontSize: { xs: '1rem', md: '1.1rem' },
                    lineHeight: 1.9,
                }}
            >
                {description}
            </Typography>
        )}
    </Box>
);

const LandingPage = () => {
    const { language, setLanguage, t } = useLanguage();
    const outcomes = ['inbox', 'campaigns', 'automation', 'insights'];
    const supportingFeatures = ['contacts', 'facebook', 'bot', 'qr', 'api', 'billing', 'security', 'tenants'];
    const journeySteps = ['connect', 'organize', 'automate', 'grow'];
    const useCases = ['retail', 'services', 'teams'];
    const plans = [
        { key: 'business', price: 120, credits: '10,000', messages: '2,000', featured: false },
        { key: 'growth', price: 550, credits: '50,000', messages: '10,000', featured: true },
    ];

    const navItems = [
        { id: 'features', label: t('landing.navFeatures') },
        { id: 'how-it-works', label: t('landing.navJourney') },
        { id: 'use-cases', label: t('landing.navUseCases') },
        { id: 'pricing', label: t('landing.navPricing') },
    ];

    return (
        <Box
            sx={{
                bgcolor: palette.paper,
                color: palette.ink,
                minHeight: '100vh',
                overflowX: 'clip',
                '& .MuiTypography-root': { wordBreak: 'normal', overflowWrap: 'break-word' },
                '& .MuiChip-label': { wordBreak: 'normal', overflowWrap: 'normal' },
            }}
        >
            <Box
                component="header"
                sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                    bgcolor: 'rgba(247,242,232,0.94)',
                    backdropFilter: 'blur(14px)',
                    borderBottom: `1px solid ${palette.line}`,
                }}
            >
                <Container maxWidth="xl">
                    <Box sx={{ minHeight: 72, display: 'flex', alignItems: 'center', gap: { xs: 1, md: 3 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexShrink: 0 }}>
                            <Box
                                sx={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: '13px 13px 4px 13px',
                                    bgcolor: palette.green,
                                    display: 'grid',
                                    placeItems: 'center',
                                    transform: 'rotate(-3deg)',
                                }}
                            >
                                <WhatsAppIcon sx={{ color: 'white', fontSize: 22, transform: 'rotate(3deg)' }} />
                            </Box>
                            <Typography
                                component="span"
                                sx={{ fontSize: { xs: '0.95rem', sm: '1.08rem' }, fontWeight: 850, whiteSpace: 'nowrap' }}
                            >
                                Wa Savana
                            </Typography>
                        </Box>

                        <Box component="nav" aria-label={t('landing.primaryNavigation')} sx={{ display: { xs: 'none', lg: 'flex' }, gap: 0.5, mx: 'auto' }}>
                            {navItems.map((item) => (
                                <Button
                                    key={item.id}
                                    onClick={() => scrollToSection(item.id)}
                                    sx={{ color: palette.ink, fontWeight: 650, px: 1.5 }}
                                >
                                    {item.label}
                                </Button>
                            ))}
                        </Box>

                        <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} sx={{ ml: 'auto', alignItems: 'center' }}>
                            <IconButton
                                aria-label={t('landing.languageSwitch')}
                                onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                                sx={{ color: palette.ink, border: `1px solid ${palette.line}` }}
                            >
                                <LanguageIcon fontSize="small" />
                            </IconButton>
                            <Button
                                component={RouterLink}
                                to="/login"
                                variant="contained"
                                sx={{
                                    bgcolor: palette.ink,
                                    color: 'white',
                                    borderRadius: '999px',
                                    px: { xs: 1.7, sm: 2.7 },
                                    fontSize: { xs: '0.78rem', sm: '0.875rem' },
                                    whiteSpace: 'nowrap',
                                    overflowWrap: 'normal',
                                    wordBreak: 'normal',
                                    boxShadow: 'none',
                                    fontWeight: 750,
                                    '&:hover': { bgcolor: palette.green, boxShadow: 'none' },
                                }}
                            >
                                {t('landing.navLogin')}
                            </Button>
                        </Stack>
                    </Box>
                </Container>
            </Box>

            <Box component="main">
                <Box id="hero" sx={{ position: 'relative', borderBottom: `1px solid ${palette.line}` }}>
                    <Container maxWidth="xl" sx={{ py: { xs: 7, md: 11 } }}>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.03fr) minmax(420px, 0.97fr)' },
                                alignItems: 'center',
                                gap: { xs: 7, lg: 9 },
                            }}
                        >
                            <Box sx={{ maxWidth: { xs: '100%', lg: 720 } }}>
                                <Chip
                                    label={t('landing.hero.eyebrow')}
                                    sx={{
                                        bgcolor: palette.coralSoft,
                                        color: '#8e3423',
                                        borderRadius: '7px',
                                        fontWeight: 750,
                                        mb: 3,
                                    }}
                                />
                                <Typography
                                    component="h1"
                                    sx={{
                                        fontSize: { xs: '2.25rem', sm: '3.15rem', md: '3.55rem', xl: '4.1rem' },
                                        fontWeight: 790,
                                        lineHeight: language === 'ar' ? 1.28 : 1.12,
                                        letterSpacing: language === 'ar' ? 0 : '-0.035em',
                                        color: palette.ink,
                                    }}
                                >
                                    <Box component="span" sx={{ display: 'block' }}>
                                        {t('landing.hero.title')}
                                    </Box>
                                    <Box component="span" sx={{ color: palette.coral, display: 'block', mt: { xs: 2, md: 2.5 } }}>
                                        {t('landing.hero.accent')}
                                    </Box>
                                </Typography>
                                <Typography sx={{ mt: 3, maxWidth: 650, color: palette.muted, fontSize: { xs: '1.05rem', md: '1.22rem' }, lineHeight: 1.95 }}>
                                    {t('landing.hero.description')}
                                </Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4, alignItems: { sm: 'center' } }}>
                                    <Button
                                        component={RouterLink}
                                        to="/login"
                                        variant="contained"
                                        size="large"
                                        endIcon={<ArrowBackIcon />}
                                        sx={{
                                            bgcolor: palette.green,
                                            borderRadius: '10px 10px 2px 10px',
                                            px: 3.5,
                                            py: 1.45,
                                            boxShadow: 'none',
                                            fontWeight: 780,
                                            '&:hover': { bgcolor: palette.ink, boxShadow: 'none' },
                                        }}
                                    >
                                        {t('landing.hero.primaryCta')}
                                    </Button>
                                    <Button
                                        onClick={() => scrollToSection('features')}
                                        size="large"
                                        endIcon={<ArrowOutwardIcon />}
                                        sx={{ color: palette.ink, fontWeight: 750, px: 2.5 }}
                                    >
                                        {t('landing.hero.secondaryCta')}
                                    </Button>
                                </Stack>
                                <Typography sx={{ mt: 3, color: palette.muted, fontSize: '0.88rem', fontWeight: 600 }}>
                                    {t('landing.hero.note')}
                                </Typography>
                            </Box>

                            <Box
                                aria-label={t('landing.desk.ariaLabel')}
                                sx={{
                                    position: 'relative',
                                    minWidth: 0,
                                    p: { xs: 2, sm: 3 },
                                    bgcolor: '#fffdf8',
                                    border: `1px solid ${palette.ink}`,
                                    borderRadius: '28px 28px 8px 28px',
                                    boxShadow: `14px 16px 0 ${palette.coral}`,
                                    transform: { lg: 'rotate(1.4deg)' },
                                    '&::before': {
                                        content: '""',
                                        position: 'absolute',
                                        width: 74,
                                        height: 24,
                                        top: -12,
                                        left: '14%',
                                        bgcolor: '#e4d1a9',
                                        opacity: 0.75,
                                        transform: 'rotate(-5deg)',
                                    },
                                }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, pb: 2, borderBottom: `1px solid ${palette.line}` }}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography sx={{ fontWeight: 800 }}>{t('landing.desk.title')}</Typography>
                                        <Typography sx={{ color: palette.muted, fontSize: '0.82rem' }}>{t('landing.desk.subtitle')}</Typography>
                                    </Box>
                                    <Chip label={t('landing.desk.status')} size="small" sx={{ bgcolor: palette.greenSoft, color: palette.green, fontWeight: 750, flexShrink: 0 }} />
                                </Box>

                                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '0.85fr 1.15fr' }, gap: 2, mt: 2 }}>
                                    <Box sx={{ bgcolor: palette.paper, borderRadius: '18px 18px 5px 18px', p: 2 }}>
                                        <Typography sx={{ color: palette.muted, fontSize: '0.76rem', fontWeight: 700, mb: 1.5 }}>
                                            {t('landing.desk.inbox')}
                                        </Typography>
                                        <Stack spacing={1.25}>
                                            {[0, 1, 2].map((index) => (
                                                <Box key={index} sx={{ display: 'flex', gap: 1.2, alignItems: 'center', p: 1, bgcolor: index === 0 ? '#fff' : 'transparent', borderRadius: 2 }}>
                                                    <Box sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: [palette.coralSoft, palette.greenSoft, '#d9e6ee'][index], flexShrink: 0 }} />
                                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                                        <Box sx={{ height: 6, width: index === 0 ? '72%' : '58%', bgcolor: palette.ink, opacity: 0.8, borderRadius: 9, mb: 0.7 }} />
                                                        <Box sx={{ height: 5, width: index === 1 ? '84%' : '64%', bgcolor: palette.line, borderRadius: 9 }} />
                                                    </Box>
                                                </Box>
                                            ))}
                                        </Stack>
                                    </Box>

                                    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                            <Box sx={{ width: 34, height: 34, bgcolor: palette.coralSoft, borderRadius: '50%', flexShrink: 0 }} />
                                            <Box sx={{ minWidth: 0 }}>
                                                <Typography sx={{ fontWeight: 780, fontSize: '0.88rem' }}>{t('landing.desk.contact')}</Typography>
                                                <Typography sx={{ color: palette.muted, fontSize: '0.72rem' }}>{t('landing.desk.channel')}</Typography>
                                            </Box>
                                        </Box>
                                        <Box sx={{ alignSelf: 'flex-start', bgcolor: palette.paperDeep, px: 1.5, py: 1.2, borderRadius: '14px 14px 14px 3px', maxWidth: '88%' }}>
                                            <Typography sx={{ fontSize: '0.83rem', lineHeight: 1.7 }}>{t('landing.desk.message')}</Typography>
                                        </Box>
                                        <Box sx={{ alignSelf: 'flex-end', bgcolor: palette.greenSoft, px: 1.5, py: 1.2, borderRadius: '14px 14px 3px 14px', maxWidth: '90%' }}>
                                            <Typography sx={{ fontSize: '0.83rem', lineHeight: 1.7 }}>{t('landing.desk.reply')}</Typography>
                                        </Box>
                                    </Box>
                                </Box>

                                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mt: 2 }}>
                                    <Box sx={{ border: `1px solid ${palette.line}`, p: 1.5, borderRadius: '12px 12px 3px 12px', display: 'flex', gap: 1.2, alignItems: 'center' }}>
                                        <CampaignIcon sx={{ color: '#296c78' }} />
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography sx={{ fontWeight: 760, fontSize: '0.78rem' }}>{t('landing.desk.campaign')}</Typography>
                                            <Typography sx={{ color: palette.muted, fontSize: '0.7rem' }}>{t('landing.desk.campaignState')}</Typography>
                                        </Box>
                                    </Box>
                                    <Box sx={{ border: `1px solid ${palette.line}`, p: 1.5, borderRadius: '12px 12px 12px 3px', display: 'flex', gap: 1.2, alignItems: 'center' }}>
                                        <BoltIcon sx={{ color: palette.coral }} />
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography sx={{ fontWeight: 760, fontSize: '0.78rem' }}>{t('landing.desk.automation')}</Typography>
                                            <Typography sx={{ color: palette.muted, fontSize: '0.7rem' }}>{t('landing.desk.automationState')}</Typography>
                                        </Box>
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    </Container>
                </Box>

                <Box sx={{ bgcolor: palette.ink, color: '#fffdf8' }}>
                    <Container maxWidth="xl">
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 0, py: { xs: 2, md: 0 } }}>
                            {['one', 'two', 'three'].map((item, index) => (
                                <Box
                                    key={item}
                                    sx={{
                                        py: 2.5,
                                        px: { xs: 0, md: 3 },
                                        borderInlineStart: { md: index ? '1px solid rgba(255,255,255,0.15)' : 'none' },
                                        display: 'flex',
                                        gap: 1.5,
                                        alignItems: 'center',
                                    }}
                                >
                                    <Typography sx={{ color: index === 1 ? '#f2b8a9' : '#9bd8bd', fontWeight: 850, fontSize: '1.05rem', direction: 'ltr', minWidth: 24, flexShrink: 0, whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal' }}>0{index + 1}</Typography>
                                    <Typography sx={{ fontWeight: 650, color: 'rgba(255,255,255,0.82)', whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal', fontSize: { xs: '0.88rem', sm: '0.95rem' } }}>{t(`landing.promises.${item}`)}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Container>
                </Box>

                <Box id="features" sx={{ py: { xs: 9, md: 14 }, scrollMarginTop: 80 }}>
                    <Container maxWidth="xl">
                        <SectionHeading
                            eyebrow={t('landing.features.eyebrow')}
                            title={t('landing.features.title')}
                            description={t('landing.features.subtitle')}
                        />

                        <Box sx={{ mt: { xs: 5, md: 8 }, borderTop: `1px solid ${palette.line}` }}>
                            {outcomes.map((key, index) => {
                                const Icon = outcomeIcons[index];
                                const accent = outcomeAccents[index];
                                return (
                                    <Box
                                        key={key}
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: { xs: '1fr', md: '88px minmax(230px, 0.85fr) minmax(0, 1.15fr)' },
                                            gap: { xs: 2, md: 4 },
                                            py: { xs: 4, md: 5 },
                                            borderBottom: `1px solid ${palette.line}`,
                                            alignItems: 'start',
                                        }}
                                    >
                                        <Box sx={{ width: 64, height: 64, bgcolor: `${accent}18`, color: accent, borderRadius: index % 2 ? '20px 6px 20px 20px' : '6px 20px 20px 20px', display: 'grid', placeItems: 'center' }}>
                                            <Icon sx={{ fontSize: 30 }} />
                                        </Box>
                                        <Typography component="h3" sx={{ color: palette.ink, fontSize: { xs: '1.45rem', md: '1.8rem' }, lineHeight: 1.35, fontWeight: 780 }}>
                                            {t(`landing.features.outcomes.${key}.title`)}
                                        </Typography>
                                        <Box>
                                            <Typography sx={{ color: palette.muted, lineHeight: 1.9, fontSize: '1.02rem' }}>
                                                {t(`landing.features.outcomes.${key}.description`)}
                                            </Typography>
                                            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ mt: 2 }}>
                                                {t(`landing.features.outcomes.${key}.items`).map((item) => (
                                                    <Chip key={item} label={item} size="small" sx={{ bgcolor: '#fffdf8', border: `1px solid ${palette.line}`, color: palette.ink, fontWeight: 650 }} />
                                                ))}
                                            </Stack>
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Box>

                        <Box sx={{ mt: { xs: 7, md: 10 } }}>
                            <Typography component="h2" sx={{ fontSize: { xs: '1.7rem', md: '2.2rem' }, fontWeight: 780, color: palette.ink, mb: 4 }}>
                                {t('landing.features.moreTitle')}
                            </Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
                                {supportingFeatures.map((key, index) => {
                                    const Icon = supportingFeatureIcons[index];
                                    return (
                                        <Box key={key} sx={{ p: 2.5, bgcolor: index % 3 === 1 ? palette.greenSoft : '#fffdf8', border: `1px solid ${palette.line}`, borderRadius: index % 2 ? '18px 4px 18px 18px' : '4px 18px 18px 18px' }}>
                                            <Icon sx={{ color: index % 3 === 1 ? palette.green : palette.coral, mb: 1.5 }} />
                                            <Typography component="h3" sx={{ fontWeight: 780, fontSize: '1rem', mb: 0.8 }}>{t(`landing.features.more.${key}.title`)}</Typography>
                                            <Typography sx={{ color: palette.muted, fontSize: '0.88rem', lineHeight: 1.75 }}>{t(`landing.features.more.${key}.description`)}</Typography>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                    </Container>
                </Box>

                <Box id="how-it-works" sx={{ bgcolor: palette.paperDeep, py: { xs: 9, md: 13 }, scrollMarginTop: 80 }}>
                    <Container maxWidth="xl">
                        <SectionHeading
                            eyebrow={t('landing.journey.eyebrow')}
                            title={t('landing.journey.title')}
                            description={t('landing.journey.subtitle')}
                        />
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, mt: { xs: 5, md: 8 } }}>
                            {journeySteps.map((key, index) => (
                                <Box key={key} sx={{ position: 'relative', pt: 2, pb: 4, px: { xs: 0, md: 2.5 }, borderTop: `2px solid ${index === 2 ? palette.coral : palette.ink}` }}>
                                    <Typography sx={{ color: index === 2 ? palette.coral : palette.green, fontWeight: 850, fontSize: '0.9rem' }}>0{index + 1}</Typography>
                                    <Typography component="h3" sx={{ mt: 2, mb: 1.2, color: palette.ink, fontWeight: 780, fontSize: '1.3rem' }}>{t(`landing.journey.steps.${key}.title`)}</Typography>
                                    <Typography sx={{ color: palette.muted, lineHeight: 1.8, fontSize: '0.94rem' }}>{t(`landing.journey.steps.${key}.description`)}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Container>
                </Box>

                <Box id="use-cases" sx={{ py: { xs: 9, md: 13 }, scrollMarginTop: 80 }}>
                    <Container maxWidth="xl">
                        <SectionHeading
                            eyebrow={t('landing.useCases.eyebrow')}
                            title={t('landing.useCases.title')}
                            description={t('landing.useCases.subtitle')}
                            align="center"
                        />
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5, mt: { xs: 5, md: 7 } }}>
                            {useCases.map((key, index) => (
                                <Box key={key} sx={{ minWidth: 0, p: { xs: 3, md: 4 }, bgcolor: index === 1 ? palette.ink : '#fffdf8', color: index === 1 ? 'white' : palette.ink, border: `1px solid ${index === 1 ? palette.ink : palette.line}`, borderRadius: index === 1 ? '28px 8px 28px 28px' : '8px 28px 28px 28px', transform: { md: index === 1 ? 'translateY(-18px)' : 'none' } }}>
                                    <Typography sx={{ color: index === 1 ? '#9bd8bd' : palette.coral, fontWeight: 850, fontSize: '0.82rem', mb: 2 }}>{t(`landing.useCases.${key}.label`)}</Typography>
                                    <Typography component="h3" sx={{ fontWeight: 790, fontSize: '1.45rem', lineHeight: 1.4, mb: 2 }}>{t(`landing.useCases.${key}.title`)}</Typography>
                                    <Typography sx={{ color: index === 1 ? 'rgba(255,255,255,0.7)' : palette.muted, lineHeight: 1.85 }}>{t(`landing.useCases.${key}.description`)}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Container>
                </Box>

                <Box id="pricing" sx={{ bgcolor: palette.ink, py: { xs: 9, md: 13 }, scrollMarginTop: 80 }}>
                    <Container maxWidth="lg">
                        <SectionHeading
                            eyebrow={t('landing.pricing.eyebrow')}
                            title={t('landing.pricing.title')}
                            description={t('landing.pricing.subtitle')}
                            align="center"
                            light
                        />
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 3, mt: { xs: 5, md: 7 }, alignItems: 'stretch' }}>
                            {plans.map((plan) => (
                                <Box
                                    key={plan.key}
                                    sx={{
                                        minWidth: 0,
                                        position: 'relative',
                                        bgcolor: plan.featured ? '#fff8ee' : '#fffdf8',
                                        color: palette.ink,
                                        border: plan.featured ? `3px solid ${palette.coral}` : '3px solid transparent',
                                        p: { xs: 3, sm: 4.5 },
                                        borderRadius: plan.featured ? '30px 8px 30px 30px' : '8px 30px 30px 30px',
                                    }}
                                >
                                    {plan.featured && (
                                        <Chip label={t('landing.pricing.popular')} sx={{ position: 'absolute', top: -18, insetInlineEnd: 24, bgcolor: palette.coral, color: 'white', fontWeight: 800 }} />
                                    )}
                                    <Typography component="h3" sx={{ fontSize: '1.55rem', fontWeight: 800 }}>{t(`landing.pricing.${plan.key}.name`)}</Typography>
                                    <Typography sx={{ color: palette.muted, minHeight: { md: 58 }, mt: 1, lineHeight: 1.75 }}>{t(`landing.pricing.${plan.key}.description`)}</Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, my: 3 }}>
                                        <Typography sx={{ fontSize: { xs: '3rem', sm: '3.7rem' }, lineHeight: 1, fontWeight: 850 }}>{plan.price}</Typography>
                                        <Box>
                                            <Typography sx={{ fontWeight: 750 }}>{t('landing.pricing.currency')}</Typography>
                                            <Typography sx={{ color: palette.muted, fontSize: '0.78rem' }}>{t('landing.pricing.period')}</Typography>
                                        </Box>
                                    </Box>
                                    <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
                                        <Chip label={t('landing.pricing.credits', { count: plan.credits })} sx={{ bgcolor: palette.greenSoft, color: palette.green, fontWeight: 780 }} />
                                        <Chip label={t('landing.pricing.messages', { count: plan.messages })} sx={{ bgcolor: palette.coralSoft, color: '#8e3423', fontWeight: 780 }} />
                                    </Stack>
                                    <Box sx={{ bgcolor: palette.paper, borderInlineStart: `3px solid ${palette.gold}`, p: 1.5, mt: 2.5 }}>
                                        <Typography sx={{ color: palette.muted, fontSize: '0.8rem', lineHeight: 1.75 }}>{t('landing.pricing.creditNote')}</Typography>
                                    </Box>
                                    <Divider sx={{ my: 3, borderColor: palette.line }} />
                                    <Stack component="ul" spacing={1.4} sx={{ listStyle: 'none', p: 0, m: 0 }}>
                                        {t(`landing.pricing.${plan.key}.features`).map((feature) => (
                                            <Box component="li" key={feature} sx={{ display: 'flex', gap: 1.2, alignItems: 'flex-start' }}>
                                                <CheckIcon sx={{ color: palette.green, fontSize: 20, mt: 0.2, flexShrink: 0 }} />
                                                <Typography sx={{ color: palette.ink, fontSize: '0.92rem', lineHeight: 1.7 }}>{feature}</Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                    <Button component={RouterLink} to="/login" fullWidth variant="contained" sx={{ mt: 4, py: 1.4, bgcolor: plan.featured ? palette.coral : palette.green, borderRadius: '9px 9px 2px 9px', boxShadow: 'none', fontWeight: 800, '&:hover': { bgcolor: palette.ink, boxShadow: 'none' } }}>
                                        {t('landing.pricing.choose')}
                                    </Button>
                                </Box>
                            ))}
                        </Box>
                        <Typography sx={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center', maxWidth: 820, mx: 'auto', mt: 3, fontSize: '0.82rem', lineHeight: 1.8 }}>
                            {t('landing.pricing.disclaimer')}
                        </Typography>
                    </Container>
                </Box>

                <Box sx={{ bgcolor: palette.coral, py: { xs: 7, md: 9 } }}>
                    <Container maxWidth="lg">
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto' }, gap: 3, alignItems: 'center' }}>
                            <Box>
                                <Typography component="h2" sx={{ color: '#fffdf8', fontWeight: 800, fontSize: { xs: '2rem', md: '3rem' }, lineHeight: 1.25 }}>{t('landing.cta.title')}</Typography>
                                <Typography sx={{ mt: 1.5, color: 'rgba(255,255,255,0.82)', fontSize: '1.05rem' }}>{t('landing.cta.description')}</Typography>
                            </Box>
                            <Button component={RouterLink} to="/login" size="large" sx={{ bgcolor: '#fffdf8', color: palette.ink, px: 4, py: 1.5, borderRadius: '10px 10px 2px 10px', fontWeight: 800, '&:hover': { bgcolor: palette.ink, color: 'white' } }}>
                                {t('landing.cta.button')}
                            </Button>
                        </Box>
                    </Container>
                </Box>
            </Box>

            <Box component="footer" sx={{ bgcolor: '#0b1916', color: 'white', py: { xs: 6, md: 8 } }}>
                <Container maxWidth="xl">
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                                xs: 'minmax(0, 1fr)',
                                sm: 'minmax(0, 1.4fr) minmax(150px, 0.6fr)',
                                md: 'minmax(260px, 1.5fr) minmax(150px, 0.55fr) minmax(150px, 0.55fr) minmax(230px, 0.8fr)',
                            },
                            gap: { xs: 4.5, md: 5 },
                        }}
                    >
                        <Box sx={{ minWidth: 0, gridColumn: { sm: '1 / -1', md: 'auto' } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.3, mb: 2, minWidth: 0 }}>
                                <Box sx={{ width: 38, height: 38, bgcolor: palette.green, borderRadius: '13px 13px 4px 13px', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                    <WhatsAppIcon sx={{ fontSize: 22 }} />
                                </Box>
                                <Typography component="span" sx={{ fontWeight: 850, fontSize: '1.1rem', whiteSpace: 'nowrap', wordBreak: 'normal', overflowWrap: 'normal' }}>Wa Savana</Typography>
                            </Box>
                            <Typography sx={{ color: 'rgba(255,255,255,0.62)', lineHeight: 1.9, maxWidth: 430, wordBreak: 'normal', overflowWrap: 'break-word' }}>
                                {t('landing.footer.description')}
                            </Typography>
                        </Box>

                        <Box sx={{ minWidth: 0 }}>
                            <Typography component="h2" sx={{ fontWeight: 800, fontSize: '0.95rem', mb: 2 }}>{t('landing.footer.platform')}</Typography>
                            <Stack spacing={0.6} alignItems="flex-start">
                                {navItems.slice(0, 3).map((item) => (
                                    <Button key={item.id} onClick={() => scrollToSection(item.id)} sx={{ p: 0, minWidth: 0, color: 'rgba(255,255,255,0.58)', fontWeight: 500, justifyContent: 'flex-start', wordBreak: 'normal', overflowWrap: 'normal', '&:hover': { color: '#9bd8bd', bgcolor: 'transparent' } }}>
                                        {item.label}
                                    </Button>
                                ))}
                            </Stack>
                        </Box>

                        <Box sx={{ minWidth: 0 }}>
                            <Typography component="h2" sx={{ fontWeight: 800, fontSize: '0.95rem', mb: 2 }}>{t('landing.footer.legal')}</Typography>
                            <Stack spacing={1.2} alignItems="flex-start">
                                <Typography component={RouterLink} to="/privacy-policy" sx={{ color: 'rgba(255,255,255,0.58)', textDecoration: 'none', fontSize: '0.9rem', wordBreak: 'normal', '&:hover': { color: '#9bd8bd' } }}>{t('landing.footer.privacy')}</Typography>
                                <Typography component="a" href="/api/terms" sx={{ color: 'rgba(255,255,255,0.58)', textDecoration: 'none', fontSize: '0.9rem', wordBreak: 'normal', '&:hover': { color: '#9bd8bd' } }}>{t('landing.footer.terms')}</Typography>
                            </Stack>
                        </Box>

                        <Box sx={{ minWidth: 0, bgcolor: 'rgba(255,255,255,0.06)', p: 2.5, borderRadius: '18px 5px 18px 18px', alignSelf: 'start' }}>
                            <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1rem' }}>{t('landing.footer.readyTitle')}</Typography>
                            <Typography sx={{ color: 'rgba(255,255,255,0.58)', mt: 1, mb: 2, lineHeight: 1.7, fontSize: '0.86rem', wordBreak: 'normal' }}>{t('landing.footer.readyDescription')}</Typography>
                            <Button component={RouterLink} to="/login" fullWidth variant="contained" sx={{ bgcolor: palette.green, boxShadow: 'none', fontWeight: 750, '&:hover': { bgcolor: '#0b9a6e', boxShadow: 'none' } }}>{t('landing.footer.button')}</Button>
                        </Box>
                    </Box>

                    <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)', my: 4 }} />
                    <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', wordBreak: 'normal' }}>
                        © {new Date().getFullYear()} {t('landing.footer.copyright')}
                    </Typography>
                </Container>
            </Box>
        </Box>
    );
};

export default LandingPage;
