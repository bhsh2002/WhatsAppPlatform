export const AUTOMATION_MATCH_TYPES = Object.freeze(['exact', 'contains']);
export const MAX_AUTOMATION_PATTERN_LENGTH = 512;
export const MAX_AUTOMATION_MESSAGE_LENGTH = 10_000;
const MAX_CONTAINS_TERMS = 25;

export const validateAutomationPattern = ({ ruleType, matchType, matchPattern }) => {
    const usesPattern = ruleType === 'keyword' || ruleType === 'comment_reply';
    if (!usesPattern) return null;

    const hasPattern = typeof matchPattern === 'string' && matchPattern.trim().length > 0;
    if (ruleType === 'keyword' && !hasPattern) {
        return 'نمط المطابقة مطلوب لقواعد الكلمات المفتاحية';
    }
    if (!hasPattern) return null;

    if (!AUTOMATION_MATCH_TYPES.includes(matchType)) {
        return matchType === 'regex'
            ? 'مطابقة regex معطلة لأسباب أمنية؛ استخدم المطابقة التامة أو الاحتواء'
            : 'نوع المطابقة غير صالح';
    }
    if (matchPattern.length > MAX_AUTOMATION_PATTERN_LENGTH) {
        return `نمط المطابقة يجب ألا يتجاوز ${MAX_AUTOMATION_PATTERN_LENGTH} حرفًا`;
    }
    if (matchType === 'contains') {
        const terms = matchPattern.split(',').map(term => term.trim()).filter(Boolean);
        if (terms.length === 0) return 'أدخل كلمة مطابقة واحدة على الأقل';
        if (terms.length > MAX_CONTAINS_TERMS) {
            return `مطابقة الاحتواء تدعم حتى ${MAX_CONTAINS_TERMS} كلمة`;
        }
    }

    return null;
};

export const matchesAutomationPattern = (rule, messageText) => {
    if (typeof messageText !== 'string' || !messageText || !rule.match_pattern) return false;
    if (!AUTOMATION_MATCH_TYPES.includes(rule.match_type)) return false;

    const boundedMessage = messageText.slice(0, MAX_AUTOMATION_MESSAGE_LENGTH);
    const text = rule.match_case_sensitive ? boundedMessage : boundedMessage.toLowerCase();
    const pattern = rule.match_case_sensitive ? rule.match_pattern : rule.match_pattern.toLowerCase();

    if (rule.match_type === 'exact') return text.trim() === pattern.trim();

    const patterns = pattern.split(',').map(value => value.trim()).filter(Boolean);
    return patterns.some(value => text.includes(value));
};
