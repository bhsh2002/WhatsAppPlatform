import React, { useState } from 'react';
import { Box, AppBar, Toolbar, IconButton, Typography, Drawer, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Sidebar from './Sidebar';
import WaBrandMark from '../Brand/WaBrandMark';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useWhatsAppNumbers } from '../../context/WhatsAppNumberContext';
import WhatsAppNumberSelector from '../WhatsApp/WhatsAppNumberSelector';

const drawerWidth = 280;
const mobileHeaderHeight = 56;
const mobileDrawerId = 'main-mobile-navigation';

const MainLayout = ({ children, fullHeight = false }) => {
    const theme = useTheme();
    const { direction, t } = useLanguage();
    const { isTenant } = useAuth();
    const { selectedPhoneNumberId, numbers } = useWhatsAppNumbers();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleDrawerToggle = () => {
        setMobileOpen(previous => !previous);
    };

    const handleDrawerClose = () => setMobileOpen(false);

    return (
        <Box
            dir={direction}
            style={{ direction }}
            sx={{
                '--wa-mobile-header-height': `${mobileHeaderHeight}px`,
                display: 'flex',
                flexDirection: 'row',
                minHeight: '100dvh',
                height: { xs: '100dvh', md: 'auto' },
                width: '100%',
                maxWidth: '100vw',
                overflowX: 'hidden',
                overflowY: { xs: 'hidden', md: 'visible' },
                bgcolor: 'background.default',
            }}
        >
            {isMobile && (
                <AppBar position="fixed" elevation={0} sx={{
                    bgcolor: 'rgba(247,242,232,0.96)',
                    color: 'text.primary',
                    borderBottom: '1px solid #d7ccba',
                    backdropFilter: 'blur(12px)',
                    zIndex: 1200,
                    width: '100%',
                    maxWidth: '100vw',
                    overflow: 'hidden',
                }}>
                    <Toolbar sx={{ height: 'var(--wa-mobile-header-height)', minHeight: 'var(--wa-mobile-header-height)', py: 0, px: { xs: 1, sm: 2 }, gap: 1, minWidth: 0 }}>
                        <IconButton
                            color="primary"
                            onClick={handleDrawerToggle}
                            aria-label={t('layout.openDrawer')}
                            aria-expanded={mobileOpen}
                            aria-controls={mobileDrawerId}
                            sx={{ flexShrink: 0 }}
                        >
                            <MenuIcon />
                        </IconButton>
                        <WaBrandMark size={28} />
                        <Typography variant="subtitle1" component="div" fontWeight={800} sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0 }}>
                            Wa Savana
                        </Typography>
                        {isTenant && numbers.length > 0 && <Box sx={{ flex: 1, minWidth: 0, maxWidth: 280, marginInlineStart: 'auto' }}>
                            <WhatsAppNumberSelector compact />
                        </Box>}
                    </Toolbar>
                </AppBar>
            )}

            {/* MUI mirrors the logical left anchor when the theme is RTL. */}
            <Drawer
                variant="temporary"
                anchor="left"
                open={mobileOpen}
                onClose={handleDrawerClose}
                ModalProps={{ keepMounted: true }}
                slotProps={{ paper: { id: mobileDrawerId, 'aria-label': t('layout.mainNavigation') } }}
                sx={{
                    display: { xs: 'block', md: 'none' },
                    '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                }}
            >
                <Sidebar onNavigate={handleDrawerClose} />
            </Drawer>

            <Box
                component="aside"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    display: { xs: 'none', md: 'block' },
                    height: '100dvh',
                    position: 'sticky',
                    top: 0,
                    overflow: 'hidden',
                }}
            >
                <Sidebar />
            </Box>

            <Box
                component="main"
                data-testid="app-main-shell"
                sx={{
                    flex: 1,
                    minWidth: 0,
                    width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
                    maxWidth: { xs: '100vw', md: `calc(100vw - ${drawerWidth}px)` },
                    height: { xs: '100%', md: 'auto' },
                    minHeight: { xs: 0, md: '100dvh' },
                    boxSizing: 'border-box',
                    position: 'relative',
                    overflow: { xs: 'clip', md: 'visible' },
                    overflowX: { md: 'hidden' },
                    pt: { xs: 'var(--wa-mobile-header-height)', md: 0 },
                    background: 'linear-gradient(180deg, #f7f2e8 0%, #f3ecdf 100%)',
                }}
            >
                <Box
                    key={isTenant ? selectedPhoneNumberId || 'no-whatsapp-number' : 'admin'}
                    data-testid="app-content-scroll-root"
                    sx={{
                        height: { xs: 'calc(100dvh - var(--wa-mobile-header-height))', md: 'auto' },
                        minHeight: 0,
                        minWidth: 0,
                        maxWidth: '100%',
                        flexShrink: 0,
                        overflowX: 'hidden',
                        overflowY: { xs: fullHeight ? 'hidden' : 'auto', md: 'visible' },
                    }}
                >
                    {children}
                </Box>
            </Box>
        </Box>
    );
};

export default MainLayout;
