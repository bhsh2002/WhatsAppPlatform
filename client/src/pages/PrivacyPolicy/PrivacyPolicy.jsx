import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Container, Typography, Paper, Divider, Button, Grid, Chip } from '@mui/material';
import { ArrowBack as ArrowBackIcon, Security as SecurityIcon, Info as InfoIcon, Share as ShareIcon, Shield as ShieldIcon, ManageAccounts as ManageAccountsIcon, Update as UpdateIcon, ContactMail as ContactMailIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { tx } from "../../i18n/tx";
const getSections = () => [{
  id: 'collection',
  icon: <InfoIcon />,
  title: tx("auto.k_30db22f9dd51"),
  color: '#008069',
  content: [{
    subtitle: tx("auto.k_6cb40e75575b"),
    points: [tx("auto.k_8e3903f7013b"), tx("auto.k_2a660cde6cb1"), tx("auto.k_cc72a1af1d7b")]
  }, {
    subtitle: tx("auto.k_556b7e600f0e"),
    points: [tx("auto.k_a6ce17396a83"), tx("auto.k_9b885288a7d0"), tx("auto.k_9b11ce6a8183")]
  }, {
    subtitle: tx("auto.k_ce41f87c3fa1"),
    points: [tx("auto.k_bc6138b63dd8"), tx("auto.k_60ad45297c3d"), tx("auto.k_f43ef3abd43f"), tx("auto.k_aca85b74be0f")]
  }, {
    subtitle: tx("auto.k_bb4275df0076"),
    points: [tx("auto.k_3cc43468a002"), tx("auto.k_fcc242133c10"), tx("auto.k_7b3ed393995f")]
  }]
}, {
  id: 'usage',
  icon: <CheckCircleIcon />,
  title: tx("auto.k_eb5f9b413a9d"),
  color: '#1976d2',
  content: [{
    subtitle: tx("auto.k_ad9dc78b8571"),
    points: [tx("auto.k_b06604e9d700"), tx("auto.k_5304f0bc014d"), tx("auto.k_599173a1a063")]
  }, {
    subtitle: tx("auto.k_b9ca530ade9e"),
    points: [tx("auto.k_f70063227138"), tx("auto.k_bb873651dba1"), tx("auto.k_86b0431f0f06")]
  }, {
    subtitle: tx("auto.k_b9dc844d86d7"),
    points: [tx("auto.k_18d5b3424b6c"), tx("auto.k_684f0e6988b1")]
  }]
}, {
  id: 'sharing',
  icon: <ShareIcon />,
  title: tx("auto.k_43f0dfe5a692"),
  color: '#ed6c02',
  content: [{
    subtitle: tx("auto.k_bed9824f36ff"),
    points: [tx("auto.k_a780fa16499e")]
  }, {
    subtitle: tx("auto.k_844e3af7248e"),
    points: [tx("auto.k_3a89777e8088"), tx("auto.k_3fb9a9c84971"), tx("auto.k_d6b681d15d23")]
  }]
}, {
  id: 'security',
  icon: <ShieldIcon />,
  title: tx("auto.k_363abe4bae65"),
  color: '#9c27b0',
  content: [{
    subtitle: tx("auto.k_90a38c99eb27"),
    points: [tx("auto.k_8c9056c2df35"), tx("auto.k_e6ccf8b525c1"), tx("auto.k_2996ba5b364d"), tx("auto.k_5b82e8a3d64d"), tx("auto.k_d87e0efe3b41")]
  }, {
    subtitle: tx("auto.k_57c4dee83f14"),
    points: [tx("auto.k_d6e49ea4a0ae")]
  }]
}, {
  id: 'rights',
  icon: <ManageAccountsIcon />,
  title: tx("auto.k_2c4ae2742889"),
  color: '#2e7d32',
  content: [{
    subtitle: tx("auto.k_d7f1dea56976"),
    points: [tx("auto.k_7e09b5fca208"), tx("auto.k_14141598f0c7"), tx("auto.k_aa9b6f661b23"), tx("auto.k_fe290d28b75d"), tx("auto.k_c0547a051d23")]
  }]
}, {
  id: 'retention',
  icon: <UpdateIcon />,
  title: tx("auto.k_4c328bb9bf0c"),
  color: '#0288d1',
  content: [{
    subtitle: tx("auto.k_8f8e81984ca0"),
    points: [tx("auto.k_be4f6286f40b"), tx("auto.k_424ca10310e3"), tx("auto.k_5a5b058d2001"), tx("auto.k_a80ab8d65e71")]
  }]
}, {
  id: 'contact',
  icon: <ContactMailIcon />,
  title: tx("auto.k_d71a3c808569"),
  color: '#c62828',
  content: [{
    subtitle: tx("auto.k_596450efa50d"),
    points: [tx("auto.k_94be620ba084"), tx("auto.k_6182a94b431b")]
  }]
}];
const PrivacyPolicy = () => {
  const navigate = useNavigate();
  return <Box component="main" sx={{
    minHeight: '100vh',
    bgcolor: '#f4f6f8',
    py: {
      xs: 4,
      md: 6
    }
  }}>

            <Container maxWidth="md">
                {/* Header */}
                <Paper component="header" elevation={0} sx={{
        background: 'linear-gradient(135deg, #008069 0%, #005c4b 100%)',
        color: 'white',
        borderRadius: 4,
        p: {
          xs: 3,
          md: 5
        },
        mb: 4,
        position: 'relative',
        overflow: 'hidden'
      }}>

                    <Box sx={{
          position: 'absolute',
          top: -30,
          left: -30,
          width: 150,
          height: 150,
          borderRadius: '50%',
          bgcolor: 'rgba(255,255,255,0.07)'
        }} />

                    <Box sx={{
          position: 'absolute',
          bottom: -50,
          right: -20,
          width: 200,
          height: 200,
          borderRadius: '50%',
          bgcolor: 'rgba(255,255,255,0.05)'
        }} />

                    <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          mb: 2
        }}>
                        <Box sx={{
            bgcolor: 'rgba(255,255,255,0.15)',
            borderRadius: 2,
            p: 1,
            display: 'flex'
          }}>

                            <SecurityIcon sx={{
              fontSize: 32
            }} />
                        </Box>
                        <Typography component="h1" variant="h4" fontWeight={700}>{tx("auto.k_8b7b36b70cdd")}

            </Typography>
                    </Box>
                    <Typography variant="body1" sx={{
          opacity: 0.9,
          maxWidth: 600,
          lineHeight: 1.8
        }}>{tx("auto.k_3cb4af3bc362")}


          </Typography>
                    <Box sx={{
          display: 'flex',
          gap: 1,
          mt: 3,
          flexWrap: 'wrap'
        }}>
                        <Chip label={tx("auto.k_9044ad8c333c")} size="small" sx={{
            bgcolor: 'rgba(255,255,255,0.2)',
            color: 'white'
          }} />

                        <Chip label={tx("auto.k_d8d2baf12ebc")} size="small" sx={{
            bgcolor: 'rgba(255,255,255,0.2)',
            color: 'white'
          }} />

                    </Box>
                </Paper>

                {/* Sections */}
                {getSections().map((section, _idx) => <Paper key={section.id} elevation={0} sx={{
        borderRadius: 3,
        mb: 3,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.2s',
        '&:hover': {
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
        }
      }}>

                        {/* Section Header */}
                        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 3,
          py: 2.5,
          bgcolor: `${section.color}10`,
          borderBottom: `3px solid ${section.color}`
        }}>

                            <Box sx={{
            color: section.color,
            display: 'flex',
            background: `${section.color}18`,
            borderRadius: '50%',
            p: 1
          }}>

                                {section.icon}
                            </Box>
                            <Typography component="h2" variant="h6" fontWeight={700} color={section.color}>
                                {section.title}
                            </Typography>
                        </Box>

                        {/* Section Content */}
                        <Box sx={{
          p: {
            xs: 2.5,
            md: 3.5
          },
          bgcolor: 'white'
        }}>
                            <Grid container spacing={3}>
                                {section.content.map((block, bIdx) => <Grid size={{
              xs: 12
            }} key={bIdx}>
                                        <Typography component="h3" variant="subtitle1" fontWeight={600} color="text.primary" gutterBottom>

                                            {block.subtitle}
                                        </Typography>
                                        <Box component="ul" sx={{
                m: 0,
                pl: 0,
                listStyle: 'none'
              }}>
                                            {block.points.map((point, pIdx) => <Box component="li" key={pIdx} sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  mb: 1
                }}>

                                                    <Box sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    bgcolor: section.color,
                    mt: '7px',
                    flexShrink: 0
                  }} />

                                                    <Typography variant="body2" color="text.secondary" lineHeight={1.75}>

                                                        {point}
                                                    </Typography>
                                                </Box>)}
                                        </Box>
                                        {bIdx < section.content.length - 1 && <Divider sx={{
                mt: 2
              }} />}
                                    </Grid>)}
                            </Grid>
                        </Box>
                    </Paper>)}

                {/* Footer */}
                <Paper component="footer" elevation={0} sx={{
        borderRadius: 3,
        p: 3,
        textAlign: 'center',
        bgcolor: 'white',
        border: '1px solid rgba(0,0,0,0.06)',
        mb: 4
      }}>

                    <Typography variant="body2" color="text.secondary">{tx("auto.k_4730d8665be7")}


          </Typography>
                </Paper>

                {/* Back Button */}
                <Box sx={{
        textAlign: 'center'
      }}>
                    <Button variant="contained" startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{
          bgcolor: '#008069',
          '&:hover': {
            bgcolor: '#005c4b'
          },
          borderRadius: 2,
          px: 4,
          py: 1.2
        }}>{tx("auto.k_5e987aaa4f18")}


          </Button>
                </Box>
            </Container>
        </Box>;
};
export default PrivacyPolicy;
