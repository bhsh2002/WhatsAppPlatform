import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, List, ListItem, ListItemText, TextField, Box, Typography, Chip, InputAdornment, IconButton, Paper, Divider, CircularProgress } from '@mui/material';
import { Search as SearchIcon, Close as CloseIcon, Description as TemplateIcon, AttachFile as AttachFileIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
const TemplatePicker = ({
  open,
  onClose,
  onSelect,
  templates = []
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [variables, setVariables] = useState({});
  const [uploading, setUploading] = useState(false);

  const [previousOpen, setPreviousOpen] = useState(open);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setSearchTerm('');
      setSelectedTemplate(null);
      setVariables({});
    }
  }

  // Filter templates
  const filteredTemplates = templates.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()) && t.status === 'approved' // Only show approved templates
  );

  // Extract variables from template body, header, and buttons
  const getTemplateVariables = template => {
    const vars = {
      header: [],
      body: [],
      buttons: []
    };
    if (template.body) {
      const matches = template.body.match(/\{\{([^}]+)\}\}/g);
      if (matches) {
        vars.body = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
      }
    }
    if (template.header_type === 'text' && template.header_content) {
      const matches = template.header_content.match(/\{\{([^}]+)\}\}/g);
      if (matches) {
        vars.header = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
      }
    } else if (['image', 'video', 'document', 'audio'].includes(template.header_type?.toLowerCase())) {
      // Meta requires a media link for non-text headers
      vars.header = ['MEDIA_LINK'];
    }
    if (template.buttons) {
      try {
        const buttons = typeof template.buttons === 'string' ? JSON.parse(template.buttons) : template.buttons;
        if (Array.isArray(buttons)) {
          buttons.forEach((btn, index) => {
            if (btn.type === 'URL' && btn.url) {
              const matches = btn.url.match(/\{\{([^}]+)\}\}/g);
              if (matches) {
                vars.buttons.push({
                  index: index.toString(),
                  sub_type: 'url',
                  text: btn.text,
                  url: btn.url,
                  variables: [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))]
                });
              }
            }
          });
        }
      } catch (e) {
        console.error('Failed to parse buttons:', e);
      }
    }
    return vars;
  };
  const handleTemplateClick = template => {
    setSelectedTemplate(template);
    setVariables({});
  };
  const handleVariableChange = (section, index, value) => {
    setVariables(prev => ({
      ...prev,
      [`${section}_${index}`]: value
    }));
  };
  const handleSend = async () => {
    if (!selectedTemplate) return;
    const templateVars = getTemplateVariables(selectedTemplate);
    const isNamed = selectedTemplate.parameter_format === 'named';
    const components = [];
    if (templateVars.header.length > 0) {
      const headerParams = [];
      for (let v of templateVars.header) {
        if (v === 'MEDIA_LINK') {
          const hType = selectedTemplate.header_type.toLowerCase();
          const fileOrLink = variables[`header_${v}`];
          if (!fileOrLink) {
            alert(tx("auto.k_f5e1d306e752"));
            return;
          }
          if (fileOrLink instanceof File) {
            setUploading(true);
            try {
              const res = await api.uploadPortalMediaToMeta(fileOrLink);
              headerParams.push({
                type: hType,
                [hType]: {
                  id: res.id
                }
              });
            } catch (e) {
              setUploading(false);
              alert(tx("auto.k_b3c22c0578ad") + e.message);
              return;
            }
            setUploading(false);
          } else if (typeof fileOrLink === 'string') {
            // Fallback in case a URL was pasted programmatically
            headerParams.push({
              type: hType,
              [hType]: {
                link: fileOrLink
              }
            });
          }
        } else {
          const param = {
            type: 'text',
            text: variables[`header_${v}`] || ''
          };
          if (isNamed) param.parameter_name = v;
          headerParams.push(param);
        }
      }
      components.push({
        type: 'header',
        parameters: headerParams
      });
    }
    if (templateVars.body.length > 0) {
      const bodyParams = templateVars.body.map(v => {
        const param = {
          type: 'text',
          text: variables[`body_${v}`] || ''
        };
        if (isNamed) param.parameter_name = v;
        return param;
      });
      components.push({
        type: 'body',
        parameters: bodyParams
      });
    }
    templateVars.buttons.forEach(btn => {
      if (btn.variables.length > 0) {
        const buttonParams = btn.variables.map(v => ({
          type: 'text',
          text: variables[`button_${btn.index}_${v}`] || ''
        }));
        components.push({
          type: 'button',
          sub_type: 'url',
          index: btn.index,
          parameters: buttonParams
        });
      }
    });
    onSelect({
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      language: {
        code: selectedTemplate.language || 'ar'
      },
      components: components,
      // Pass full template data for local display/storage optimization
      _templateData: {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        header: selectedTemplate.header_type === 'text' ? {
          type: 'text',
          text: selectedTemplate.header_content
        } : null,
        body: selectedTemplate.body,
        footer: selectedTemplate.footer,
        buttons: selectedTemplate.buttons
      }
    });
    onClose();
  };

  // Helper to render preview with replaced variables
  const renderPreview = (text, type, btnIndex = null) => {
    if (!text) return '';
    return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const key = btnIndex !== null ? `${type}_${btnIndex}_${varName}` : `${type}_${varName}`;
      const val = variables[key];
      return val ? `[${val}]` : match;
    });
  };
  const renderButtonPreview = (btn, btnIndex) => {
    if (btn.type === 'URL' && btn.url) {
      const previewUrl = btn.url.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
        const val = variables[`button_${btnIndex}_${varName}`];
        return val ? `[${val}]` : match;
      });
      return previewUrl;
    }
    return null;
  };
  return <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { 'aria-label': tx("auto.k_8fa6558c1e58") } }}>
            <DialogTitle sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>{tx("auto.k_8fa6558c1e58")}

        <IconButton aria-label={tx("auto.k_e776b0209b50")} onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{
      height: '60vh',
      p: 0,
      display: 'flex'
    }}>
                {/* List Section */}
                <Box sx={{
        width: '40%',
        borderRight: '1px solid #e0e0e0',
        display: 'flex',
        flexDirection: 'column'
      }}>
                    <Box sx={{
          p: 2,
          borderBottom: '1px solid #e0e0e0'
        }}>
                        <TextField fullWidth size="small" placeholder={tx("auto.k_4d7f8f61cde4")} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>
          }} />

                    </Box>
                    <List sx={{
          flex: 1,
          overflowY: 'auto'
        }}>
                        {filteredTemplates.map(template => <ListItem key={template.id} button selected={selectedTemplate?.id === template.id} onClick={() => handleTemplateClick(template)}>

                                <ListItemText primary={template.name} secondary={template.category} sx={{
              '& .MuiListItemText-primary': {
                fontWeight: 500
              },
              '& .MuiListItemText-secondary': {
                fontSize: '0.75rem'
              }
            }} />

                                <Chip label={template.language} size="small" variant="outlined" sx={{
              fontSize: '0.7rem',
              height: 20
            }} />
                            </ListItem>)}
                        {filteredTemplates.length === 0 && <Box sx={{
            p: 3,
            textAlign: 'center',
            color: 'text.secondary'
          }}>{tx("auto.k_cead73eab5df")}

            </Box>}
                    </List>
                </Box>

                {/* Details & Preview Section */}
                <Box sx={{
        width: '60%',
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto'
      }}>
                    {selectedTemplate ? <>
                            <Typography variant="h6" gutterBottom>{selectedTemplate.name}</Typography>

                            {/* Preview Card */}
                            <Paper variant="outlined" sx={{
            p: 2,
            bgcolor: '#d9fdd3',
            mb: 3,
            borderRadius: 2,
            maxWidth: '80%'
          }}>
                                {selectedTemplate.header_type === 'text' && selectedTemplate.header_content && <Typography variant="subtitle2" sx={{
              fontWeight: 'bold',
              mb: 1
            }}>
                                        {renderPreview(selectedTemplate.header_content, 'header')}
                                    </Typography>}
                                {selectedTemplate.header_type === 'image' && <Typography variant="subtitle2" sx={{
              fontWeight: 'bold',
              mb: 1,
              color: 'primary.main'
            }}>{tx("auto.k_5aab68450f0d")}

              </Typography>}
                                {selectedTemplate.header_type === 'video' && <Typography variant="subtitle2" sx={{
              fontWeight: 'bold',
              mb: 1,
              color: 'primary.main'
            }}>{tx("auto.k_03ece2c83eb8")}

              </Typography>}
                                {selectedTemplate.header_type === 'document' && <Typography variant="subtitle2" sx={{
              fontWeight: 'bold',
              mb: 1,
              color: 'primary.main'
            }}>{tx("auto.k_b9a4d9cdfd4b")}

              </Typography>}
                                {selectedTemplate.header_type === 'location' && <Typography variant="subtitle2" sx={{
              fontWeight: 'bold',
              mb: 1,
              color: 'primary.main'
            }}>{tx("auto.k_e98506b8b1cc")}

              </Typography>}
                                {selectedTemplate.header_type === 'gif' && <Typography variant="subtitle2" sx={{
              fontWeight: 'bold',
              mb: 1,
              color: 'primary.main'
            }}>
                                        [🎞️ GIF]
                                    </Typography>}

                                <Typography variant="body1" sx={{
              whiteSpace: 'pre-wrap'
            }}>
                                    {renderPreview(selectedTemplate.body, 'body')}
                                </Typography>

                                {selectedTemplate.footer && <Typography variant="caption" color="text.secondary" display="block" sx={{
              mt: 1
            }}>
                                        {selectedTemplate.footer}
                                    </Typography>}

                                {selectedTemplate.buttons && <Box sx={{
              mt: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 1
            }}>
                                        {(() => {
                try {
                  const btns = typeof selectedTemplate.buttons === 'string' ? JSON.parse(selectedTemplate.buttons) : selectedTemplate.buttons;
                  return Array.isArray(btns) ? btns.map((b, i) => <Box key={i}>
                                                        <Chip label={b.text} color="primary" variant="outlined" size="small" />
                                                        {b.type === 'URL' && b.url && <Typography variant="caption" display="block" sx={{
                      mt: 0.5,
                      wordBreak: 'break-all',
                      color: 'text.secondary'
                    }}>
                                                                {renderButtonPreview(b, String(i))}
                                                            </Typography>}
                                                    </Box>) : null;
                } catch (_e) {
                  return null;
                }
              })()}
                                    </Box>}
                            </Paper>

                            <Divider sx={{
            mb: 3
          }} />

                            {/* Variables Inputs */}
                            <Typography variant="subtitle2" gutterBottom>{tx("auto.k_40b086354e02")}</Typography>

                            {getTemplateVariables(selectedTemplate).header.map((v, i) => v === 'MEDIA_LINK' ? <Box key={`h_${i}`} sx={{
            mb: 2
          }}>
                                        <Typography variant="subtitle2" sx={{
              mb: 1
            }}>{tx("auto.k_0661a7637f37")}
                {selectedTemplate.header_type === 'image' ? tx("auto.k_b941956874fe") : selectedTemplate.header_type === 'video' ? tx("auto.k_17daa024f2eb") : tx("auto.k_d9381107732e")}
                                        </Typography>
                                        <Button variant="outlined" component="label" role={undefined} startIcon={<AttachFileIcon />} fullWidth color={variables[`header_${v}`] ? 'success' : 'primary'} sx={{
              textTransform: 'none',
              justifyContent: 'flex-start',
              px: 2
            }}>

                                            <Box sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                                                {variables[`header_${v}`]?.name || tx("auto.k_70302e35b81e")}
                                            </Box>
                                            <input type="file" hidden accept={selectedTemplate.header_type === 'image' ? 'image/jpeg,image/png,image/webp' : selectedTemplate.header_type === 'video' ? 'video/mp4,video/3gpp' : '.pdf,.doc,.docx,.xls,.xlsx,.txt'} onChange={e => handleVariableChange('header', v, e.target.files[0])} />

                                        </Button>
                                    </Box> : <TextField key={`h_${i}`} label={/^\d+$/.test(v) ? `Header Variable {{${v}}}` : v} fullWidth size="small" sx={{
            mb: 2
          }} value={variables[`header_${v}`] || ''} onChange={e => handleVariableChange('header', v, e.target.value)} />)}

                            {getTemplateVariables(selectedTemplate).body.map((v, i) => <TextField key={`b_${i}`} label={/^\d+$/.test(v) ? `Body Variable {{${v}}}` : v} fullWidth size="small" sx={{
            mb: 2
          }} value={variables[`body_${v}`] || ''} onChange={e => handleVariableChange('body', v, e.target.value)} />)}

                            {/* Button Variables */}
                            {getTemplateVariables(selectedTemplate).buttons.map((btn, btnIdx) => <Box key={`btn_section_${btnIdx}`} sx={{
            mt: 2
          }}>
                                    <Typography variant="subtitle2" color="primary" gutterBottom>{tx("auto.k_a39b54541e10")}
                {btn.text}{tx("auto.k_979fc494c85f")}
              </Typography>
                                    {btn.variables.map((v, i) => <TextField key={`btnvar_${btnIdx}_${i}`} label={`Button {{${v}}}`} fullWidth size="small" sx={{
              mb: 2
            }} value={variables[`button_${btn.index}_${v}`] || ''} onChange={e => handleVariableChange('button', `${btn.index}_${v}`, e.target.value)} helperText={btn.url ? `URL: ${btn.url}` : ''} />)}
                                </Box>)}

                            {getTemplateVariables(selectedTemplate).header.length === 0 && getTemplateVariables(selectedTemplate).body.length === 0 && getTemplateVariables(selectedTemplate).buttons.length === 0 && <Typography variant="body2" color="text.secondary" sx={{
            mb: 2
          }}>{tx("auto.k_9ff771c369e8")}

            </Typography>}

                        </> : <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'text.secondary'
        }}>
                            <TemplateIcon sx={{
            fontSize: 40,
            mb: 2,
            opacity: 0.5
          }} />
                            <Typography>{tx("auto.k_3b25ed9589a8")}</Typography>
                        </Box>}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={uploading}>{tx("auto.k_e776b0209b50")}</Button>
                <Button variant="contained" onClick={handleSend} disabled={!selectedTemplate || uploading}>

                    {uploading ? <CircularProgress size={20} color="inherit" /> : tx("auto.k_f1ff175c6fd5")}
                </Button>
            </DialogActions>
        </Dialog>;
};
export default TemplatePicker;
