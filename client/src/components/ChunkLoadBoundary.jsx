import React from 'react';
import { useLanguage } from '../context/LanguageContext.jsx';

const ChunkLoadFallback = () => {
    const { language } = useLanguage();
    const isArabic = language === 'ar';

    return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
            <div style={{ maxWidth: 440, textAlign: 'center', lineHeight: 1.7 }}>
                <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>
                    {isArabic ? 'تعذر تحميل الصفحة' : 'Could not load this page'}
                </h1>
                <p>
                    {isArabic
                        ? 'قد يكون الاتصال قد انقطع أو تم تحديث المنصة. أعد تحميل الصفحة للمحاولة مجدداً.'
                        : 'The connection may have been interrupted or the app may have been updated. Reload to try again.'}
                </p>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    style={{ border: 0, borderRadius: 8, padding: '10px 18px', background: '#087f5b', color: '#fff', cursor: 'pointer', font: 'inherit' }}
                >
                    {isArabic ? 'إعادة تحميل الصفحة' : 'Reload page'}
                </button>
            </div>
        </main>
    );
};

class ChunkLoadBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    render() {
        return this.state.failed ? <ChunkLoadFallback /> : this.props.children;
    }
}

export default ChunkLoadBoundary;
