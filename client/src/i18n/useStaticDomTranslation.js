import { useEffect } from 'react';
import { staticTextEn, staticTextPatternsEn } from './staticTextMap';

const originalTextNodes = new WeakMap();
const originalAttributes = new WeakMap();

const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const translateText = (value) => {
    const text = normalized(value);
    if (!text) return value;
    if (staticTextEn[text]) return staticTextEn[text];
    for (const [pattern, replacement] of staticTextPatternsEn) {
        if (pattern.test(text)) return text.replace(pattern, replacement);
    }
    return value;
};

const translateNodeText = (node, language) => {
    const original = originalTextNodes.get(node) ?? node.nodeValue;
    if (!originalTextNodes.has(node)) originalTextNodes.set(node, original);
    const next = language === 'en' ? translateText(original) : original;
    if (node.nodeValue !== next) node.nodeValue = next;
};

const translateElementAttributes = (element, language) => {
    const attributes = ['placeholder', 'title', 'aria-label', 'label'];
    let originals = originalAttributes.get(element);
    if (!originals) {
        originals = {};
        originalAttributes.set(element, originals);
    }

    attributes.forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        if (!Object.prototype.hasOwnProperty.call(originals, attribute)) {
            originals[attribute] = element.getAttribute(attribute);
        }
        const original = originals[attribute];
        const next = language === 'en' ? translateText(original) : original;
        if (element.getAttribute(attribute) !== next) {
            element.setAttribute(attribute, next);
        }
    });
};

const shouldSkip = (element) => {
    if (!element) return false;
    const tag = element.tagName;
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT';
};

const translateTree = (root, language) => {
    if (!root || typeof document === 'undefined') return;

    if (root.nodeType === Node.TEXT_NODE) {
        translateNodeText(root, language);
        return;
    }

    const start = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!start || shouldSkip(start)) return;

    translateElementAttributes(start, language);

    const walker = document.createTreeWalker(
        start,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE && shouldSkip(node)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        }
    );

    let current = walker.currentNode;
    while (current) {
        if (current.nodeType === Node.TEXT_NODE) {
            translateNodeText(current, language);
        } else if (current.nodeType === Node.ELEMENT_NODE) {
            translateElementAttributes(current, language);
        }
        current = walker.nextNode();
    }
};

export const useStaticDomTranslation = (language) => {
    useEffect(() => {
        if (typeof document === 'undefined' || !document.body) return undefined;

        translateTree(document.body, language);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => translateTree(node, language));
                if (mutation.type === 'characterData') translateTree(mutation.target, language);
                if (mutation.type === 'attributes') translateTree(mutation.target, language);
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['placeholder', 'title', 'aria-label', 'label'],
        });

        return () => observer.disconnect();
    }, [language]);
};
