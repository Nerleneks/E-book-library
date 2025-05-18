const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const { broadcastThemeChange } = require('./themeSync.js');

let book = null;
let rendition = null;
let currentScale = 16; // Default font size in pixels
let currentLineSpacing = 1.5;
let currentLocation = null;
let isSpreadMode = true; // Set default to true for spread mode
let currentBookPath = null; // Add variable to store current book path

// Make rendition available globally for theme changes
window.rendition = null;

// DOM Elements
const container = document.getElementById('epub-container');
const content = document.getElementById('epub-content');
const tocContainer = document.getElementById('toc-container');
const pageInfo = document.getElementById('page-info');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = loadingOverlay.querySelector('.loading-text');
const progressBar = loadingOverlay.querySelector('.progress-bar-fill');
const prevButton = document.getElementById('prev-page');
const nextButton = document.getElementById('next-page');
const toggleSpreadButton = document.getElementById('toggle-spread');
const toggleSettingsButton = document.getElementById('toggle-settings');
const settingsMenu = document.querySelector('.settings-menu');
const fontSizeInput = document.getElementById('font-size');
const lineSpacingInput = document.getElementById('line-spacing');
const fontSizeValue = fontSizeInput.nextElementSibling;
const lineSpacingValue = lineSpacingInput.nextElementSibling;

// Get theme module
const { themes, currentTheme } = require('./theme.js');

// Add new DOM elements
const metadataContainer = document.getElementById('metadata-container');
const toggleMetadataButton = document.getElementById('toggle-metadata');
const closeMetadataButton = document.getElementById('close-metadata');

// Add theme switching functionality
window.switchTheme = function(themeName) {
    const { applyTheme } = require('./theme.js');
    applyTheme(themeName).then(() => {
        // Update active state of theme buttons in settings menu
        document.querySelectorAll('.theme-button').forEach(button => {
            button.classList.remove('active');
            if (button.classList.contains(themeName)) {
                button.classList.add('active');
            }
        });
        
        // Force re-render current page with new theme
        if (rendition) {
            const currentLocation = rendition.location.start.cfi;
            rendition.clear();
            rendition.display(currentLocation);
        }

        // Broadcast theme change to other windows
        broadcastThemeChange(themeName);
    });
};

// Disable buttons initially
prevButton.disabled = true;
nextButton.disabled = true;
toggleSpreadButton.disabled = true;

// Event Listeners
prevButton.addEventListener('click', () => {
    if (rendition) {
        rendition.prev();
    }
});

nextButton.addEventListener('click', () => {
    if (rendition) {
        rendition.next();
    }
});

// Settings menu toggle
toggleSettingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('open');
    
    // Update active theme button when opening settings
    const { currentTheme } = require('./theme.js');
    document.querySelectorAll('.theme-button').forEach(button => {
        button.classList.remove('active');
        if (button.classList.contains(currentTheme)) {
            button.classList.add('active');
        }
    });
});

// Close settings menu when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target) && !toggleSettingsButton.contains(e.target)) {
        settingsMenu.classList.remove('open');
    }
});

// Font size control
fontSizeInput.addEventListener('input', () => {
    currentScale = parseInt(fontSizeInput.value);
    fontSizeValue.textContent = `${currentScale}px`;
    updateStyles();
});

// Line spacing control
lineSpacingInput.addEventListener('input', () => {
    currentLineSpacing = parseFloat(lineSpacingInput.value);
    lineSpacingValue.textContent = currentLineSpacing.toFixed(1);
    updateStyles();
});

document.getElementById('toggle-toc').addEventListener('click', () => {
    tocContainer.classList.toggle('open');
});

toggleSpreadButton.addEventListener('click', () => {
    toggleSpreadMode();
});

// Add metadata toggle handlers
toggleMetadataButton.addEventListener('click', (e) => {
    e.stopPropagation();
    metadataContainer.classList.toggle('open');
});

closeMetadataButton.addEventListener('click', () => {
    metadataContainer.classList.remove('open');
});

// Close metadata panel when clicking outside
document.addEventListener('click', (e) => {
    if (!metadataContainer.contains(e.target) && !toggleMetadataButton.contains(e.target)) {
        metadataContainer.classList.remove('open');
    }
});

function updateStyles() {
    if (rendition) {
        rendition.themes.fontSize(`${currentScale}px`);
        rendition.themes.default({
            body: {
                'line-height': `${currentLineSpacing}`
            }
        });
    }
}

function toggleSpreadMode() {
    isSpreadMode = !isSpreadMode;
    container.classList.toggle('spread');
    content.classList.toggle('spread');
    
    const currentCfi = rendition.location.start.cfi;
    
    rendition.destroy();
    
    rendition = book.renderTo('epub-content', {
        width: '100%',
        height: '100%',
        spread: isSpreadMode ? 'auto' : 'none',
        flow: 'paginated',
        minSpreadWidth: 800,
        allowScriptedContent: false
    });
    
    rendition.display(currentCfi);
    updateStyles();
    setupRenditionHandlers();
}

function updateLoadingProgress(percentage, text) {
    progressBar.style.width = `${percentage}%`;
    if (text) {
        loadingText.textContent = text;
    }
}

function enableControls() {
    prevButton.disabled = false;
    nextButton.disabled = false;
    toggleSpreadButton.disabled = false;
}

function setupRenditionHandlers() {
    // Update page info and save progress
    rendition.on('relocated', (location) => {
        const currentPage = location.start.displayed.page;
        const totalPages = location.total;
        const pageText = isSpreadMode ? 
            `Pages ${currentPage}-${Math.min(currentPage + 1, totalPages)} of ${totalPages}` :
            `Page ${currentPage} of ${totalPages}`;
        pageInfo.textContent = pageText;

        // Save reading progress
        if (currentBookPath) {
            ipcRenderer.send('save-reading-progress', {
                bookPath: currentBookPath,
                location: location.start.cfi
            });
        }

        // Pre-fetch next chapter
        if (location.end.percentage > 0.8) {
            rendition.next();
            rendition.prev();
        }
    });

    // Apply theme when content is rendered
    rendition.on('rendered', (section, iframeView) => {
        const { applyTheme, currentTheme } = require('./theme.js');
        
        const applyThemeToIframe = (iframe) => {
            if (!iframe || !iframe.contentDocument) return;
            
            const doc = iframe.contentDocument;
            const theme = themes[currentTheme];
            
            // Apply theme to iframe content
            if (doc.body) {
                doc.body.style.backgroundColor = theme['--content-bg'];
                doc.body.style.color = theme['--content-text'];
            }
            
            // Apply theme to all text elements
            const textElements = doc.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6');
            textElements.forEach(element => {
                element.style.color = theme['--content-text'];
                element.style.backgroundColor = 'transparent';
            });
            
            // Apply theme to links
            const links = doc.querySelectorAll('a');
            links.forEach(link => {
                link.style.color = theme['--content-link'];
            });
        };

        // Handle direct iframe
        if (iframeView && iframeView.iframe) {
            if (iframeView.iframe.contentDocument.readyState === 'complete') {
                applyThemeToIframe(iframeView.iframe);
            }
            iframeView.iframe.addEventListener('load', () => {
                applyThemeToIframe(iframeView.iframe);
            });
        }

        // Handle all iframes in the container
        const iframes = document.querySelectorAll('#epub-content iframe');
        iframes.forEach(iframe => {
            applyThemeToIframe(iframe);
            iframe.addEventListener('load', () => {
                applyThemeToIframe(iframe);
            });
        });
    });

    // Handle keyboard navigation
    document.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft') rendition.prev();
        if (e.key === 'ArrowRight') rendition.next();
    });

    // Handle window resizing
    window.addEventListener('resize', () => {
        if (rendition) {
            rendition.resize();
        }
    });
}

// Listen for EPUB data from main process
ipcRenderer.on('load-book', async (event, data) => {
    if (data.type === 'epub') {
        currentBookPath = data.path; // Store the book path
        loadEpub(data.content, data.progress);
    }
});

// Function to display book metadata
async function displayMetadata(book) {
    try {
        // Wait for metadata to be loaded
        await book.ready;
        const metadata = book.package.metadata;
        
        // Update metadata fields with proper fallbacks
        document.getElementById('book-title').textContent = 
            metadata.title || '-';
        
        // Handle author (can be string or array)
        const author = Array.isArray(metadata.creator) 
            ? metadata.creator.join(', ') 
            : metadata.creator || '-';
        document.getElementById('book-author').textContent = author;
        
        document.getElementById('book-publisher').textContent = 
            metadata.publisher || '-';
        
        // Format date if available
        const pubdate = metadata.date || metadata.pubdate;
        document.getElementById('book-pubdate').textContent = 
            pubdate ? new Date(pubdate).toLocaleDateString() : '-';
        
        document.getElementById('book-description').textContent = 
            metadata.description || '-';
        
        document.getElementById('book-language').textContent = 
            metadata.language || '-';
        
        document.getElementById('book-rights').textContent = 
            metadata.rights || '-';
        
        // Handle cover image
        const coverElement = document.getElementById('book-cover');
        try {
            const cover = await book.coverUrl();
            if (cover) {
                coverElement.src = cover;
                coverElement.style.display = 'block';
            } else {
                coverElement.style.display = 'none';
            }
        } catch (coverError) {
            console.warn('Error loading cover:', coverError);
            coverElement.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Error displaying metadata:', error);
        // Hide metadata panel if there's an error
        metadataContainer.classList.remove('open');
    }
}

// Modify the loadEpub function to include metadata display
async function loadEpub(epubData, savedProgress) {
    try {
        updateLoadingProgress(0, 'Initializing...');

        // Create blob URL from base64 data
        const blob = new Blob([Buffer.from(epubData, 'base64')], { type: 'application/epub+zip' });
        const url = URL.createObjectURL(blob);

        updateLoadingProgress(20, 'Loading book...');

        // Load the EPUB with optimized settings
        book = ePub(url, {
            openAs: 'epub',
            restore: true,
            storage: true
        });

        // Track loading progress
        book.ready.then(() => {
            updateLoadingProgress(40, 'Processing book contents...');
        });

        await book.ready;

        updateLoadingProgress(60, 'Loading table of contents...');
        
        const toc = await book.navigation.toc;
        displayTableOfContents(toc);

        updateLoadingProgress(80, 'Preparing display...');

        // Render the book with spread mode enabled by default
        rendition = book.renderTo('epub-content', {
            width: '100%',
            height: '100%',
            spread: 'auto',
            flow: 'paginated',
            minSpreadWidth: 800,
            allowScriptedContent: false
        });

        // Make rendition globally available for theme changes
        window.rendition = rendition;

        // Set up event handlers first
        setupRenditionHandlers();

        // Apply initial theme and styles
        const { applyTheme, currentTheme } = require('./theme.js');
        await applyTheme(currentTheme);
        
        // Update theme button states
        document.querySelectorAll('.theme-button').forEach(button => {
            button.classList.remove('active');
            if (button.classList.contains(currentTheme)) {
                button.classList.add('active');
            }
        });

        // Initialize spread mode UI
        container.classList.add('spread');
        content.classList.add('spread');

        // Apply initial styles
        rendition.themes.fontSize(`${currentScale}px`);

        // Load saved progress or initial chapter
        if (savedProgress) {
            await rendition.display(savedProgress);
        } else {
            await rendition.display();
        }

        // Enable controls after successful load
        enableControls();

        // Hide loading overlay when everything is ready
        updateLoadingProgress(100, 'Ready!');
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500);

        // Display metadata
        await displayMetadata(book);

    } catch (error) {
        console.error('Error loading EPUB:', error);
        loadingText.textContent = 'Error loading book';
        loadingText.style.color = 'red';
    }
}

function displayTableOfContents(toc) {
    // Add header first
    tocContainer.innerHTML = `
        <div class="toc-header">
            <h3 class="toc-title">Оглавление</h3>
            <button class="toc-close" title="Close">×</button>
        </div>
    `;

    // Add event listener for the close button
    const closeButton = tocContainer.querySelector('.toc-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            tocContainer.classList.remove('open');
        });
    }

    // Create container for TOC items
    const tocContent = document.createElement('div');
    tocContent.className = 'toc-content';
    tocContainer.appendChild(tocContent);

    const createTocItem = (item) => {
        const div = document.createElement('div');
        div.classList.add('toc-item');
        div.textContent = item.label;
        div.addEventListener('click', () => {
            rendition.display(item.href);
            tocContainer.classList.remove('open');
        });
        return div;
    };

    const renderTocItems = (items, container, level = 0) => {
        items.forEach(item => {
            const itemDiv = createTocItem(item);
            itemDiv.classList.add(`toc-level-${level}`);
            container.appendChild(itemDiv);
            
            if (item.subitems && item.subitems.length > 0) {
                renderTocItems(item.subitems, container, level + 1);
            }
        });
    };

    if (!toc || toc.length === 0) {
        tocContent.innerHTML = `
            <div class="toc-empty-message">
                У этой книги нет оглавления.
            </div>
        `;
        return;
    }

    renderTocItems(toc, tocContent);
} 