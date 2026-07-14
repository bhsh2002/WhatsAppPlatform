import { tx } from '../../i18n/tx';

export const getContactLabelOptions = () => [{
  value: '',
  label: tx('auto.k_2aa3693faed8'),
  color: 'default'
}, {
  value: 'عميل',
  label: tx('auto.k_8898da70bb4c'),
  color: 'primary'
}, {
  value: 'VIP',
  label: 'VIP',
  color: 'secondary'
}, {
  value: 'مورد',
  label: tx('auto.k_f3418b3a2d50'),
  color: 'info'
}, {
  value: 'دعم',
  label: tx('auto.k_6d8ade865335'),
  color: 'warning'
}, {
  value: 'محظور',
  label: tx('auto.k_bd3a43ab3c0a'),
  color: 'error'
}];
