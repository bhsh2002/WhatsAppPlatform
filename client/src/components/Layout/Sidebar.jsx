import React from 'react';
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
    FactCheck as FactCheckIcon
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';

const Sidebar = () => {
    const { user, tenant, logout, isTenant, isAdmin } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const adminNavSections = [
        {
            title: 'عام',
            items: [
                { label: 'لوحة القيادة', path: '/dashboard', icon: <DashboardIcon /> },
                { label: 'إدارة العملاء', path: '/tenants', icon: <PeopleIcon /> },
                { label: 'صندوق الوارد', path: '/inbox', icon: <InboxIcon /> },
            ],
        },
        {
            title: 'WhatsApp',
            color: '#25D366',
            items: [
                { label: 'منصة واتساب', path: '/whatsapp', icon: <WhatsAppIcon /> },
                { label: 'جهات اتصال WhatsApp', path: '/contacts', icon: <ContactPhoneIcon /> },
                { label: 'البث الجماعي', path: '/broadcast', icon: <CampaignIcon /> },
                { label: 'القوالب', path: '/templates', icon: <TemplateIcon /> },
                { label: 'أرقام الهواتف', path: '/phone-numbers', icon: <PhoneCallbackIcon /> },
                { label: 'اشتراكات WABA Webhook', path: '/webhook-subscriptions', icon: <WebhookSubIcon /> },
            ],
        },
        {
            title: 'Facebook / Meta',
            color: '#1877f2',
            items: [
                { label: 'محتوى فيسبوك', path: '/fb-manager', icon: <FacebookIcon /> },
                { label: 'تحليلات فيسبوك', path: '/fb-insights', icon: <BarChartIcon /> },
                { label: 'مدير الأعمال', path: '/business-manager', icon: <BusinessIcon /> },
                { label: 'حلول الشركاء', path: '/partner-solutions', icon: <HandshakeIcon /> },
                { label: 'أعطال Webhook', path: '/webhook-failures', icon: <ReportProblemIcon /> },
            ],
        },
        {
            title: 'النظام',
            items: [
                { label: 'الأتمتة', path: '/automation', icon: <SmartToyIcon /> },
                { label: 'سجلات التشغيل', path: '/logs', icon: <AssessmentIcon /> },
                { label: 'الإعدادات', path: '/settings', icon: <SettingsIcon /> },
            ],
        },
    ];

    const tenantNavSections = [
        {
            title: 'عام',
            items: [
                { label: 'لوحة القيادة', path: '/portal', icon: <DashboardIcon /> },
                { label: 'صندوق الوارد', path: '/portal/inbox', icon: <InboxIcon /> },
                { label: 'التحليلات', path: '/portal/analytics', icon: <AnalyticsIcon /> },
            ],
        },
        {
            title: 'WhatsApp',
            color: '#25D366',
            items: [
                { label: 'جهات اتصال WhatsApp', path: '/portal/contacts', icon: <ContactPhoneIcon /> },
                { label: 'البث الجماعي', path: '/portal/broadcast', icon: <CampaignIcon /> },
                { label: 'القوالب', path: '/portal/templates', icon: <TemplateIcon /> },
                { label: 'ملف النشاط التجاري', path: '/portal/business-profile', icon: <BusinessIcon /> },
                { label: 'رموز QR', path: '/portal/qr-codes', icon: <QrCodeIcon /> },
                { label: 'أحداث التحويل', path: '/portal/conversions', icon: <TrendingUpIcon /> },
                { label: 'إعدادات API', path: '/portal/api-settings', icon: <ApiIcon /> },
            ],
        },
        {
            title: 'Facebook / Meta',
            color: '#1877f2',
            items: [
                { label: 'صفحات فيسبوك', path: '/portal/fb-pages', icon: <FacebookIcon /> },
                { label: 'إدارة المحتوى', path: '/portal/fb-content', icon: <StoreIcon /> },
                { label: 'تحليلات فيسبوك', path: '/portal/fb-insights', icon: <BarChartIcon /> },
                { label: 'جاهزية Meta', path: '/portal/meta-review', icon: <FactCheckIcon /> },
            ],
        },
        {
            title: 'التشغيل',
            items: [
                { label: 'الأتمتة', path: '/portal/automation', icon: <SmartToyIcon /> },
            ],
        },
    ];

    const navSections = isTenant ? tenantNavSections : adminNavSections;

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            borderRight: '1px solid rgba(0,0,0,0.12)'
        }}>
            {/* Logo Area */}
            <Box sx={{
                p: 3,
                display: 'flex',
                alignItems: 'center',
                gap: 2
            }}>
                <Box sx={{
                    width: 40,
                    height: 40,
                    bgcolor: isTenant ? 'secondary.main' : 'primary.main',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '1.5rem',
                    boxShadow: 2
                }}>
                    {isTenant ? '🏢' : '⚡'}
                </Box>
                <Box>
                    <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                        {isTenant ? (tenant?.name || 'Wa Savana') : 'Wa Savana'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {isTenant ? 'بوابة العميل' : 'لوحة الإدارة المركزية'}
                    </Typography>
                </Box>
            </Box>

            <Divider />

            {/* Navigation */}
            <List sx={{ flex: 1, px: 1.5, py: 1.5, overflowY: 'auto' }}>
                {navSections.map((section, sectionIndex) => (
                    <Box key={section.title} sx={{ mb: sectionIndex === navSections.length - 1 ? 0 : 1.5 }}>
                        {sectionIndex > 0 && <Divider sx={{ mb: 1 }} />}
                        <Typography
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
                        {section.items.map((item) => {
                            const isActive = location.pathname === item.path;
                            return (
                                <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                                    <ListItemButton
                                        onClick={() => navigate(item.path)}
                                        selected={isActive}
                                        sx={{
                                            borderRadius: 1.5,
                                            minHeight: 40,
                                            '&.Mui-selected': {
                                                bgcolor: isTenant ? 'secondary.light' : 'primary.light',
                                                color: isTenant ? 'secondary.contrastText' : 'primary.contrastText',
                                                '&:hover': { bgcolor: isTenant ? 'secondary.dark' : 'primary.dark' },
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
                    </Box>
                ))}
            </List>

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
                        bgcolor: 'action.hover',
                        borderRadius: 2
                    }}>
                        <Avatar sx={{ bgcolor: isTenant ? 'secondary.main' : 'primary.main', width: 36, height: 36 }}>
                            <PersonIcon />
                        </Avatar>
                        <Box sx={{ overflow: 'hidden', flex: 1 }}>
                            <Typography variant="subtitle2" noWrap>
                                {user.name || user.username}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Chip
                                    label={isTenant ? 'عميل' : (isAdmin ? 'مدير' : 'مستخدم')}
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
                    color="error"
                    startIcon={<LogoutIcon />}
                    onClick={handleLogout}
                >
                    تسجيل الخروج
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
                            color: 'text.disabled',
                            fontSize: '0.75rem',
                            '&:hover': { color: 'text.secondary', bgcolor: 'transparent' },
                        }}
                    >
                        سياسة الخصوصية
                    </Button>
                </Box>
            </Box>
        </Box>
    );
};

export default Sidebar;
