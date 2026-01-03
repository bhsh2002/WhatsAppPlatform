import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    direction: 'rtl', // For Arabic support mainly, though we might need cache setup for full RTL
    palette: {
        mode: 'light',
        primary: {
            main: '#008069', // WhatsApp Teal Green
            light: '#25D366',
            dark: '#015c4b',
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#25D366',
            contrastText: '#ffffff',
        },
        background: {
            default: '#efeae2', // Chat background color typically
            paper: '#ffffff',
        },
        text: {
            primary: '#111b21',
            secondary: '#667781',
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
    },
});

export default theme;
