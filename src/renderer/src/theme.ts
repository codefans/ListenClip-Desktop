import { createTheme } from '@mui/material/styles'

/** Material 3 – dark surface palette derived from seed #6750A4 */
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#D0BCFF',       // M3 primary
      dark: '#6750A4',
      light: '#EADDFF',
      contrastText: '#381E72'
    },
    secondary: {
      main: '#CCC2DC',       // M3 secondary
      contrastText: '#332D41'
    },
    error: {
      main: '#F2B8B5',
      contrastText: '#601410'
    },
    background: {
      default: '#1C1B1F',    // M3 surface
      paper: '#2B2930'       // M3 surface-container
    },
    text: {
      primary: '#E6E1E5',    // M3 on-surface
      secondary: '#CAC4D0'   // M3 on-surface-variant
    },
    divider: 'rgba(202, 196, 208, 0.12)'
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Roboto", "Inter", sans-serif',
    h4: { fontWeight: 400, letterSpacing: 0 },
    h5: { fontWeight: 400 },
    h6: { fontWeight: 500 },
    body1: { lineHeight: 1.6 },
    caption: { color: '#CAC4D0' }
  },
  components: {
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: '#2B2930',
          border: '1px solid rgba(202, 196, 208, 0.12)',
          borderRadius: 16
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 20, textTransform: 'none', fontWeight: 500 },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } }
      }
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 12 }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8 }
      }
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, backgroundColor: 'rgba(208, 188, 255, 0.16)' },
        bar: { borderRadius: 4, backgroundColor: '#D0BCFF' }
      }
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' }
    },
    MuiTooltip: {
      defaultProps: { arrow: true }
    }
  }
})

export default theme
