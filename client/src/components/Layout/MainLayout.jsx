import React, { useState } from 'react';
import { Box, AppBar, Toolbar, IconButton, Typography, Drawer, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import Sidebar from './Sidebar';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useWhatsAppNumbers } from '../../context/WhatsAppNumberContext';
import WhatsAppNumberSelector from '../WhatsApp/WhatsAppNumberSelector';

const drawerWidth = 280;
const mobileDrawerId = 'main-mobile-navigation';

const MainLayout = ({ children }) => {
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
                display: 'flex',
                flexDirection: 'row',
                minHeight: '100dvh',
                width: '100%',
                maxWidth: '100vw',
                overflowX: 'hidden',
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
                    <Toolbar sx={{ height: 48, minHeight: 48, py: 0, px: { xs: 1, sm: 2 }, gap: 1, minWidth: 0 }}>
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
                        <Box sx={{ width: 28, height: 28, bgcolor: 'primary.main', color: 'white', borderRadius: '10px 10px 3px 10px', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            <WhatsAppIcon sx={{ fontSize: 17 }} />
                        </Box>
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
                sx={{
                    flex: 1,
                    minWidth: 0,
                    width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
                    maxWidth: { xs: '100vw', md: `calc(100vw - ${drawerWidth}px)` },
                    minHeight: '100dvh',
                    boxSizing: 'border-box',
                    position: 'relative',
                    overflowX: 'hidden',
                    pt: { xs: '48px', md: 0 },
                    background: 'linear-gradient(180deg, #f7f2e8 0%, #f3ecdf 100%)',
                }}
            >
                <Box
                    key={isTenant ? selectedPhoneNumberId || 'no-whatsapp-number' : 'admin'}
                    sx={{ minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}
                >
                    {children}
                </Box>
            </Box>
        </Box>
    );
};

export default MainLayout;
