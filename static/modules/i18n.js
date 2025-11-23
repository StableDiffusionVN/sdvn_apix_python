/**
 * Simple i18n utility for bilingual English-Vietnamese support
 */

export const i18n = {
    currentLang: 'vi',
    
    translations: {
        searchPlaceholder: {
            en: 'Search templates...',
            vi: 'Tìm kiếm mẫu...'
        },
        allCategories: {
            en: 'All Categories',
            vi: 'Tất cả danh mục'
        },
        resultsCount: {
            en: (count) => `${count} template${count !== 1 ? 's' : ''}`,
            vi: (count) => `${count} mẫu`
        },
        noResults: {
            en: 'No templates found',
            vi: 'Không tìm thấy mẫu nào'
        },
        promptTemplates: {
            en: 'Prompt Templates',
            vi: 'Mẫu Prompt'
        },
        toggleLanguage: {
            en: 'Switch to Vietnamese',
            vi: 'Chuyển sang tiếng Anh'
        },
        languageCode: {
            en: 'EN',
            vi: 'VI'
        }
    },
    
    /**
     * Translate a key with optional arguments
     */
    t(key, ...args) {
        const translation = this.translations[key]?.[this.currentLang];
        if (typeof translation === 'function') {
            return translation(...args);
        }
        return translation || key;
    },
    
    /**
     * Set current language
     */
    setLanguage(lang) {
        if (lang === 'en' || lang === 'vi') {
            this.currentLang = lang;
        }
    },
    
    /**
     * Get language-aware text from object
     * Supports both string and object formats
     */
    getText(obj) {
        if (typeof obj === 'string') return obj;
        if (typeof obj === 'object' && obj !== null) {
            return obj[this.currentLang] || obj['en'] || obj['vi'] || '';
        }
        return '';
    }
};
