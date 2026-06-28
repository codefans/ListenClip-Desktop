import { useState, useCallback } from 'react'
import { Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Divider, Typography, IconButton } from '@mui/material'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import SettingsIcon from '@mui/icons-material/Settings'
import CloseIcon from '@mui/icons-material/Close'
import MinimizeIcon from '@mui/icons-material/Minimize'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import Library from './pages/Library'
import Processing from './pages/Processing'
import Player from './pages/Player'
import Settings from './pages/Settings'
import SentenceEditor from './pages/SentenceEditor'

export type Page = 'library' | 'processing' | 'player' | 'sentence-editor' | 'settings'

export interface NavState {
  page: Page
  processingProjectId?: string
  playerProjectId?: string
  /** Incremented each time we return from SentenceEditor → forces Player remount */
  playerRefreshToken: number
}

const RAIL_WIDTH = 72

export default function App() {
  const [nav, setNav] = useState<NavState>({ page: 'library', playerRefreshToken: 0 })

  const navigate = useCallback((next: Partial<NavState> & { page: Page }) => {
    setNav(prev => {
      const updated = { ...prev, ...next }
      // Returning from sentence-editor → force Player to remount with fresh data
      if (prev.page === 'sentence-editor' && next.page === 'player') {
        updated.playerRefreshToken = prev.playerRefreshToken + 1
      }
      return updated
    })
  }, [])

  const railItems = [
    { key: 'library' as const, label: '媒体库', Icon: LibraryMusicIcon },
    {
      key: 'player' as const,
      label: '播放器',
      Icon: PlayCircleIcon,
      disabled: !nav.playerProjectId
    }
  ]

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      {/* Custom title bar drag region */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: RAIL_WIDTH,
          right: 0,
          height: 36,
          WebkitAppRegion: 'drag',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          pr: 1
        }}
      >
        <Box sx={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 0.5 }}>
          <IconButton size="small" onClick={() => window.close()} sx={{ color: 'text.secondary', '&:hover': { color: '#F2B8B5' } }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Navigation Rail */}
      <Drawer
        variant="permanent"
        sx={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: RAIL_WIDTH,
            bgcolor: '#211F26',
            borderRight: '1px solid rgba(202,196,208,0.08)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pt: 5,
            pb: 1,
            overflowX: 'hidden'
          }
        }}
      >
        {/* Logo */}
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700, fontSize: 10, letterSpacing: 1 }}>
            LC
          </Typography>
        </Box>

        {/* Rail Items */}
        <List disablePadding sx={{ width: '100%', flex: 1 }}>
          {railItems.map(({ key, label, Icon, disabled }) => {
            const active = nav.page === key
            return (
              <Tooltip title={label} placement="right" key={key}>
                <span>
                  <ListItemButton
                    disabled={disabled}
                    onClick={() => navigate({ page: key, playerProjectId: nav.playerProjectId })}
                    sx={{
                      flexDirection: 'column',
                      alignItems: 'center',
                      py: 1.5,
                      px: 0,
                      borderRadius: 3,
                      mx: 1,
                      mb: 0.5,
                      bgcolor: active ? 'rgba(208,188,255,0.16)' : 'transparent',
                      '&:hover': { bgcolor: active ? 'rgba(208,188,255,0.2)' : 'rgba(255,255,255,0.06)' }
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 'auto', color: active ? 'primary.main' : 'text.secondary' }}>
                      <Icon />
                    </ListItemIcon>
                    <ListItemText
                      primary={label}
                      primaryTypographyProps={{ fontSize: 10, sx: { color: active ? 'primary.main' : 'text.secondary', mt: 0.5 } }}
                    />
                  </ListItemButton>
                </span>
              </Tooltip>
            )
          })}
        </List>

        <Divider sx={{ width: '80%', my: 1, borderColor: 'rgba(202,196,208,0.12)' }} />

        {/* Settings */}
        <Tooltip title="设置" placement="right">
          <ListItemButton
            onClick={() => navigate({ page: 'settings' })}
            sx={{
              flexDirection: 'column',
              alignItems: 'center',
              py: 1.5,
              px: 0,
              borderRadius: 3,
              mx: 1,
              width: 'calc(100% - 16px)',
              bgcolor: nav.page === 'settings' ? 'rgba(208,188,255,0.16)' : 'transparent'
            }}
          >
            <ListItemIcon sx={{ minWidth: 'auto', color: nav.page === 'settings' ? 'primary.main' : 'text.secondary' }}>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText
              primary="设置"
              primaryTypographyProps={{ fontSize: 10, sx: { color: nav.page === 'settings' ? 'primary.main' : 'text.secondary', mt: 0.5 } }}
            />
          </ListItemButton>
        </Tooltip>
      </Drawer>

      {/* Page Content */}
      <Box component="main" sx={{ flex: 1, overflow: 'hidden', pt: '36px', display: 'flex', flexDirection: 'column' }}>
        {nav.page === 'library' && (
          <Library
            onOpenImport={() => navigate({ page: 'processing', processingProjectId: undefined })}
            onPlayProject={(id) => navigate({ page: 'player', playerProjectId: id })}
            onProcessProject={(id) => navigate({ page: 'processing', processingProjectId: id })}
          />
        )}
        {nav.page === 'processing' && (
          <Processing
            projectId={nav.processingProjectId}
            onDone={(id) => navigate({ page: 'player', playerProjectId: id })}
            onCancel={() => navigate({ page: 'library' })}
          />
        )}
        {nav.page === 'player' && nav.playerProjectId && (
          <Player
            key={`${nav.playerProjectId}-${nav.playerRefreshToken}`}
            projectId={nav.playerProjectId}
            onBack={() => navigate({ page: 'library' })}
            onEditSentences={() => navigate({ page: 'sentence-editor' })}
          />
        )}
        {nav.page === 'sentence-editor' && nav.playerProjectId && (
          <SentenceEditor
            projectId={nav.playerProjectId}
            onBack={() => navigate({ page: 'player' })}
          />
        )}
        {nav.page === 'settings' && (
          <Settings onBack={() => navigate({ page: 'library' })} />
        )}
      </Box>
    </Box>
  )
}
