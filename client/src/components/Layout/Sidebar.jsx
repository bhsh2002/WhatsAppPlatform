import React, { useId } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
    Avatar,
    Divider,
    Button,
    Chip
} from '@mui/material';
import {
    Dashboard as DashboardIcon,
    People as PeopleIcon,
    Inbox as InboxIcon,
    WhatsApp as WhatsAppIcon,
    Assessment as AssessmentIcon,
    Settings as SettingsIcon,
    Logout as LogoutIcon,
    Person as PersonIcon,
    Description as TemplateIcon,
    Api as ApiIcon,
    PrivacyTip as PrivacyTipIcon,
    Store as StoreIcon,
    Analytics as AnalyticsIcon,
    QrCode as QrCodeIcon,
    Business as BusinessIcon,
    Facebook as FacebookIcon,
    Handshake as HandshakeIcon,
    TrendingUp as TrendingUpIcon,
    PhoneCallback as PhoneCallbackIcon,
    Webhook as WebhookSubIcon,
    ContactPhone as ContactPhoneIcon,
    Campaign as CampaignIcon,
    BarChart as BarChartIcon,
    ReportProblem as ReportProblemIcon,
    SmartToy as SmartToyIcon,
    FactCheck as FactCheckIcon,
    AccountBalanceWallet as BillingIcon,
    Language as LanguageIcon,
    PointOfSale as PosIcon,
    Sms as SmsIcon
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

const Sidebar = () => {
    const { user, tenant, logout, isTenant, isAdmin } = useAuth();
    const { language, setLanguage, t } = useLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const sidebarId = useId();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const adminNavSections = [
        {
            title: t('nav.sections.general'),
            items: [
                { label: t('nav.dashboard'), path: '/dashboard', icon: <DashboardIcon /> },
                { label: t('nav.tenants'), path: '/tenants', icon: <PeopleIcon /> },
                { label: t('nav.inbox'), path: '/inbox', icon: <InboxIcon /> },
                { label: t('nav.billing'), path: '/billing', icon: <BillingIcon /> },
            ],
        },
        {
            title: t('nav.sections.whatsapp'),
            color: '#067647',
            items: [
                { label: t('nav.whatsappConsole'), path: '/whatsapp', icon: <WhatsAppIcon /> },
                { label: t('nav.whatsappContacts'), path: '/contacts', icon: <ContactPhoneIcon /> },
                { label: t('nav.broadcast'), path: '/broadcast', icon: <CampaignIcon /> },
                { label: t('nav.templates'), path: '/templates', icon: <TemplateIcon /> },
                { label: t('nav.phoneNumbers'), path: '/phone-numbers', icon: <PhoneCallbackIcon /> },
                { label: t('nav.wabaWebhooks'), path: '/webhook-subscriptions', icon: <WebhookSubIcon /> },
            ],
        },
        {
            title: t('nav.sections.facebookMeta'),
            color: '#0B57D0',
            items: [
                { label: t('nav.facebookContent'), path: '/fb-manager', icon: <FacebookIcon /> },
                { label: t('nav.messengerBot'), path: '/messenger-bot', icon: <SmartToyIcon /> },
                { label: t('nav.facebookInsights'), path: '/fb-insights', icon: <BarChartIcon /> },
                { label: t('nav.businessManager'), path: '/business-manager', icon: <BusinessIcon /> },
                { label: t('nav.partnerSolutions'), path: '/partner-solutions', icon: <HandshakeIcon /> },
                { label: t('nav.webhookFailures'), path: '/webhook-failures', icon: <ReportProblemIcon /> },
            ],
        },
        {
            title: t('nav.sections.system'),
            items: [
                { label: t('nav.automation'), path: '/automation', icon: <SmartToyIcon /> },
                { label: t('nav.logs'), path: '/logs', icon: <AssessmentIcon /> },
                { label: t('nav.settings'), path: '/settings', icon: <SettingsIcon /> },
            ],
        },
    ];

    const tenantNavSections = [
        {
            title: t('nav.sections.general'),
            items: [
                { label: t('nav.dashboard'), path: '/portal', icon: <DashboardIcon /> },
                { label: t('nav.inbox'), path: '/portal/inbox', icon: <InboxIcon /> },
                { label: t('nav.tenantBilling'), path: '/portal/billing', icon: <BillingIcon /> },
                { label: t('nav.posIntegration'), path: '/portal/integrations', icon: <PosIcon /> },
                { label: 'حسابات SMS', path: '/portal/integrations/sms', icon: <SmsIcon /> },
            ],
        },
        {
            title: t('nav.sections.whatsapp'),
            color: '#067647',
            items: [
                { label: t('nav.whatsappConnect'), path: '/portal/whatsapp-connect', icon: <WhatsAppIcon /> },
                { label: t('nav.whatsappAnalytics'), path: '/portal/analytics', icon: <AnalyticsIcon /> },
                { label: t('nav.whatsappContacts'), path: '/portal/contacts', icon: <ContactPhoneIcon /> },
                { label: t('nav.broadcast'), path: '/portal/broadcast', icon: <CampaignIcon /> },
                { label: t('nav.templates'), path: '/portal/templates', icon: <TemplateIcon /> },
                { label: t('nav.businessProfile'), path: '/portal/business-profile', icon: <BusinessIcon /> },
                { label: t('nav.qrCodes'), path: '/portal/qr-codes', icon: <QrCodeIcon /> },
                { label: t('nav.conversions'), path: '/portal/conversions', icon: <TrendingUpIcon /> },
                { label: t('nav.apiSettings'), path: '/portal/api-settings', icon: <ApiIcon /> },
            ],
        },
        {
            title: t('nav.sections.facebookMeta'),
            color: '#0B57D0',
            items: [
                { label: t('nav.facebookPages'), path: '/portal/fb-pages', icon: <FacebookIcon /> },
                { label: t('nav.contentManager'), path: '/portal/fb-content', icon: <StoreIcon /> },
                { label: t('nav.messengerBot'), path: '/portal/messenger-bot', icon: <SmartToyIcon /> },
                { label: t('nav.facebookInsights'), path: '/portal/fb-insights', icon: <BarChartIcon /> },
                { label: t('nav.metaReview'), path: '/portal/meta-review', icon: <FactCheckIcon /> },
            ],
        },
        {
            title: t('nav.sections.operations'),
            items: [
                { label: t('nav.automation'), path: '/portal/automation', icon: <SmartToyIcon /> },
            ],
        },
    ];

    const navSections = isTenant ? tenantNavSections : adminNavSections;

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#fffdf8',
            borderInlineEnd: '1px solid #d7ccba'
        }}>
            {/* Logo Area */}
            <Box sx={{
                p: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 2
            }}>
                <Box sx={{
                    width: 40,
                    height: 40,
                    bgcolor: 'primary.main',
                    borderRadius: '14px 14px 4px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '1.5rem',
                    transform: 'rotate(-3deg)'
                }}>
                    <WhatsAppIcon sx={{ transform: 'rotate(3deg)' }} />
                </Box>
                <Box>
                    <Typography variant="h6" component="div" fontWeight={700} lineHeight={1.2}>
                        {isTenant ? (tenant?.name || 'Wa Savana') : 'Wa Savana'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {isTenant ? t('layout.tenantPortal') : t('layout.adminConsole')}
                    </Typography>
                </Box>
            </Box>

            <Divider sx={{ borderColor: '#d7ccba' }} />

            {/* Navigation */}
            <Box component="nav" aria-label={t('layout.mainNavigation')} sx={{ flex: 1, px: 1.5, py: 1.5, overflowY: 'auto' }}>
                {navSections.map((section, sectionIndex) => (
                    <Box
                        component="section"
                        key={section.title}
                        aria-labelledby={`${sidebarId}-section-${sectionIndex}`}
                        sx={{ mb: sectionIndex === navSections.length - 1 ? 0 : 1.5 }}
                    >
                        {sectionIndex > 0 && <Divider sx={{ mb: 1 }} />}
                        <Typography
                            id={`${sidebarId}-section-${sectionIndex}`}
                            variant="caption"
                            sx={{
                                display: 'block',
                                px: 1.25,
                                mb: 0.75,
                                fontWeight: 800,
                                color: section.color || 'text.secondary',
                                letterSpacing: 0,
                            }}
                        >
                            {section.title}
                        </Typography>
                        <List disablePadding aria-labelledby={`${sidebarId}-section-${sectionIndex}`}>
                            {section.items.map((item) => {
                                const isActive = location.pathname === item.path;
                                return (
                                    <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                                        <ListItemButton
                                            component={RouterLink}
                                            to={item.path}
                                            selected={isActive}
                                            sx={{
                                                borderRadius: '11px 11px 3px 11px',
                                                minHeight: 40,
                                                '&.Mui-selected': {
                                                    bgcolor: '#d9eadf',
                                                    color: '#0f4f40',
                                                    '&:hover': { bgcolor: '#c7dfd0' },
                                                    '& .MuiListItemIcon-root': { color: 'inherit' }
                                                }
                                            }}
                                        >
                                            <ListItemIcon sx={{ minWidth: 36, color: isActive ? 'inherit' : (section.color || 'text.secondary') }}>
                                                {item.icon}
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={item.label}
                                                primaryTypographyProps={{
                                                    fontWeight: isActive ? 700 : 500,
                                                    fontSize: '0.9rem',
                                                    noWrap: true,
                                                }}
                                                sx={{ minWidth: 0 }}
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                );
                            })}
                        </List>
                    </Box>
                ))}
            </Box>

            <Divider />

            {/* User Profile */}
            <Box sx={{ p: 2 }}>
                {user && (
                    <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        mb: 2,
                        p: 1.5,
                        bgcolor: '#f7f2e8',
                        border: '1px solid #d7ccba',
                        borderRadius: '14px 4px 14px 14px'
                    }}>
                        <Avatar sx={{ bgcolor: isTenant ? 'secondary.main' : 'primary.main', width: 36, height: 36 }}>
                            <PersonIcon />
                        </Avatar>
                        <Box sx={{ overflow: 'hidden', flex: 1 }}>
                            <Typography variant="subtitle2" component="div" noWrap>
                                {user.name || user.username}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Chip
                                    label={isTenant ? t('common.customer') : (isAdmin ? t('common.admin') : t('common.user'))}
                                    size="small"
                                    color={isTenant ? 'secondary' : 'primary'}
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                            </Box>
                        </Box>
                    </Box>
                )}

                <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<LanguageIcon />}
                    onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                    sx={{ mb: 1 }}
                    aria-label={t('language.toggleLabel')}
                >
                    {language === 'ar' ? t('language.switchToEnglish') : t('language.switchToArabic')}
                </Button>

                <Button
                    fullWidth
                    variant="outlined"
                    color="error"
                    startIcon={<LogoutIcon />}
                    onClick={handleLogout}
                >
                    {t('common.logout')}
                </Button>

                {/* Privacy Policy Link */}
                <Box sx={{ textAlign: 'center', mt: 1.5 }}>
                    <Button
                        component={RouterLink}
                        to="/privacy-policy"
                        size="small"
                        startIcon={<PrivacyTipIcon fontSize="small" />}
                        sx={{
                            textTransform: 'none',
                            color: 'text.secondary',
                            fontSize: '0.75rem',
                            '&:hover': { color: 'text.primary', bgcolor: 'transparent' },
                        }}
                    >
                        {t('common.privacyPolicy')}
                    </Button>
                </Box>
            </Box>
        </Box>
    );
};

export default Sidebar;
