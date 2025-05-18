// Theme definitions
const themes = {
    light: {
        '--background-color': '#f0f0f0',
        '--toolbar-bg': '#2c3e50',
        '--toolbar-text': '#ffffff',
        '--button-bg': '#3498db',
        '--button-hover': '#2980b9',
        '--text-color': '#2c3e50',
        '--border-color': '#e0e0e0',
        '--shadow-color': 'rgba(0,0,0,0.1)',
        '--toc-bg': '#ffffff',
        '--toc-hover': '#f0f0f0',
        '--toc-active': '#e3f2fd',
        '--scrollbar-track': '#f1f1f1',
        '--scrollbar-thumb': '#888',
        '--scrollbar-thumb-hover': '#555',
        '--content-bg': '#ffffff',
        '--content-text': '#2c3e50',
        '--content-link': '#3498db',
        '--card-bg': '#ffffff',
        '--card-text': '#1a1a1a',
        '--card-secondary': '#666',
        '--card-border': '#eaeaea'
    },
    dark: {
        '--background-color': '#1e1e1e',
        '--toolbar-bg': '#2c3e50',
        '--toolbar-text': '#ffffff',
        '--button-bg': '#3498db',
        '--button-hover': '#2980b9',
        '--text-color': '#ffffff',
        '--border-color': '#333333',
        '--shadow-color': 'rgba(0,0,0,0.3)',
        '--toc-bg': '#2c2c2c',
        '--toc-hover': '#3c3c3c',
        '--toc-active': '#1976d2',
        '--scrollbar-track': '#2c2c2c',
        '--scrollbar-thumb': '#555',
        '--scrollbar-thumb-hover': '#666',
        '--content-bg': '#1e1e1e',
        '--content-text': '#ffffff',
        '--content-link': '#5dade2',
        '--card-bg': '#2c2c2c',
        '--card-text': '#ffffff',
        '--card-secondary': '#a0a0a0',
        '--card-border': '#333333'
    },
    sepia: {
        '--background-color': '#f4ecd8',
        '--toolbar-bg': '#4a3c2c',
        '--toolbar-text': '#f4ecd8',
        '--button-bg': '#8b7355',
        '--button-hover': '#6b563c',
        '--text-color': '#4a3c2c',
        '--border-color': '#d4c4a8',
        '--shadow-color': 'rgba(74,60,44,0.1)',
        '--toc-bg': '#f9f5eb',
        '--toc-hover': '#f4ecd8',
        '--toc-active': '#e6d5b8',
        '--scrollbar-track': '#f4ecd8',
        '--scrollbar-thumb': '#8b7355',
        '--scrollbar-thumb-hover': '#6b563c',
        '--content-bg': '#f4ecd8',
        '--content-text': '#4a3c2c',
        '--content-link': '#8b7355',
        '--card-bg': '#f9f5eb',
        '--card-text': '#4a3c2c',
        '--card-secondary': '#6b563c',
        '--card-border': '#d4c4a8'
    }
};

// Get current theme from localStorage or default to light
let currentTheme = localStorage.getItem('theme') || 'light';

// Function to apply theme
async function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) return;

    // Update current theme
    currentTheme = themeName;
    localStorage.setItem('theme', themeName);

    // Apply CSS variables to root
    Object.entries(theme).forEach(([property, value]) => {
        document.documentElement.style.setProperty(property, value);
    });

    // Update theme buttons in settings menu
    document.querySelectorAll('.theme-button').forEach(button => {
        button.classList.remove('active');
        if (button.classList.contains(themeName)) {
            button.classList.add('active');
        }
    });

    // Apply theme to containers but preserve PDF content
    const pdfContainer = document.querySelector('#pdf-container');
    if (pdfContainer) {
        pdfContainer.style.backgroundColor = theme['--background-color'];
        // Do not modify the canvas or PDF content itself
        const canvas = document.querySelector('#pdf-render');
        if (canvas) {
            canvas.style.boxShadow = `0 0 10px ${theme['--shadow-color']}`;
        }
    }

    // Apply theme to table of contents
    const tocContainer = document.querySelector('#toc-container');
    if (tocContainer) {
        // Apply background and text colors
        tocContainer.style.backgroundColor = theme['--toc-bg'];
        tocContainer.style.color = theme['--text-color'];
        
        // Style the header
        const tocHeader = tocContainer.querySelector('.toc-header');
        if (tocHeader) {
            tocHeader.style.borderBottomColor = theme['--border-color'];
        }
        
        // Style the title
        const tocTitle = tocContainer.querySelector('.toc-title');
        if (tocTitle) {
            tocTitle.style.color = theme['--text-color'];
        }
        
        // Style the close button
        const tocClose = tocContainer.querySelector('.toc-close');
        if (tocClose) {
            tocClose.style.color = theme['--text-color'];
        }
        
        // Style all TOC items
        const tocItems = tocContainer.querySelectorAll('.toc-item');
        tocItems.forEach(item => {
            item.style.color = theme['--text-color'];
            // Remove any existing hover styles
            item.style.transition = 'background-color 0.2s';
        });
    }

    // Apply theme to settings menu
    const settingsMenu = document.querySelector('.settings-menu');
    if (settingsMenu) {
        settingsMenu.style.backgroundColor = theme['--toc-bg'];
        settingsMenu.style.color = theme['--text-color'];
        settingsMenu.style.boxShadow = `0 2px 10px ${theme['--shadow-color']}`;
    }

    // If we're in the EPUB reader, apply theme to EPUB content
    if (typeof window.rendition !== 'undefined' && window.rendition) {
        try {
            // Define theme CSS
            const themeCSS = `
                :root, body, html {
                    background-color: ${theme['--content-bg']} !important;
                    color: ${theme['--content-text']} !important;
                }
                body > * {
                    background-color: ${theme['--content-bg']} !important;
                    color: ${theme['--content-text']} !important;
                }
                p, div, span, h1, h2, h3, h4, h5, h6, li, td, th, tr, article, section {
                    background-color: ${theme['--content-bg']} !important;
                    color: ${theme['--content-text']} !important;
                }
                a:link, a:visited {
                    color: ${theme['--content-link']} !important;
                }
            `;

            // Function to apply styles to an iframe
            const applyStylesToIframe = (iframe) => {
                if (!iframe.contentDocument) return;

                // Remove existing theme styles
                const existingStyles = iframe.contentDocument.querySelectorAll('style[data-theme]');
                existingStyles.forEach(style => style.remove());

                // Add new theme styles
                const style = document.createElement('style');
                style.setAttribute('data-theme', themeName);
                style.textContent = themeCSS;
                
                // Try to insert into head first
                if (iframe.contentDocument.head) {
                    iframe.contentDocument.head.appendChild(style);
                }
                // If no head, insert into body
                else if (iframe.contentDocument.body) {
                    iframe.contentDocument.body.appendChild(style);
                }

                // Apply styles directly to body
                if (iframe.contentDocument.body) {
                    iframe.contentDocument.body.style.cssText = `
                        background-color: ${theme['--content-bg']} !important;
                        color: ${theme['--content-text']} !important;
                    `;
                }
            };

            // Apply to all iframes
            const iframes = document.querySelectorAll('#epub-content iframe');
            iframes.forEach(applyStylesToIframe);

            // Set up observer for new iframes
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.tagName === 'IFRAME') {
                            // Initial application
                            applyStylesToIframe(node);
                            
                            // Apply again after load
                            node.addEventListener('load', () => {
                                applyStylesToIframe(node);
                                // And once more after a short delay
                                setTimeout(() => applyStylesToIframe(node), 100);
                            });
                        }
                    });
                });
            });

            // Start observing
            const epubContent = document.getElementById('epub-content');
            if (epubContent) {
                observer.observe(epubContent, {
                    childList: true,
                    subtree: true
                });
            }

            // Apply to containers
            ['#pdf-container', '#epub-container', '#epub-content'].forEach(selector => {
                const element = document.querySelector(selector);
                if (element) {
                    element.style.backgroundColor = theme['--content-bg'];
                    element.style.color = theme['--content-text'];
                }
            });

        } catch (error) {
            console.error('Error applying theme to EPUB:', error);
        }
    }
}

// Initialize theme
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme);
});

// Export functions and variables
module.exports = {
    themes,
    currentTheme,
    applyTheme
}; 