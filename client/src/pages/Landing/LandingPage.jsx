import React, { useState, useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Typography, Button, Grid, Card, CardContent, Chip, Divider, IconButton, Tooltip } from '@mui/material';
import { WhatsApp as WhatsAppIcon, Send as SendIcon, People as PeopleIcon, Assessment as AssessmentIcon, Security as SecurityIcon, Api as ApiIcon, CheckCircle as CheckCircleIcon, ArrowBack as ArrowBackIcon, KeyboardArrowDown as ArrowDownIcon, Bolt as BoltIcon, PrivacyTip as PrivacyTipIcon, AllInbox as InboxIcon, Campaign as CampaignIcon, AutoAwesome as AutomationIcon, Facebook as FacebookIcon, SmartToy as BotIcon, Webhook as WebhookIcon, QrCode2 as QrCodeIcon, AccountTree as TenantIcon, Payments as BillingIcon, ImportExport as ImportExportIcon } from '@mui/icons-material';

// ─── Data ────────────────────────────────────────────────────────────────────
import { tx } from "../../i18n/tx";
const getFeatures = () => [{
  icon: <InboxIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.inbox.title'),
  desc: tx('landing.features.inbox.desc'),
  color: '#008069'
}, {
  icon: <CampaignIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.campaigns.title'),
  desc: tx('landing.features.campaigns.desc'),
  color: '#1976d2'
}, {
  icon: <ImportExportIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.contacts.title'),
  desc: tx('landing.features.contacts.desc'),
  color: '#9c27b0'
}, {
  icon: <AutomationIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.automation.title'),
  desc: tx('landing.features.automation.desc'),
  color: '#ed6c02'
}, {
  icon: <FacebookIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.facebook.title'),
  desc: tx('landing.features.facebook.desc'),
  color: '#2e7d32'
}, {
  icon: <BotIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.bot.title'),
  desc: tx('landing.features.bot.desc'),
  color: '#c62828'
}, {
  icon: <AssessmentIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.analytics.title'),
  desc: tx('landing.features.analytics.desc'),
  color: '#0288d1'
}, {
  icon: <WebhookIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.api.title'),
  desc: tx('landing.features.api.desc'),
  color: '#558b2f'
}, {
  icon: <QrCodeIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.qr.title'),
  desc: tx('landing.features.qr.desc'),
  color: '#00695c'
}, {
  icon: <TenantIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.tenants.title'),
  desc: tx('landing.features.tenants.desc'),
  color: '#5e35b1'
}, {
  icon: <BillingIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.billing.title'),
  desc: tx('landing.features.billing.desc'),
  color: '#ad5f00'
}, {
  icon: <SecurityIcon sx={{ fontSize: 32 }} />,
  title: tx('landing.features.security.title'),
  desc: tx('landing.features.security.desc'),
  color: '#37474f'
}];
const getPlans = () => [{
  key: 'business',
  price: 120,
  credits: '10,000',
  messages: '2,000',
  featured: false
}, {
  key: 'growth',
  price: 550,
  credits: '50,000',
  messages: '10,000',
  featured: true
}].map(plan => ({
  ...plan,
  name: tx(`landing.pricing.${plan.key}.name`),
  description: tx(`landing.pricing.${plan.key}.description`),
  features: tx(`landing.pricing.${plan.key}.features`)
}));
const getCapabilities = () => [{
  icon: '☁️',
  title: tx("auto.k_779647f280e1"),
  desc: tx("auto.k_e4e53fe9d0f1")
}, {
  icon: '🏢',
  title: tx("auto.k_66ab078dba8a"),
  desc: tx("auto.k_1839e3c36792")
}, {
  icon: '⚡',
  title: tx("auto.k_5970776b1466"),
  desc: tx("auto.k_0bb64607bc62")
}, {
  icon: '🔒',
  title: tx("auto.k_d9ad43795645"),
  desc: tx("auto.k_f8d1bbf0568a")
}];
const getSteps = () => [{
  num: '01',
  title: tx("auto.k_3c687473fb12"),
  desc: tx("auto.k_c8bf4c9fd501"),
  color: '#008069'
}, {
  num: '02',
  title: tx("auto.k_f5fb735781ce"),
  desc: tx("auto.k_6d333b79fed9"),
  color: '#1976d2'
}, {
  num: '03',
  title: tx("auto.k_5623daf7960d"),
  desc: tx("auto.k_c81820c32375"),
  color: '#9c27b0'
}, {
  num: '04',
  title: tx("auto.k_89a268ad73c1"),
  desc: tx("auto.k_4166e8526442"),
  color: '#ed6c02'
}];
const getUseCases = () => [{
  emoji: '🛒',
  title: tx("auto.k_1aeb692dc590"),
  desc: tx("auto.k_619ec49f989f"),
  tags: [tx("auto.k_d1feb87532c7"), tx("auto.k_395d955742be"), tx("auto.k_c38d2b27537e")]
}, {
  emoji: '🏥',
  title: tx("auto.k_780a45b180d0"),
  desc: tx("auto.k_74555eb848dc"),
  tags: [tx("auto.k_1e35ac09ce1f"), tx("auto.k_0e236fb18b47"), tx("auto.k_2a565a6d0db1")]
}, {
  emoji: '🏦',
  title: tx("auto.k_5dbde6877b85"),
  desc: tx("auto.k_ac4ba1d1a510"),
  tags: [tx("auto.k_a752b523877d"), tx("auto.k_3d384b4a108b"), tx("auto.k_748bbeec0f79")]
}];
const FeatureCard = ({
  icon,
  title,
  desc,
  color,
  delay = 0
}) => {
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      }, {
        threshold: 0.1
      });
      if (ref.current) observer.observe(ref.current);
      return () => observer.disconnect();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return <Card ref={ref} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} elevation={0} sx={{
    height: '100%',
    border: '1px solid',
    borderColor: hovered ? color : 'rgba(0,0,0,0.07)',
    borderRadius: 3,
    cursor: 'default',
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(30px)',
    transition: `all 0.6s ease ${delay}ms`,
    '&:hover': {
      boxShadow: `0 8px 32px ${color}25`,
      transform: 'translateY(-6px)'
    }
  }}>

            <CardContent sx={{
      p: 3.5
    }}>
                <Box sx={{
        width: 64,
        height: 64,
        borderRadius: 3,
        bgcolor: `${color}15`,
        color: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mb: 2.5,
        transition: 'transform 0.3s',
        transform: hovered ? 'scale(1.1) rotate(-5deg)' : 'scale(1)'
      }}>

                    {icon}
                </Box>
                <Typography component="h3" variant="h6" fontWeight={700} gutterBottom>
                    {title}
                </Typography>
                <Typography variant="body2" color="text.secondary" lineHeight={1.8}>
                    {desc}
                </Typography>
            </CardContent>
        </Card>;
};

// ─── Main Component ───────────────────────────────────────────────────────────

const LandingPage = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const scrollTo = id => {
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth'
    });
  };
  return <Box sx={{
    overflowX: 'hidden',
    bgcolor: '#fff',
    fontFamily: 'Cairo, sans-serif'
  }}>
            {/* Google Font */}
            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />

            {/* ── Navbar ─────────────────────────────────────── */}
            <Box component="nav" sx={{
      position: 'fixed',
      top: 0,
      right: 0,
      left: 0,
      zIndex: 1100,
      transition: 'all 0.3s ease',
      bgcolor: scrolled ? 'rgba(255,255,255,0.95)' : 'transparent',
      backdropFilter: scrolled ? 'blur(20px)' : 'none',
      boxShadow: scrolled ? '0 2px 16px rgba(0,0,0,0.09)' : 'none',
      py: scrolled ? 1 : 2
    }}>

                <Container maxWidth="lg">
                    <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
                        {/* Logo */}
                        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5
          }}>
                            <Box sx={{
              width: 40,
              height: 40,
              bgcolor: '#008069',
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px #00806940'
            }}>

                                <WhatsAppIcon sx={{
                color: 'white',
                fontSize: 24
              }} />
                            </Box>
                            <Typography component="span" variant="h6" fontWeight={800} sx={{
              color: scrolled ? '#111' : 'white',
              fontFamily: 'Cairo, sans-serif',
              letterSpacing: 0.5
            }}>

                                Wa Savana
                            </Typography>
                        </Box>

                        {/* Nav Links */}
                        <Box sx={{
            display: {
              xs: 'none',
              md: 'flex'
            },
            gap: 3,
            alignItems: 'center'
          }}>
                            {[{
              label: tx("auto.k_ec15ec94c35d"),
              id: 'features'
            }, {
              label: tx("auto.k_34d41e4c58a3"),
              id: 'how-it-works'
            }, {
              label: tx("auto.k_58c52dca4d40"),
              id: 'use-cases'
            }, {
              label: tx('landing.navPricing'),
              id: 'pricing'
            }].map(item => <Button key={item.id} onClick={() => scrollTo(item.id)} sx={{
              color: scrolled ? '#333' : 'rgba(255,255,255,0.9)',
              fontFamily: 'Cairo, sans-serif',
              fontWeight: 600,
              textTransform: 'none',
              fontSize: '0.95rem',
              '&:hover': {
                color: '#008069',
                bgcolor: 'transparent'
              }
            }}>

                                    {item.label}
                                </Button>)}
                        </Box>

                        {/* CTA */}
                        <Button component={RouterLink} to="/login" variant="contained" endIcon={<ArrowBackIcon />} sx={{
            bgcolor: '#008069',
            '&:hover': {
              bgcolor: '#005c4b',
              transform: 'translateY(-2px)'
            },
            borderRadius: 2.5,
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 700,
            px: 3,
            py: 1,
            transition: 'all 0.2s',
            boxShadow: '0 4px 12px #00806960',
            textTransform: 'none',
            fontSize: '0.95rem'
          }}>{tx("auto.k_e822237be745")}


            </Button>
                    </Box>
                </Container>
            </Box>

            <Box component="main">
            {/* ── Hero Section ───────────────────────────────── */}
            <Box id="hero" sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      position: 'relative',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #003d33 0%, #005c4b 40%, #008069 70%, #00a884 100%)',
      pt: 10,
      pb: 8
    }}>

                {/* Decorative circles */}
                {[{
        size: 500,
        top: -150,
        right: -100,
        opacity: 0.08
      }, {
        size: 300,
        bottom: -80,
        left: -60,
        opacity: 0.06
      }, {
        size: 180,
        top: '30%',
        left: '15%',
        opacity: 0.05
      }].map((c, i) => <Box key={i} sx={{
        position: 'absolute',
        width: c.size,
        height: c.size,
        borderRadius: '50%',
        bgcolor: 'white',
        opacity: c.opacity,
        top: c.top,
        bottom: c.bottom,
        right: c.right,
        left: c.left,
        pointerEvents: 'none'
      }} />)}

                {/* Floating WhatsApp icons */}
                {[{
        top: '15%',
        left: '8%',
        size: 36,
        delay: '0s',
        opacity: 0.15
      }, {
        top: '60%',
        left: '5%',
        size: 24,
        delay: '1s',
        opacity: 0.1
      }, {
        top: '25%',
        right: '6%',
        size: 28,
        delay: '2s',
        opacity: 0.12
      }, {
        bottom: '20%',
        right: '10%',
        size: 40,
        delay: '0.5s',
        opacity: 0.1
      }].map((f, i) => <WhatsAppIcon key={i} sx={{
        position: 'absolute',
        fontSize: f.size,
        top: f.top,
        bottom: f.bottom,
        left: f.left,
        right: f.right,
        color: 'white',
        opacity: f.opacity,
        animation: `float 4s ease-in-out ${f.delay} infinite`,
        '@keyframes float': {
          '0%, 100%': {
            transform: 'translateY(0px)'
          },
          '50%': {
            transform: 'translateY(-12px)'
          }
        }
      }} />)}

                <Container maxWidth="lg" sx={{
        position: 'relative',
        zIndex: 1
      }}>
                    <Grid container spacing={6} alignItems="center">
                        <Grid size={{
            xs: 12,
            md: 7
          }}>
                            <Chip icon={<BoltIcon sx={{
              color: '#ffd700 !important',
              fontSize: 16
            }} />} label={tx("auto.k_96f869972f1f")} sx={{
              bgcolor: 'rgba(255,255,255,0.12)',
              color: 'white',
              fontFamily: 'Cairo, sans-serif',
              fontWeight: 600,
              mb: 3,
              border: '1px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              px: 1
            }} />

                            <Typography component="h1" variant="h2" fontWeight={900} sx={{
              color: 'white',
              fontFamily: 'Cairo, sans-serif',
              lineHeight: 1.25,
              mb: 2.5,
              fontSize: {
                xs: '2.2rem',
                md: '3rem',
                lg: '3.5rem'
              },
              textShadow: '0 2px 20px rgba(0,0,0,0.2)'
            }}>{tx("auto.k_bb773679c998")}


                <Box component="span" sx={{
                display: 'block',
                background: 'linear-gradient(90deg, #ffd700, #fff)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>{tx("auto.k_9038e6fab313")}


                </Box>{tx("auto.k_e229e7a090d8")}

              </Typography>
                            <Typography component="p" variant="h6" sx={{
              color: 'rgba(255,255,255,0.82)',
              fontFamily: 'Cairo, sans-serif',
              fontWeight: 400,
              lineHeight: 1.9,
              mb: 4,
              maxWidth: 540
            }}>{tx("auto.k_8017241a6c98")}



              </Typography>
                            <Box sx={{
              display: 'flex',
              gap: 2,
              flexWrap: 'wrap'
            }}>
                                <Button component={RouterLink} to="/login" variant="contained" size="large" endIcon={<ArrowBackIcon />} sx={{
                bgcolor: 'white',
                color: '#008069',
                fontFamily: 'Cairo, sans-serif',
                fontWeight: 800,
                textTransform: 'none',
                px: 4,
                py: 1.5,
                borderRadius: 3,
                fontSize: '1rem',
                '&:hover': {
                  bgcolor: '#f0faf8',
                  transform: 'translateY(-3px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
                },
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
              }}>{tx("auto.k_01d7c201c6e3")}


                </Button>
                                <Button onClick={() => scrollTo('features')} variant="outlined" size="large" endIcon={<ArrowDownIcon />} sx={{
                borderColor: 'rgba(255,255,255,0.5)',
                color: 'white',
                fontFamily: 'Cairo, sans-serif',
                fontWeight: 600,
                textTransform: 'none',
                px: 3,
                py: 1.5,
                borderRadius: 3,
                fontSize: '1rem',
                '&:hover': {
                  borderColor: 'white',
                  bgcolor: 'rgba(255,255,255,0.1)'
                }
              }}>{tx("auto.k_2b8e4d19faab")}


                </Button>
                            </Box>

                            {/* Key facts */}
                            <Box sx={{
              display: 'flex',
              gap: 3,
              mt: 4,
              flexWrap: 'wrap'
            }}>
                                {[tx("auto.k_592ab4770c30"), tx("auto.k_37c6fe1938a6"), tx("auto.k_6eb9cde95daa")].map(fact => <Box key={fact} sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75
              }}>
                                        <CheckCircleIcon sx={{
                  color: '#4ade80',
                  fontSize: 18
                }} />
                                        <Typography variant="caption" sx={{
                  color: 'rgba(255,255,255,0.75)',
                  fontFamily: 'Cairo, sans-serif'
                }}>
                                            {fact}
                                        </Typography>
                                    </Box>)}
                            </Box>
                        </Grid>

                        {/* Hero Visual */}
                        <Grid size={{
            xs: 12,
            md: 5
          }} sx={{
            display: {
              xs: 'none',
              md: 'block'
            }
          }}>
                            <Box sx={{
              position: 'relative',
              animation: 'heroFloat 6s ease-in-out infinite',
              '@keyframes heroFloat': {
                '0%, 100%': {
                  transform: 'translateY(0)'
                },
                '50%': {
                  transform: 'translateY(-18px)'
                }
              }
            }}>

                                {/* Mock Dashboard Card */}
                                <Box sx={{
                bgcolor: 'rgba(255,255,255,0.95)',
                borderRadius: 4,
                p: 3,
                boxShadow: '0 40px 80px rgba(0,0,0,0.3)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.3)'
              }}>

                                    <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  mb: 3
                }}>
                                        <Box sx={{
                    width: 40,
                    height: 40,
                    bgcolor: '#008069',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                                            <WhatsAppIcon sx={{
                      color: 'white',
                      fontSize: 22
                    }} />
                                        </Box>
                                        <Box>
                                            <Typography component="span" variant="subtitle2" fontWeight={700} color="#111">Wa Savana</Typography>
                                            <Typography variant="caption" color="text.secondary">{tx("auto.k_2d36ae51d35b")}</Typography>
                                        </Box>
                                        <Box sx={{
                    ml: 'auto',
                    display: 'flex',
                    gap: 0.5
                  }}>
                                            {['#ff5f57', '#febc2e', '#28c840'].map(c => <Box key={c} sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: c
                    }} />)}
                                        </Box>
                                    </Box>
                                    {/* Status row */}
                                    <Grid container spacing={1.5} sx={{
                  mb: 2.5
                }}>
                                        {[{
                    label: tx("auto.k_32564e22337c"),
                    icon: '🏢',
                    color: '#008069'
                  }, {
                    label: tx("auto.k_48f1c81093f6"),
                    icon: '💬',
                    color: '#1976d2'
                  }, {
                    label: tx("auto.k_e58da3b705f3"),
                    icon: '📊',
                    color: '#2e7d32'
                  }].map(s => <Grid size={{
                    xs: 4
                  }} key={s.label}>
                                                <Box sx={{
                      bgcolor: `${s.color}10`,
                      borderRadius: 2,
                      p: 1.5,
                      textAlign: 'center'
                    }}>
                                                    <Typography sx={{
                        fontSize: '1.4rem',
                        lineHeight: 1.4
                      }}>{s.icon}</Typography>
                                                    <Typography variant="caption" color="text.secondary" display="block">{s.label}</Typography>
                                                </Box>
                                            </Grid>)}
                                    </Grid>
                                    {/* Mock message bubbles */}
                                    {[{
                  text: tx("auto.k_ae59f785a6ba"),
                  dir: 'right',
                  bg: '#dcf8c6'
                }, {
                  text: tx("auto.k_eaea6dcdde5c"),
                  dir: 'left',
                  bg: '#f0f0f0'
                }, {
                  text: tx("auto.k_1288c1607015"),
                  dir: 'right',
                  bg: '#dcf8c6'
                }].map((m, i) => <Box key={i} sx={{
                  display: 'flex',
                  justifyContent: m.dir === 'right' ? 'flex-end' : 'flex-start',
                  mb: 1
                }}>
                                            <Box sx={{
                    bgcolor: m.bg,
                    px: 2,
                    py: 1,
                    borderRadius: 2.5,
                    maxWidth: '80%',
                    animation: `fadeIn 0.5s ease ${i * 0.2}s both`,
                    '@keyframes fadeIn': {
                      from: {
                        opacity: 0,
                        transform: 'scale(0.9)'
                      },
                      to: {
                        opacity: 1,
                        transform: 'scale(1)'
                      }
                    }
                  }}>

                                                <Typography variant="caption" color="#111" sx={{
                      fontFamily: 'Cairo, sans-serif'
                    }}>
                                                    {m.text}
                                                </Typography>
                                            </Box>
                                        </Box>)}
                                </Box>

                                {/* Floating badge */}
                                <Box sx={{
                position: 'absolute',
                bottom: -20,
                left: -20,
                bgcolor: '#1976d2',
                color: 'white',
                px: 2,
                py: 1.5,
                borderRadius: 3,
                boxShadow: '0 4px 20px rgba(25,118,210,0.4)',
                animation: 'pulse 2s ease infinite',
                '@keyframes pulse': {
                  '0%, 100%': {
                    boxShadow: '0 4px 20px rgba(25,118,210,0.4)'
                  },
                  '50%': {
                    boxShadow: '0 4px 30px rgba(25,118,210,0.7)'
                  }
                }
              }}>

                                    <Typography variant="caption" fontWeight={700} sx={{
                  fontFamily: 'Cairo, sans-serif',
                  display: 'block'
                }}>{tx("auto.k_822a9646a6b4")}

                  </Typography>
                                    <Typography variant="caption" sx={{
                  opacity: 0.8,
                  fontFamily: 'Cairo, sans-serif'
                }}>{tx("auto.k_1c411b08ef44")}

                  </Typography>
                                </Box>
                            </Box>
                        </Grid>
                    </Grid>
                </Container>
            </Box>

            {/* ── Capabilities Section ────────────────────────── */}
            <Box sx={{
      bgcolor: '#111827',
      py: 8
    }}>
                <Container maxWidth="lg">
                    <Typography component="h2" variant="overline" sx={{
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: 3,
          display: 'block',
          textAlign: 'center',
          mb: 4
        }}>{tx("auto.k_92932866c424")}


          </Typography>
                    <Grid container spacing={4}>
                        {getCapabilities().map((c, i) => <Grid size={{
            xs: 12,
            sm: 6,
            md: 3
          }} key={i}>
                                <Box sx={{
              textAlign: 'center',
              px: 1
            }}>
                                    <Typography sx={{
                fontSize: '2.5rem',
                mb: 1.5
              }}>{c.icon}</Typography>
                                    <Typography component="h3" variant="subtitle1" fontWeight={700} color="white" sx={{
                fontFamily: 'Cairo, sans-serif',
                mb: 1
              }}>
                                        {c.title}
                                    </Typography>
                                    <Typography variant="body2" sx={{
                color: 'rgba(255,255,255,0.5)',
                fontFamily: 'Cairo, sans-serif',
                lineHeight: 1.8
              }}>
                                        {c.desc}
                                    </Typography>
                                </Box>
                            </Grid>)}
                    </Grid>
                </Container>
            </Box>

            {/* ── Features Section ─────────────────────────────── */}
            <Box id="features" sx={{
      py: {
        xs: 8,
        md: 12
      },
      bgcolor: '#f8fafb'
    }}>
                <Container maxWidth="lg">
                    {/* Section Header */}
                    <Box sx={{
          textAlign: 'center',
          mb: 8
        }}>
                        <Chip label={tx("auto.k_ec15ec94c35d")} sx={{
            bgcolor: '#00806915',
            color: '#008069',
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 700,
            mb: 2
          }} />

                        <Typography component="h2" variant="h3" fontWeight={800} sx={{
            fontFamily: 'Cairo, sans-serif',
            mb: 2
          }}>{tx('landing.featuresTitle')}

            </Typography>
                        <Typography component="p" variant="h6" color="text.secondary" sx={{
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 400,
            maxWidth: 600,
            mx: 'auto',
            lineHeight: 1.8
          }}>{tx('landing.featuresSubtitle')}

            </Typography>
                    </Box>

                    <Grid container spacing={3}>
                        {getFeatures().map((f, i) => <Grid size={{
            xs: 12,
            sm: 6,
            md: 3
          }} key={i}>
                                <FeatureCard {...f} delay={i * 60} />
                            </Grid>)}
                    </Grid>
                </Container>
            </Box>

            {/* ── Pricing Section ─────────────────────────────── */}
            <Box id="pricing" sx={{
      py: {
        xs: 8,
        md: 12
      },
      bgcolor: '#fff'
    }}>
                <Container maxWidth="md">
                    <Box sx={{ textAlign: 'center', mb: 7 }}>
                        <Chip label={tx('landing.pricing.eyebrow')} sx={{
            bgcolor: '#00806915',
            color: '#008069',
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 700,
            mb: 2
          }} />
                        <Typography component="h2" variant="h3" fontWeight={800} sx={{
            fontFamily: 'Cairo, sans-serif',
            mb: 2
          }}>
                            {tx('landing.pricing.title')}
                        </Typography>
                        <Typography component="p" variant="h6" color="text.secondary" sx={{
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 400,
            lineHeight: 1.8,
            maxWidth: 680,
            mx: 'auto'
          }}>
                            {tx('landing.pricing.subtitle')}
                        </Typography>
                    </Box>

                    <Grid container spacing={3} alignItems="stretch">
                        {getPlans().map(plan => <Grid size={{ xs: 12, md: 6 }} key={plan.key}>
                            <Card elevation={0} sx={{
                height: '100%',
                position: 'relative',
                border: '2px solid',
                borderColor: plan.featured ? '#008069' : 'rgba(0,0,0,0.08)',
                borderRadius: 4,
                overflow: 'visible',
                boxShadow: plan.featured ? '0 18px 48px rgba(0,128,105,0.16)' : '0 10px 30px rgba(15,23,42,0.06)'
              }}>
                                {plan.featured && <Chip label={tx('landing.pricing.popular')} color="primary" sx={{
                  position: 'absolute',
                  top: -16,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: 'Cairo, sans-serif',
                  fontWeight: 800,
                  px: 1
                }} />}
                                <CardContent sx={{ p: { xs: 3, md: 4 } }}>
                                    <Typography component="h3" variant="h5" fontWeight={800} sx={{ fontFamily: 'Cairo, sans-serif', mb: 1 }}>
                                        {plan.name}
                                    </Typography>
                                    <Typography color="text.secondary" sx={{ fontFamily: 'Cairo, sans-serif', minHeight: { md: 56 }, lineHeight: 1.8, mb: 3 }}>
                                        {plan.description}
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
                                        <Typography component="span" variant="h2" fontWeight={900} color="primary.main">
                                            {plan.price}
                                        </Typography>
                                        <Typography component="span" variant="h6" color="text.secondary" fontWeight={700}>
                                            {tx('landing.pricing.currency')}
                                        </Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                                        {tx('landing.pricing.period')}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
                                        <Chip label={tx('landing.pricing.credits', { count: plan.credits })} color="primary" variant="outlined" />
                                        <Chip label={tx('landing.pricing.messages', { count: plan.messages })} color="secondary" variant="outlined" />
                                    </Box>
                                    <Divider sx={{ mb: 3 }} />
                                    <Box component="ul" sx={{ listStyle: 'none', display: 'grid', gap: 1.5, mb: 4 }}>
                                        {plan.features.map(feature => <Box component="li" key={feature} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                                            <CheckCircleIcon color="primary" sx={{ fontSize: 20, mt: 0.25, flexShrink: 0 }} />
                                            <Typography variant="body2" sx={{ fontFamily: 'Cairo, sans-serif', lineHeight: 1.8 }}>
                                                {feature}
                                            </Typography>
                                        </Box>)}
                                    </Box>
                                    <Button
                                      component={RouterLink}
                                      to="/login"
                                      fullWidth
                                      size="large"
                                      variant={plan.featured ? 'contained' : 'outlined'}
                                      endIcon={<ArrowBackIcon />}
                                      sx={{ borderRadius: 2.5, py: 1.5, fontFamily: 'Cairo, sans-serif', fontWeight: 800 }}
                                    >
                                        {tx('landing.pricing.choose')}
                                    </Button>
                                </CardContent>
                            </Card>
                        </Grid>)}
                    </Grid>
                    <Typography variant="body2" color="text.secondary" sx={{
          textAlign: 'center',
          mt: 4,
          lineHeight: 1.8,
          fontFamily: 'Cairo, sans-serif'
        }}>
                        {tx('landing.pricing.disclaimer')}
                    </Typography>
                </Container>
            </Box>

            {/* ── How It Works ─────────────────────────────────── */}
            <Box id="how-it-works" sx={{
      py: {
        xs: 8,
        md: 12
      }
    }}>
                <Container maxWidth="md">
                    <Box sx={{
          textAlign: 'center',
          mb: 8
        }}>
                        <Chip label={tx("auto.k_34d41e4c58a3")} sx={{
            bgcolor: '#1976d215',
            color: '#1976d2',
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 700,
            mb: 2
          }} />

                        <Typography component="h2" variant="h3" fontWeight={800} sx={{
            fontFamily: 'Cairo, sans-serif',
            mb: 2
          }}>{tx("auto.k_fb71cd5c6ba5")}

            </Typography>
                        <Typography component="p" variant="h6" color="text.secondary" sx={{
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 400
          }}>{tx("auto.k_cf62a0396f08")}

            </Typography>
                    </Box>

                    <Box sx={{
          position: 'relative'
        }}>
                        {/* Connecting line */}
                        <Box sx={{
            position: 'absolute',
            right: {
              md: '50%'
            },
            top: 0,
            bottom: 0,
            width: 2,
            bgcolor: 'divider',
            display: {
              xs: 'none',
              md: 'block'
            },
            transform: 'translateX(50%)'
          }} />

                        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5
          }}>
                            {getSteps().map((step, i) => <Box key={i} sx={{
              display: 'flex',
              gap: 3,
              flexDirection: {
                xs: 'column',
                md: i % 2 === 0 ? 'row' : 'row-reverse'
              },
              alignItems: {
                md: 'center'
              }
            }}>

                                    <Box sx={{
                flex: 1,
                textAlign: {
                  md: i % 2 === 0 ? 'right' : 'left'
                }
              }}>
                                        <Typography component="span" aria-hidden="true" variant="h1" fontWeight={900} sx={{
                  color: '#67747c',
                  fontSize: '5rem',
                  lineHeight: 1,
                  fontFamily: 'monospace',
                  mb: -1
                }}>

                                            {step.num}
                                        </Typography>
                                        <Typography component="h3" variant="h5" fontWeight={800} sx={{
                  fontFamily: 'Cairo, sans-serif',
                  mb: 1,
                  color: step.color
                }}>
                                            {step.title}
                                        </Typography>
                                        <Typography variant="body1" color="text.secondary" sx={{
                  fontFamily: 'Cairo, sans-serif',
                  lineHeight: 1.9
                }}>
                                            {step.desc}
                                        </Typography>
                                    </Box>

                                    {/* Center dot */}
                                    <Box sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: step.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: `0 4px 16px ${step.color}50`,
                border: '4px solid white',
                zIndex: 1
              }}>

                                        <Typography component="span" aria-hidden="true" variant="subtitle1" fontWeight={800} color="white">
                                            {i + 1}
                                        </Typography>
                                    </Box>

                                    <Box sx={{
                flex: 1
              }} />
                                </Box>)}
                        </Box>
                    </Box>
                </Container>
            </Box>

            {/* ── Use Cases ────────────────────────────────────── */}
            <Box id="use-cases" sx={{
      py: {
        xs: 8,
        md: 12
      },
      bgcolor: '#f8fafb'
    }}>
                <Container maxWidth="lg">
                    <Box sx={{
          textAlign: 'center',
          mb: 8
        }}>
                        <Chip label={tx("auto.k_58c52dca4d40")} sx={{
            bgcolor: '#9c27b015',
            color: '#9c27b0',
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 700,
            mb: 2
          }} />

                        <Typography component="h2" variant="h3" fontWeight={800} sx={{
            fontFamily: 'Cairo, sans-serif',
            mb: 2
          }}>{tx("auto.k_a705ab7a3982")}

            </Typography>
                        <Typography component="p" variant="h6" color="text.secondary" sx={{
            fontFamily: 'Cairo, sans-serif',
            fontWeight: 400,
            maxWidth: 500,
            mx: 'auto'
          }}>{tx("auto.k_f0b8b6f9ff6d")}

            </Typography>
                    </Box>
                    <Grid container spacing={3}>
                        {getUseCases().map((u, i) => <Grid size={{
            xs: 12,
            md: 4
          }} key={i}>
                                <Card elevation={0} sx={{
              height: '100%',
              border: '1px solid rgba(0,0,0,0.07)',
              borderRadius: 3,
              transition: 'all 0.3s',
              '&:hover': {
                boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                transform: 'translateY(-4px)',
                borderColor: '#008069'
              }
            }}>

                                    <CardContent sx={{
                p: 3.5
              }}>
                                        <Typography sx={{
                  fontSize: '3rem',
                  mb: 2,
                  display: 'block',
                  lineHeight: 1
                }}>
                                            {u.emoji}
                                        </Typography>
                                        <Typography component="h3" variant="h6" fontWeight={800} sx={{
                  fontFamily: 'Cairo, sans-serif',
                  mb: 1.5
                }}>
                                            {u.title}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{
                  fontFamily: 'Cairo, sans-serif',
                  lineHeight: 1.9,
                  mb: 2.5
                }}>
                                            {u.desc}
                                        </Typography>
                                        <Divider sx={{
                  mb: 2
                }} />
                                        <Box sx={{
                  display: 'flex',
                  gap: 1,
                  flexWrap: 'wrap'
                }}>
                                            {u.tags.map(tag => <Chip key={tag} label={tag} size="small" sx={{
                    bgcolor: '#00725e14',
                    color: '#00725e',
                    fontFamily: 'Cairo, sans-serif',
                    fontSize: '0.7rem'
                  }} />)}
                                        </Box>
                                    </CardContent>
                                </Card>
                            </Grid>)}
                    </Grid>
                </Container>
            </Box>

            {/* ── CTA Section ──────────────────────────────────── */}
            <Box sx={{
      py: {
        xs: 10,
        md: 14
      },
      background: 'linear-gradient(135deg, #003d33 0%, #005c4b 40%, #008069 100%)',
      position: 'relative',
      overflow: 'hidden',
      textAlign: 'center'
    }}>

                <Box sx={{
        position: 'absolute',
        top: -60,
        right: -60,
        width: 250,
        height: 250,
        borderRadius: '50%',
        bgcolor: 'rgba(255,255,255,0.05)'
      }} />
                <Box sx={{
        position: 'absolute',
        bottom: -80,
        left: -40,
        width: 300,
        height: 300,
        borderRadius: '50%',
        bgcolor: 'rgba(255,255,255,0.04)'
      }} />
                <Container maxWidth="md" sx={{
        position: 'relative',
        zIndex: 1
      }}>
                    <Typography component="h2" variant="h3" fontWeight={900} color="white" sx={{
          fontFamily: 'Cairo, sans-serif',
          mb: 2
        }}>{tx("auto.k_62aad83386f3")}

          </Typography>
                    <Typography component="p" variant="h6" sx={{
          color: 'rgba(255,255,255,0.8)',
          fontFamily: 'Cairo, sans-serif',
          fontWeight: 400,
          mb: 5
        }}>{tx("auto.k_0d95d4ae29a1")}

          </Typography>
                    <Button component={RouterLink} to="/login" variant="contained" size="large" endIcon={<ArrowBackIcon />} sx={{
          bgcolor: 'white',
          color: '#008069',
          fontFamily: 'Cairo, sans-serif',
          fontWeight: 800,
          textTransform: 'none',
          px: 5,
          py: 2,
          borderRadius: 3,
          fontSize: '1.1rem',
          '&:hover': {
            bgcolor: '#f0faf8',
            transform: 'translateY(-3px)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.25)'
          },
          transition: 'all 0.3s ease',
          boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
        }}>{tx("auto.k_1455140859a8")}


          </Button>
                </Container>
            </Box>
            </Box>

            {/* ── Footer ───────────────────────────────────────── */}
            <Box component="footer" sx={{
      bgcolor: '#0d1117',
      py: 6
    }}>
                <Container maxWidth="lg">
                    <Grid container spacing={4} sx={{
          mb: 4
        }}>
                        <Grid size={{
            xs: 2,
            md: 4
          }}>
                            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: 2
            }}>
                                <Box sx={{
                width: 36,
                height: 36,
                bgcolor: '#008069',
                borderRadius: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                                    <WhatsAppIcon sx={{
                  color: 'white',
                  fontSize: 20
                }} />
                                </Box>
                                <Typography component="span" variant="h6" fontWeight={800} color="white" sx={{
                fontFamily: 'Cairo, sans-serif'
              }}>
                                    Wa Savana
                                </Typography>
                            </Box>
                            <Typography variant="body2" sx={{
              color: 'rgba(255,255,255,0.5)',
              fontFamily: 'Cairo, sans-serif',
              lineHeight: 1.9
            }}>{tx("auto.k_29d367025d81")}

              </Typography>
                        </Grid>
                        <Grid size={{
            xs: 6,
            md: 2
          }}>
                            <Typography component="h2" variant="subtitle2" color="white" fontWeight={700} sx={{
              fontFamily: 'Cairo, sans-serif',
              mb: 2
            }}>{tx("auto.k_789f1271dd5d")}

              </Typography>
                            {[tx("auto.k_ec15ec94c35d"), tx("auto.k_34d41e4c58a3"), tx("auto.k_45b6f9491079")].map(l => <Typography key={l} variant="body2" sx={{
              color: 'rgba(255,255,255,0.45)',
              fontFamily: 'Cairo, sans-serif',
              mb: 1,
              cursor: 'pointer',
              '&:hover': {
                color: '#008069'
              },
              transition: 'color 0.2s'
            }}>
                                    {l}
                                </Typography>)}
                        </Grid>
                        <Grid size={{
            xs: 6,
            md: 2
          }}>
                            <Typography component="h2" variant="subtitle2" color="white" fontWeight={700} sx={{
              fontFamily: 'Cairo, sans-serif',
              mb: 2
            }}>{tx("auto.k_2109a5cdfc30")}

              </Typography>
                            <Typography component={RouterLink} to="/privacy-policy" variant="body2" sx={{
              color: 'rgba(255,255,255,0.45)',
              fontFamily: 'Cairo, sans-serif',
              display: 'block',
              mb: 1,
              textDecoration: 'none',
              '&:hover': {
                color: '#008069'
              },
              transition: 'color 0.2s'
            }}>{tx("auto.k_8b7b36b70cdd")}


              </Typography>
                            <Typography component="a" href="/api/terms" variant="body2" sx={{
              color: 'rgba(255,255,255,0.45)',
              fontFamily: 'Cairo, sans-serif',
              mb: 1,
              display: 'block',
              textDecoration: 'none',
              '&:hover': { color: '#008069' }
            }}>{tx("auto.k_d8670c074a20")}

              </Typography>
                        </Grid>
                        <Grid size={{
            xs: 12,
            md: 4
          }}>
                            <Typography component="h2" variant="subtitle2" color="white" fontWeight={700} sx={{
              fontFamily: 'Cairo, sans-serif',
              mb: 2
            }}>{tx("auto.k_e976c8a955f0")}

              </Typography>
                            <Button component={RouterLink} to="/login" variant="contained" fullWidth sx={{
              bgcolor: '#008069',
              '&:hover': {
                bgcolor: '#005c4b'
              },
              fontFamily: 'Cairo, sans-serif',
              fontWeight: 700,
              textTransform: 'none',
              borderRadius: 2,
              py: 1.2
            }}>{tx("auto.k_8c6117b67c8b")}


              </Button>
                        </Grid>
                    </Grid>

                    <Divider sx={{
          borderColor: 'rgba(255,255,255,0.08)',
          my: 3
        }} />

                    <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2
        }}>
                        <Typography variant="caption" sx={{
            color: 'rgba(255,255,255,0.78)',
            fontFamily: 'Cairo, sans-serif'
          }}>
                            © {new Date().getFullYear()}{tx("auto.k_d6cfcb0a9c58")}
            </Typography>
                        <Box sx={{
            display: 'flex',
            gap: 1
          }}>
                            <Tooltip title={tx("auto.k_7b5629bcb45d")}>
                                <Box component="span" aria-hidden="true" sx={{
                color: 'rgba(255,255,255,0.4)',
                display: 'inline-flex',
                p: 1
              }}>
                                    <WhatsAppIcon fontSize="small" />
                                </Box>
                            </Tooltip>
                            <Tooltip title={tx("auto.k_8b7b36b70cdd")}>
                                <IconButton aria-label={tx("auto.k_8b7b36b70cdd")} component={RouterLink} to="/privacy-policy" size="small" sx={{
                color: 'rgba(255,255,255,0.4)',
                '&:hover': {
                  color: '#008069'
                }
              }}>
                                    <PrivacyTipIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                </Container>
            </Box>
        </Box>;
};
export default LandingPage;
