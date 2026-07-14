import { createTheme } from '@mui/material/styles';

export const createAppTheme = (direction = 'rtl') => createTheme({
    direction,
    palette: {
        mode: 'light',
        primary: {
            main: '#00725e', // Accessible WhatsApp Teal Green
            light: '#25D366',
            dark: '#015c4b',
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#087f4f',
            light: '#d7f7e3',
            dark: '#065f3c',
            contrastText: '#ffffff',
        },
        warning: {
            main: '#a15c00',
            dark: '#783f00',
            contrastText: '#ffffff',
        },
        error: {
            main: '#b42318',
            dark: '#7a271a',
            contrastText: '#ffffff',
        },
        success: {
            main: '#1f6b2c',
            dark: '#14532d',
            contrastText: '#ffffff',
        },
        background: {
            default: '#efeae2', // Chat background color typically
            paper: '#ffffff',
        },
        text: {
            primary: '#111b21',
            secondary: '#526069',
        },
        action: {
            hover: 'rgba(0, 0, 0, 0.04)',
            selected: 'rgba(0, 0, 0, 0.08)',
        },
    },
    typography: {
        fontFamily: [
            '-apple-system',
            'BlinkMacSystemFont',
            '"Segoe UI"',
            'Roboto',
            '"Helvetica Neue"',
            'Arial',
            'sans-serif',
        ].join(','),
    },
    shape: {
        borderRadius: 8,
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    backgroundColor: '#d1d7db', // App background behind the app container
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                },
            },
        },
        MuiFormHelperText: {
            styleOverrides: {
                root: {
                    color: '#526069',
                    '&.Mui-disabled': {
                        color: '#526069',
                    },
                },
            },
        },
        MuiCircularProgress: {
            defaultProps: {
                'aria-label': 'Loading / جارٍ التحميل',
            },
        },
        MuiLinearProgress: {
            defaultProps: {
                'aria-label': 'Progress / مستوى التقدم',
            },
        },
    },
});

export default createAppTheme();
