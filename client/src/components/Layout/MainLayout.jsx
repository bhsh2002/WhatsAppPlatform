import React, { useState } from 'react';
import { Box, AppBar, Toolbar, IconButton, Typography, Drawer, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Sidebar from './Sidebar';
import { useLanguage } from '../../context/LanguageContext';

const drawerWidth = 280;

const MainLayout = ({ children }) => {
    const theme = useTheme();
    const { t } = useLanguage();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
            {isMobile && (
                <AppBar position="fixed" elevation={1} sx={{
                    bgcolor: 'background.paper',
                    color: 'text.primary',
                    zIndex: 1200
                }}>
                    <Toolbar sx={{ height: 48, minHeight: 48, py: 0 }}>
                        <IconButton
                            color="primary"
                            edge="start"
                            onClick={handleDrawerToggle}
                            aria-label={t('layout.openDrawer')}
                        >
                            <MenuIcon />
                        </IconButton>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ ml: 1 }}>
                            Wa Savana
                        </Typography>
                    </Toolbar>
                </AppBar>
            )}

            <Box
                component="nav"
                sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
            >
                <Drawer
                    variant="temporary"
                    anchor={theme.direction === 'rtl' ? 'left' : 'right'}
                    open={mobileOpen}
                    onClose={handleDrawerToggle}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        display: { xs: 'block', md: 'none' },
                        '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                    }}
                >
                    <Sidebar />
                </Drawer>

                <Drawer
                    variant="permanent"
                    anchor={theme.direction === 'rtl' ? 'right' : 'left'}
                    sx={{
                        display: { xs: 'none', md: 'block' },
                        '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                    }}
                    open
                >
                    <Sidebar />
                </Drawer>
            </Box>

            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    width: { md: `calc(100% - ${drawerWidth}px)` },
                    minHeight: '100vh',
                    position: 'relative',
                    overflowX: 'hidden',
                    pt: { xs: '48px', md: 0 }
                }}
            >
                {children}
            </Box>
        </Box>
    );
};

export default MainLayout;
