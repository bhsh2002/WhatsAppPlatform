import React, { useState, useEffect, useCallback } from 'react';
import { Box, Paper, Typography, Button, IconButton, Chip, Card, CardContent, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Switch, FormControlLabel, Checkbox, FormGroup, Alert, CircularProgress, Divider, Grid, InputLabel, FormControl, RadioGroup, Radio, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, SmartToy as SmartToyIcon, VpnKey as KeywordIcon, PlayArrow as TestIcon, Refresh as RefreshIcon, CheckCircle as CheckCircleIcon, Cancel as CancelIcon, Science as ScienceIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import {
  AutomationChannelChip,
  AutomationRuleTypeIcon
} from '../Automation/AutomationPresentation';
import {
  createAutomationRuleDraft,
  formatAutomationCooldown,
  getCHANNELS,
  getDAY_OPTIONS,
  getMATCH_TYPES,
  getRESPONSE_ACTIONS,
  getRULE_TYPES,
  getTRIGGER_ON_OPTIONS
} from '../Automation/automationConfig';
const emptyRule = createAutomationRuleDraft();
const TenantAutomation = () => {
  const [rules, setRules] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    ...emptyRule
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [testChannel, setTestChannel] = useState('whatsapp');
  const [testMessage, setTestMessage] = useState('');
  const [testNewContact, setTestNewContact] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [fbPages, setFbPages] = useState([]);
  const [fbPosts, setFbPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (filterType) params.rule_type = filterType;
      if (filterChannel) params.channel = filterChannel;
      const data = await api.getPortalAutomationRules(params);
      setRules(data);
    } catch (err) {
      console.error('Failed to fetch rules:', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterChannel]);
  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.getPortalAutomationSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  }, []);
  const fetchFbPages = useCallback(async () => {
    try {
      const data = await api.getPortalPages();
      setFbPages(Array.isArray(data) ? data : []);
    } catch {
      setFbPages([]);
    }
  }, []);
  const fetchPostsForPage = useCallback(async linkedPageId => {
    if (!linkedPageId) {
      setFbPosts([]);
      return;
    }
    try {
      setPostsLoading(true);
      const data = await api.getPortalFbPosts(linkedPageId);
      setFbPosts(data?.posts || []);
    } catch {
      setFbPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, []);
  useEffect(() => {
    fetchRules();
    fetchSummary();
    fetchFbPages();
  }, [fetchRules, fetchSummary, fetchFbPages]);
  const handleOpenCreate = () => {
    setEditingRule(null);
    setFormData({
      ...emptyRule
    });
    setDialogOpen(true);
  };
  const handleOpenEdit = rule => {
    setEditingRule(rule);
    let scheduleDays = [];
    try {
      scheduleDays = rule.schedule_days ? JSON.parse(rule.schedule_days) : [];
    } catch {
      scheduleDays = [];
    }
    setFormData({
      name: rule.name || '',
      rule_type: rule.rule_type || 'keyword',
      channel: rule.channel || 'all',
      priority: rule.priority || 100,
      is_active: !!rule.is_active,
      match_type: rule.match_type || 'contains',
      match_pattern: rule.match_pattern || '',
      match_case_sensitive: !!rule.match_case_sensitive,
      schedule_days: scheduleDays,
      schedule_start_time: rule.schedule_start_time || '20:00',
      schedule_end_time: rule.schedule_end_time || '08:00',
      schedule_timezone: rule.schedule_timezone || 'Africa/Tripoli',
      response_type: rule.response_type || 'text',
      response_text: rule.response_text || '',
      cooldown_seconds: rule.cooldown_seconds ?? 300,
      target_post_id: rule.target_post_id || '',
      target_page_id: rule.target_page_id || '',
      response_action: rule.response_action || 'comment',
      dm_text: rule.dm_text || '',
      trigger_on: rule.trigger_on || 'comment',
      auto_like: !!rule.auto_like,
      auto_like_type: rule.auto_like_type || 'like'
    });
    if (rule.target_page_id) fetchPostsForPage(rule.target_page_id);
    setDialogOpen(true);
  };
  const handleSave = async () => {
    try {
      setSaving(true);
      const isComment = formData.rule_type === 'comment_reply';
      const payload = {
        ...formData,
        channel: isComment ? 'facebook' : formData.channel,
        schedule_days: formData.rule_type === 'away' ? JSON.stringify(formData.schedule_days) : null,
        schedule_start_time: formData.rule_type === 'away' ? formData.schedule_start_time : null,
        schedule_end_time: formData.rule_type === 'away' ? formData.schedule_end_time : null,
        match_type: formData.rule_type === 'keyword' || isComment ? formData.match_type : null,
        match_pattern: formData.rule_type === 'keyword' || isComment ? formData.match_pattern : null,
        target_post_id: isComment ? formData.target_post_id || null : null,
        target_page_id: isComment ? formData.target_page_id || null : null,
        response_action: isComment ? formData.response_action : 'comment',
        dm_text: isComment ? formData.dm_text || null : null,
        trigger_on: isComment ? formData.trigger_on : 'comment',
        auto_like: isComment ? formData.auto_like : false,
        auto_like_type: isComment ? formData.auto_like_type : 'like'
      };
      if (editingRule) {
        await api.updatePortalAutomationRule(editingRule.id, payload);
      } else {
        await api.createPortalAutomationRule(payload);
      }
      setDialogOpen(false);
      fetchRules();
      fetchSummary();
    } catch (err) {
      alert(err.message || tx("auto.k_99f3bf3c6acc"));
    } finally {
      setSaving(false);
    }
  };
  const handleToggle = async id => {
    try {
      await api.togglePortalAutomationRule(id);
      fetchRules();
      fetchSummary();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };
  const handleDelete = async id => {
    try {
      await api.deletePortalAutomationRule(id);
      setDeleteConfirm(null);
      fetchRules();
      fetchSummary();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };
  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const result = await api.testAutomationRule({
        channel: testChannel,
        message_text: testMessage,
        is_new_contact: testNewContact
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        error: err.message
      });
    } finally {
      setTesting(false);
    }
  };
  const getRuleTypeLabel = type => getRULE_TYPES().find(t => t.value === type)?.label || type;
  return <Box sx={{
    p: {
      xs: 1.5,
      md: 3
    },
    maxWidth: 1200,
    mx: 'auto'
  }}>
            <Box sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 3
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1
      }}>
                    <SmartToyIcon sx={{
          fontSize: 32,
          color: 'primary.main'
        }} />
                    <Typography variant="h5" component="h1" fontWeight="bold">{tx("auto.k_2402e008b43d")}</Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>{tx("auto.k_72f9f1931922")}

        </Button>
            </Box>

            {summary && <Grid container spacing={2} sx={{
      mb: 3
    }}>
                    {[{
        label: tx("auto.k_0b3adc2f9b12"),
        value: summary.total,
        icon: <SmartToyIcon />,
        color: '#6366f1'
      }, {
        label: tx("auto.k_6cf44b8c32d1"),
        value: summary.active,
        icon: <CheckCircleIcon />,
        color: '#22c55e'
      }, {
        label: tx("auto.k_84e3c4c39d2a"),
        value: summary.keywords,
        icon: <KeywordIcon />,
        color: '#f59e0b'
      }, {
        label: tx("auto.k_72bfbfe81c81"),
        value: summary.totalTriggers,
        icon: <TestIcon />,
        color: '#06b6d4'
      }].map((stat, i) => <Grid size={{
        xs: 6,
        md: 3
      }} key={i}>
                            <Card sx={{
          textAlign: 'center'
        }}>
                                <CardContent sx={{
            py: 2
          }}>
                                    <Box sx={{
              color: stat.color,
              mb: 0.5
            }}>{stat.icon}</Box>
                                    <Typography variant="h5" component="p" fontWeight="bold">{stat.value}</Typography>
                                    <Typography variant="caption" color="text.secondary">{stat.label}</Typography>
                                </CardContent>
                            </Card>
                        </Grid>)}
                </Grid>}

            <Paper sx={{
      p: 2,
      mb: 3,
      display: 'flex',
      gap: 2,
      alignItems: 'center',
      flexWrap: 'wrap'
    }}>
                <FormControl size="small" sx={{
        minWidth: 140
      }}>
                    <InputLabel>{tx("auto.k_f0efbb3238e2")}</InputLabel>
                    <Select value={filterType} onChange={e => setFilterType(e.target.value)} label={tx("auto.k_f0efbb3238e2")}>
                        <MenuItem value="">{tx("auto.k_11fdef2dc5f8")}</MenuItem>
                        {getRULE_TYPES().map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{
        minWidth: 140
      }}>
                    <InputLabel>{tx("auto.k_0b4273bee983")}</InputLabel>
                    <Select value={filterChannel} onChange={e => setFilterChannel(e.target.value)} label={tx("auto.k_0b4273bee983")}>
                        <MenuItem value="">{tx("auto.k_11fdef2dc5f8")}</MenuItem>
                        {getCHANNELS().map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                    </Select>
                </FormControl>
                <Box sx={{
        flex: 1
      }} />
                <IconButton onClick={() => {
        fetchRules();
        fetchSummary();
      }} title={tx("auto.k_4309a75e6882")}>
                    <RefreshIcon />
                </IconButton>
            </Paper>

            {loading ? <Box sx={{
      textAlign: 'center',
      p: 4
    }}><CircularProgress /></Box> : rules.length === 0 ? <Paper sx={{
      p: 4,
      textAlign: 'center'
    }}>
                    <SmartToyIcon sx={{
        fontSize: 60,
        color: 'grey.300',
        mb: 2
      }} />
                    <Typography variant="h6" component="p" color="text.secondary">{tx("auto.k_350aac02a81e")}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
        mb: 2
      }}>{tx("auto.k_4a24210fb63e")}

        </Typography>
                    <Button variant="outlined" startIcon={<AddIcon />} onClick={handleOpenCreate}>{tx("auto.k_347509b3fa87")}

        </Button>
                </Paper> : <TableContainer component={Paper}>
                    <Table sx={{ minWidth: 1040 }}>
                        <TableHead>
                            <TableRow sx={{
            bgcolor: 'grey.50'
          }}>
                                <TableCell sx={{ minWidth: 80 }}>{tx("auto.k_303856bc39ec")}</TableCell>
                                <TableCell>{tx("auto.k_d6370401145d")}</TableCell>
                                <TableCell sx={{ minWidth: 220 }}>{tx("auto.k_0a92494ea1eb")}</TableCell>
                                <TableCell sx={{ minWidth: 150 }}>{tx("auto.k_033626158b17")}</TableCell>
                                <TableCell sx={{ minWidth: 130 }}>{tx("auto.k_0b4273bee983")}</TableCell>
                                <TableCell>{tx("auto.k_03771ee0b820")}</TableCell>
                                <TableCell>{tx("auto.k_156a8aea6b1d")}</TableCell>
                                <TableCell sx={{ minWidth: 110 }}>{tx("auto.k_8edfb81a349f")}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rules.map(rule => <TableRow key={rule.id} sx={{
            '&:hover': {
              bgcolor: 'grey.50'
            }
          }}>
                                    <TableCell><Chip label={rule.priority} size="small" variant="outlined" sx={{
                fontWeight: 'bold'
              }} /></TableCell>
                                    <TableCell><Switch checked={!!rule.is_active} onChange={() => handleToggle(rule.id)} size="small" color="success" /></TableCell>
                                    <TableCell>
                                        <Typography variant="subtitle2" fontWeight="bold">{rule.name}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{
                display: 'block',
                maxWidth: 250,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                                            {rule.rule_type === 'keyword' && `${rule.match_type === 'exact' ? tx("auto.k_d67db9231669") : rule.match_type === 'contains' ? tx("auto.k_312f08b0567b") : 'regex:'} ${rule.match_pattern}`}
                                            {rule.rule_type === 'welcome' && tx("auto.k_5be377178928")}
                                            {rule.rule_type === 'away' && `${rule.schedule_start_time} - ${rule.schedule_end_time}`}
                                            {rule.rule_type === 'comment_reply' && `${rule.trigger_on === 'reaction' ? tx("auto.k_5883cddbd20d") : rule.trigger_on === 'both' ? tx("auto.k_36287ad4ff21") : tx("auto.k_aa42bdc894b4")} • ${rule.target_post_id ? tx("auto.k_7e5dcc29cb17") : tx("auto.k_2a88d0d57a39")} • ${rule.response_action === 'comment' ? tx("auto.k_b2f6eba8be26") : rule.response_action === 'dm' ? tx("auto.k_76dc33283220") : tx("auto.k_ddf5dbab3034")}${rule.match_pattern ? ` • ${rule.match_pattern}` : ''}`}
                                        </Typography>
                                    </TableCell>
                                    <TableCell><Chip icon={<AutomationRuleTypeIcon type={rule.rule_type} />} label={getRuleTypeLabel(rule.rule_type)} size="small" variant="outlined" /></TableCell>
                                    <TableCell><AutomationChannelChip channel={rule.channel} /></TableCell>
                                    <TableCell><Typography variant="body2" fontWeight="bold">{rule.trigger_count || 0}</Typography></TableCell>
                                    <TableCell><Typography variant="caption">{formatAutomationCooldown(rule.cooldown_seconds)}</Typography></TableCell>
                                    <TableCell>
                                        <Tooltip title={tx("auto.k_b4f76c3aa21e")}><IconButton size="small" aria-label={tx("auto.k_b4f76c3aa21e")} onClick={() => handleOpenEdit(rule)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                        <Tooltip title={tx("auto.k_2d2bbdc2d694")}><IconButton size="small" color="error" aria-label={tx("auto.k_2d2bbdc2d694")} onClick={() => setDeleteConfirm(rule)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                    </TableCell>
                                </TableRow>)}
                        </TableBody>
                    </Table>
                </TableContainer>}

            <Paper sx={{
      p: 3,
      mt: 3
    }}>
                <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 2
      }}>
                    <ScienceIcon color="primary" />
                    <Typography variant="h6" component="h2">{tx("auto.k_f7fe8df269fa")}</Typography>
                </Box>
                <Box sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap',
        alignItems: 'flex-end'
      }}>
                    <FormControl size="small" sx={{
          minWidth: 130
        }}>
                        <InputLabel>{tx("auto.k_0b4273bee983")}</InputLabel>
                        <Select value={testChannel} onChange={e => setTestChannel(e.target.value)} label={tx("auto.k_0b4273bee983")}>
                            <MenuItem value="whatsapp">{tx("auto.k_7b5629bcb45d")}</MenuItem>
                            <MenuItem value="messenger">{tx("auto.k_3cab5678293b")}</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField size="small" label={tx("auto.k_691773aa9290")} value={testMessage} onChange={e => setTestMessage(e.target.value)} sx={{
          flex: 1,
          minWidth: 200
        }} />
                    <FormControlLabel control={<Checkbox checked={testNewContact} onChange={e => setTestNewContact(e.target.checked)} size="small" />} label={tx("auto.k_294297fd2763")} />
                    <Button variant="contained" startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <TestIcon />} onClick={handleTest} disabled={testing || !testMessage && !testNewContact}>{tx("auto.k_23cb11721a47")}

          </Button>
                </Box>
                {testResult && <Box sx={{
        mt: 2
      }}>
                        {testResult.error ? <Alert severity="error">{testResult.error}</Alert> : testResult.would_match ? <Alert severity="success" icon={<CheckCircleIcon />}>
                                <Typography variant="subtitle2">{tx("auto.k_f9b54af44d45")}{testResult.rule.name}{tx("auto.k_b1acaa377b11")}{testResult.rule.priority})</Typography>
                                <Typography variant="body2" sx={{
            mt: 0.5,
            opacity: 0.8
          }}>{tx("auto.k_98ffa376efe3")}
              {testResult.response_text?.substring(0, 150)}{testResult.response_text?.length > 150 ? '...' : ''}
                                </Typography>
                            </Alert> : <Alert severity="info" icon={<CancelIcon />}>{tx("auto.k_63ed806e9cbe")}</Alert>}
                    </Box>}
            </Paper>

            <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': editingRule ? tx("auto.k_bac787825650", { value1: editingRule.name }) : tx("auto.k_89b0406e09e3") } }}>
                <DialogTitle>{editingRule ? tx("auto.k_bac787825650", {
          value1: editingRule.name
        }) : tx("auto.k_89b0406e09e3")}</DialogTitle>
                <DialogContent dividers>
                    <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pt: 1
        }}>
                        <TextField label={tx("auto.k_5ffc2bb872d8")} value={formData.name} onChange={e => setFormData(p => ({
            ...p,
            name: e.target.value
          }))} required fullWidth />

                        <Box sx={{
            display: 'flex',
            gap: 2
          }}>
                            <FormControl fullWidth>
                                <InputLabel>{tx("auto.k_f0efbb3238e2")}</InputLabel>
                                <Select value={formData.rule_type} onChange={e => setFormData(p => ({
                ...p,
                rule_type: e.target.value
              }))} label={tx("auto.k_f0efbb3238e2")} disabled={!!editingRule}>
                                    {getRULE_TYPES().map(t => <MenuItem key={t.value} value={t.value}>
                                            <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1
                  }}><AutomationRuleTypeIcon type={t.value} /> {t.label}</Box>
                                        </MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth>
                                <InputLabel>{tx("auto.k_0b4273bee983")}</InputLabel>
                                <Select value={formData.channel} onChange={e => setFormData(p => ({
                ...p,
                channel: e.target.value
              }))} label={tx("auto.k_0b4273bee983")}>
                                    {getCHANNELS().map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Box>

                        <TextField label={tx("auto.k_303856bc39ec")} type="number" value={formData.priority} onChange={e => setFormData(p => ({
            ...p,
            priority: parseInt(e.target.value) || 100
          }))} helperText={tx("auto.k_9f1144ad1e2a")} sx={{
            minWidth: 120
          }} />

                        <Divider />

                        {formData.rule_type === 'keyword' && <>
                                <Typography variant="subtitle2" color="primary">{tx("auto.k_c7e206a0654f")}</Typography>
                                <Box sx={{
              display: 'flex',
              gap: 2
            }}>
                                    <FormControl sx={{
                minWidth: 160
              }}>
                                        <InputLabel>{tx("auto.k_fd4dd527a042")}</InputLabel>
                                        <Select value={formData.match_type} onChange={e => setFormData(p => ({
                  ...p,
                  match_type: e.target.value
                }))} label={tx("auto.k_fd4dd527a042")}>
                                            {getMATCH_TYPES().map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                    <TextField label={formData.match_type === 'contains' ? tx("auto.k_5c46a53e87a2") : tx("auto.k_f345f02788a1")} value={formData.match_pattern} onChange={e => setFormData(p => ({
                ...p,
                match_pattern: e.target.value
              }))} fullWidth placeholder={formData.match_type === 'contains' ? tx("auto.k_471e5ede13e4") : ''} />
                                </Box>
                                <FormControlLabel control={<Checkbox checked={formData.match_case_sensitive} onChange={e => setFormData(p => ({
              ...p,
              match_case_sensitive: e.target.checked
            }))} />} label={tx("auto.k_c49f88b4ade0")} />
                            </>}

                        {formData.rule_type === 'welcome' && <Alert severity="info">{tx("auto.k_9971f4e35885")}</Alert>}

                        {formData.rule_type === 'away' && <>
                                <Typography variant="subtitle2" color="primary">{tx("auto.k_746106ddb89b")}</Typography>
                                <FormGroup row>
                                    {getDAY_OPTIONS().map(day => <FormControlLabel key={day.value} control={<Checkbox checked={formData.schedule_days.includes(day.value)} onChange={e => {
                setFormData(p => ({
                  ...p,
                  schedule_days: e.target.checked ? [...p.schedule_days, day.value] : p.schedule_days.filter(d => d !== day.value)
                }));
              }} size="small" />} label={day.label} />)}
                                </FormGroup>
                                <Box sx={{
              display: 'flex',
              gap: 2
            }}>
                                    <TextField label={tx("auto.k_edd6d456ead6")} type="time" value={formData.schedule_start_time} onChange={e => setFormData(p => ({
                ...p,
                schedule_start_time: e.target.value
              }))} InputLabelProps={{
                shrink: true
              }} fullWidth />
                                    <TextField label={tx("auto.k_6a4de053356b")} type="time" value={formData.schedule_end_time} onChange={e => setFormData(p => ({
                ...p,
                schedule_end_time: e.target.value
              }))} InputLabelProps={{
                shrink: true
              }} fullWidth />
                                </Box>
                                <Alert severity="info" sx={{
              fontSize: '0.8rem'
            }}>{tx("auto.k_d920bb1d2c66")}</Alert>
                            </>}

                        {formData.rule_type === 'comment_reply' && <>
                                <Typography variant="subtitle2" color="primary">{tx("auto.k_e80083ed8835")}</Typography>
                                <Box sx={{
              display: 'flex',
              gap: 2
            }}>
                                    <FormControl fullWidth>
                                        <InputLabel>{tx("auto.k_6d9919fa1682")}</InputLabel>
                                        <Select value={formData.target_page_id} onChange={e => {
                  const pageId = e.target.value;
                  setFormData(p => ({
                    ...p,
                    target_page_id: pageId,
                    target_post_id: ''
                  }));
                  fetchPostsForPage(pageId);
                }} label={tx("auto.k_6d9919fa1682")}>
                                            <MenuItem value="">{tx("auto.k_a13fe21ded7a")}</MenuItem>
                                            {fbPages.map(p => <MenuItem key={p.id} value={p.id}>{p.page_name || p.page_id}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                    <FormControl fullWidth>
                                        <InputLabel>{tx("auto.k_be784686fb34")}</InputLabel>
                                        <Select value={formData.target_post_id} onChange={e => setFormData(p => ({
                  ...p,
                  target_post_id: e.target.value
                }))} label={tx("auto.k_be784686fb34")} disabled={!formData.target_page_id || postsLoading}>
                                            <MenuItem value="">{tx("auto.k_2a88d0d57a39")}</MenuItem>
                                            {fbPosts.map(post => <MenuItem key={post.id} value={post.id}>{(post.message || tx("auto.k_50a00995bf55")).substring(0, 60)}{(post.message || '').length > 60 ? '...' : ''}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                </Box>

                                <Typography variant="subtitle2" color="primary" sx={{
              mt: 1
            }}>{tx("auto.k_d102fc1553e4")}</Typography>
                                <Box sx={{
              display: 'flex',
              gap: 2
            }}>
                                    <FormControl sx={{
                minWidth: 160
              }}>
                                        <InputLabel>{tx("auto.k_fd4dd527a042")}</InputLabel>
                                        <Select value={formData.match_type} onChange={e => setFormData(p => ({
                  ...p,
                  match_type: e.target.value
                }))} label={tx("auto.k_fd4dd527a042")}>
                                            {getMATCH_TYPES().map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                    <TextField label={tx("auto.k_c90904ddb1c9")} value={formData.match_pattern} onChange={e => setFormData(p => ({
                ...p,
                match_pattern: e.target.value
              }))} fullWidth placeholder={tx("auto.k_5c31bfbf8571")} />
                                </Box>

                                <Typography variant="subtitle2" color="primary" sx={{
              mt: 1
            }}>{tx("auto.k_f747f84fdd3f")}</Typography>
                                <RadioGroup row value={formData.trigger_on} onChange={e => {
              const val = e.target.value;
              setFormData(p => ({
                ...p,
                trigger_on: val,
                response_action: val === 'reaction' ? 'dm' : p.response_action
              }));
            }}>
                                    {getTRIGGER_ON_OPTIONS().map(t => <FormControlLabel key={t.value} value={t.value} control={<Radio />} label={t.label} />)}
                                </RadioGroup>

                                <Typography variant="subtitle2" color="primary" sx={{
              mt: 1
            }}>{tx("auto.k_1c35c0ad42cf")}</Typography>
                                <RadioGroup row value={formData.response_action} onChange={e => setFormData(p => ({
              ...p,
              response_action: e.target.value
            }))}>
                                    {getRESPONSE_ACTIONS().map(a => <FormControlLabel key={a.value} value={a.value} control={<Radio />} label={a.label} disabled={formData.trigger_on === 'reaction' && a.value === 'comment'} />)}
                                </RadioGroup>

                                {(formData.trigger_on === 'comment' || formData.trigger_on === 'both') && <FormControlLabel control={<Switch checked={formData.auto_like} onChange={e => setFormData(p => ({
              ...p,
              auto_like: e.target.checked
            }))} color="primary" />} label={tx("auto.k_5a403435e527")} />}
                            </>}

                        <Divider />

                        <Typography variant="subtitle2" color="primary">
                            {formData.rule_type === 'comment_reply' && (formData.response_action === 'comment' || formData.response_action === 'both') ? tx("auto.k_12f26a5a5025") : tx("auto.k_1f3f1d9a57dd")}
                        </Typography>
                        {(formData.rule_type !== 'comment_reply' || formData.response_action === 'comment' || formData.response_action === 'both') && <TextField label={formData.rule_type === 'comment_reply' ? tx("auto.k_73cb640c8769") : tx("auto.k_0ded1e7396d8")} value={formData.response_text} onChange={e => setFormData(p => ({
            ...p,
            response_text: e.target.value
          }))} multiline rows={3} required={formData.rule_type !== 'comment_reply'} fullWidth placeholder={tx("auto.k_de4645add52c")} />}
                        {formData.rule_type === 'comment_reply' && (formData.response_action === 'dm' || formData.response_action === 'both') && <TextField label={tx("auto.k_77a27e586027")} value={formData.dm_text} onChange={e => setFormData(p => ({
            ...p,
            dm_text: e.target.value
          }))} multiline rows={3} fullWidth placeholder={tx("auto.k_af325204b964")} />}
                        <TextField label={tx("auto.k_12d4073ae81b")} type="number" value={formData.cooldown_seconds} onChange={e => setFormData(p => ({
            ...p,
            cooldown_seconds: parseInt(e.target.value) || 0
          }))} helperText={`= ${formatAutomationCooldown(formData.cooldown_seconds)}`} fullWidth />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleSave} disabled={saving || !formData.name || (formData.rule_type === 'comment_reply' ? !formData.response_text && !formData.dm_text : !formData.response_text)} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
                        {saving ? tx("auto.k_898769fc464a") : editingRule ? tx("auto.k_4309a75e6882") : tx("auto.k_8a1d0b74e145")}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" slotProps={{ paper: { 'aria-label': tx("auto.k_2c518e8bc47f") } }}>
                <DialogTitle>{tx("auto.k_2c518e8bc47f")}</DialogTitle>
                <DialogContent>
                    <Typography>{tx("auto.k_d8cb1c8e76db")}{deleteConfirm?.name}{tx("auto.k_35d364226bb5")}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{
          mt: 1
        }}>{tx("auto.k_b34b205af566")}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm(null)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" color="error" onClick={() => handleDelete(deleteConfirm.id)}>{tx("auto.k_2d2bbdc2d694")}</Button>
                </DialogActions>
            </Dialog>
        </Box>;
};
export default TenantAutomation;
