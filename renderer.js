const { ipcRenderer } = require('electron');
const { broadcastThemeChange } = require('./themeSync.js');

// PDF.js initialization
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let pdfDoc = null;
let pageNum = 1;
let scale = 1.0;
let currentPage = null;
let isAutoScaling = true; // Changed to true by default
let baseScale = 1.0;
let isInitialLoad = true; // New flag to track initial load
let isDoublePageView = false;
let secondCanvas = null;
let currentBookPath = null; // Add variable to store current book path

// Load saved view mode preference
if (localStorage.getItem('pdfViewMode') === 'double') {
    isDoublePageView = true;
}

// Add page history tracking
let pageHistory = [];
let isNavigatingHistory = false;

// Add table of contents functionality
const tocContainer = document.getElementById('toc-container');
const toggleTocButton = document.getElementById('toggle-toc');
const tocCloseButton = document.querySelector('.toc-close');

toggleTocButton?.addEventListener('click', () => {
    tocContainer.classList.toggle('open');
});

tocCloseButton?.addEventListener('click', () => {
    tocContainer.classList.remove('open');
});

// Close TOC when clicking outside
document.addEventListener('click', (e) => {
    if (tocContainer?.classList.contains('open') && 
        !tocContainer.contains(e.target) && 
        !toggleTocButton.contains(e.target)) {
        tocContainer.classList.remove('open');
    }
});

// Add settings menu toggle functionality
const settingsButton = document.getElementById('toggle-settings');
const settingsMenu = document.querySelector('.settings-menu');

// Toggle settings menu
settingsButton?.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('open');
});

// Close settings menu when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target) && !settingsButton.contains(e.target)) {
        settingsMenu.classList.remove('open');
    }
});

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('pdf-render');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('pdf-container');
    const zoomValue = document.getElementById('zoom-value');
    const zoomInput = document.getElementById('zoom-input');
    
    // Create second canvas for double page view
    secondCanvas = document.createElement('canvas');
    secondCanvas.classList.add('page-canvas');
    const secondCtx = secondCanvas.getContext('2d');

    // Create wrapper for pages
    const pagesWrapper = document.createElement('div');
    pagesWrapper.classList.add('pages-wrapper');
    container.appendChild(pagesWrapper);
    pagesWrapper.appendChild(canvas);

    // Initialize view mode from saved preference
    const toggleDoublePageButton = document.getElementById('toggle-double-page');
    if (toggleDoublePageButton) {
        toggleDoublePageButton.classList.toggle('active', isDoublePageView);
        container.classList.toggle('double-page-view', isDoublePageView);
        if (isDoublePageView && !pagesWrapper.contains(secondCanvas)) {
            pagesWrapper.appendChild(secondCanvas);
        }
    }

    // Listen for book data from main process
    ipcRenderer.on('load-book', async (event, data) => {
        if (data.type === 'pdf') {
            currentBookPath = data.path; // Store the book path
            loadPDF(data.content, data.progress);
        }
    });

    // Event Listeners for zoom value/input switching
    zoomValue?.addEventListener('click', () => {
        zoomValue.classList.add('hidden');
        zoomInput.value = `${Math.round(scale * 100)}%`;
        zoomInput.classList.add('visible');
        zoomInput.focus();
        zoomInput.select();
    });

    zoomInput?.addEventListener('blur', () => {
        applyManualZoom();
    });

    zoomInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            applyManualZoom();
            e.preventDefault();
        } else if (e.key === 'Escape') {
            zoomInput.classList.remove('visible');
            zoomValue.classList.remove('hidden');
            e.preventDefault();
        }
    });

    function applyManualZoom() {
        const value = zoomInput.value.replace('%', '').trim();
        const newScale = parseFloat(value) / 100;
        
        if (!isNaN(newScale)) {
            if (newScale < 0.25) {
                scale = 0.25;
            } else if (newScale > 5) {
                scale = 5;
            } else {
                scale = newScale;
            }
            isAutoScaling = false;
            updateZoomValue();
            renderPage(pageNum);
        } else {
            zoomInput.value = `${Math.round(scale * 100)}%`;
        }
        
        zoomInput.classList.remove('visible');
        zoomValue.classList.remove('hidden');
    }

    // Add double page view toggle
    document.getElementById('toggle-double-page')?.addEventListener('click', async () => {
        const button = document.getElementById('toggle-double-page');
        isDoublePageView = !isDoublePageView;
        button.classList.toggle('active', isDoublePageView);
        container.classList.toggle('double-page-view', isDoublePageView);
        
        // Save view mode preference
        localStorage.setItem('pdfViewMode', isDoublePageView ? 'double' : 'single');
        
        if (isDoublePageView) {
            if (!pagesWrapper.contains(secondCanvas)) {
                pagesWrapper.appendChild(secondCanvas);
            }
        } else {
            if (pagesWrapper.contains(secondCanvas)) {
                pagesWrapper.removeChild(secondCanvas);
            }
        }
        
        // Reset scale when toggling view mode
        if (isAutoScaling) {
            scale = 1.0;
        }
        await renderPage(pageNum);
    });

    // Modify navigation for double page view
    document.getElementById('prev-page')?.addEventListener('click', async () => {
        if (pageNum <= 1) return;
        
        const newPageNum = isDoublePageView ? Math.max(1, pageNum - 2) : pageNum - 1;
        
        try {
            await pdfDoc.getPage(newPageNum);
            pageNum = newPageNum;
            await renderPage(pageNum);
        } catch (error) {
            console.error('Error navigating to previous page:', error);
        }
    });

    document.getElementById('next-page')?.addEventListener('click', async () => {
        if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
        
        const newPageNum = isDoublePageView ? 
            Math.min(pdfDoc.numPages - 1, pageNum + 2) : 
            Math.min(pdfDoc.numPages, pageNum + 1);
        
        try {
            await pdfDoc.getPage(newPageNum);
            if (isDoublePageView && newPageNum < pdfDoc.numPages) {
                await pdfDoc.getPage(newPageNum + 1);
            }
            pageNum = newPageNum;
            await renderPage(pageNum);
        } catch (error) {
            console.error('Error navigating to next page:', error);
        }
    });

    // Add back button functionality
    document.getElementById('back-button')?.addEventListener('click', async () => {
        if (pageHistory.length === 0) return;
        
        try {
            isNavigatingHistory = true;
            const previousPage = pageHistory.pop();
            await pdfDoc.getPage(previousPage);
            
            pageNum = previousPage;
            await renderPage(pageNum);
            
            // Update navigation state
            updateNavigationState();
        } catch (error) {
            console.error('Error navigating back:', error);
        } finally {
            isNavigatingHistory = false;
        }
    });

    function updateNavigationState() {
        const prevButton = document.getElementById('prev-page');
        const nextButton = document.getElementById('next-page');
        const backButton = document.getElementById('back-button');
        
        if (prevButton) prevButton.disabled = pageNum <= 1;
        if (nextButton) nextButton.disabled = pageNum >= pdfDoc.numPages;
        if (backButton) backButton.disabled = pageHistory.length === 0;
    }

    document.getElementById('zoom-in')?.addEventListener('click', () => {
        if (scale >= 5) return;
        
        isAutoScaling = false;
        const newScale = scale * 1.25;
        if (newScale <= 5) {
            scale = newScale;
            updateZoomValue();
            renderPage(pageNum);
        }
    });

    document.getElementById('zoom-out')?.addEventListener('click', () => {
        if (scale <= 0.25) return;
        
        isAutoScaling = false;
        const newScale = scale / 1.25;
        if (newScale >= 0.25) {
            scale = newScale;
            updateZoomValue();
            renderPage(pageNum);
        }
    });

    document.getElementById('fit-page')?.addEventListener('click', async () => {
        if (!currentPage || !container) return;

        try {
            // Get the container dimensions
            const containerStyle = window.getComputedStyle(container);
            const containerWidth = container.clientWidth 
                - parseFloat(containerStyle.paddingLeft || 0) 
                - parseFloat(containerStyle.paddingRight || 0);
            const containerHeight = container.clientHeight 
                - parseFloat(containerStyle.paddingTop || 0) 
                - parseFloat(containerStyle.paddingBottom || 0)
                - 40; // Добавляем небольшой отступ для комфортного просмотра

            // Get the page viewport at scale 1.0
            const viewport = currentPage.getViewport({ scale: 1.0 });
            
            // Calculate scale to fit both width and height
            const scaleWidth = containerWidth / viewport.width;
            const scaleHeight = containerHeight / viewport.height;
            
            // Use the smaller scale to ensure the page fits
            let newScale = Math.min(scaleWidth, scaleHeight);
            
            // Enforce scale limits
            newScale = Math.max(0.25, Math.min(5.0, newScale));
            
            // Update scale and render
            scale = newScale;
            isAutoScaling = false; // Disable auto-scaling after manual fit
            
            // Update zoom display
            updateZoomValue();
            
            // Render with new scale
            await renderPage(pageNum);

        } catch (error) {
            console.error('Error in fit-to-page:', error);
        }
    });

    function updateZoomValue() {
        if (zoomValue) {
            const percentage = Math.round(scale * 100);
            zoomValue.textContent = `${percentage}%`;
            zoomInput.value = `${percentage}%`;
        }
    }

    function calculateScale(page, secondPage = null) {
        try {
            if (!container || !page) return 1.0;

            const viewport = page.getViewport({ scale: 1.0 });
            
            // Get container dimensions with padding consideration
            const containerStyle = window.getComputedStyle(container);
            const containerWidth = container.clientWidth 
                - parseFloat(containerStyle.paddingLeft || 0) 
                - parseFloat(containerStyle.paddingRight || 0)
                - (isDoublePageView ? 0 : 0); // Убран отступ для двухстраничного режима
            const containerHeight = container.clientHeight 
                - parseFloat(containerStyle.paddingTop || 0) 
                - parseFloat(containerStyle.paddingBottom || 0);

            if (containerWidth <= 0 || containerHeight <= 0) {
                console.warn('Invalid container dimensions:', { containerWidth, containerHeight });
                return 1.0;
            }

            if (viewport.width <= 0 || viewport.height <= 0) {
                console.warn('Invalid viewport dimensions:', viewport);
                return 1.0;
            }

            // Calculate scale for both width and height
            let scaleWidth = containerWidth / (isDoublePageView ? (viewport.width * 2) : viewport.width);
            const scaleHeight = containerHeight / viewport.height;

            // Use the smaller scale to ensure the page fits both dimensions
            let newScale = Math.min(scaleWidth, scaleHeight) * 0.98; // Небольшой отступ только по краям

            // Validate scale value
            if (!isFinite(newScale) || newScale <= 0) {
                console.warn('Invalid scale calculated:', newScale);
                return 1.0;
            }

            // Enforce scale limits
            newScale = Math.max(0.25, Math.min(5.0, newScale));
            
            // Store as base scale
            baseScale = newScale;
            
            return newScale;
        } catch (error) {
            console.error('Error calculating scale:', error);
            return 1.0;
        }
    }

    async function loadPDF(pdfData, savedProgress) {
        try {
            // Show loading indicator
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) loadingIndicator.style.display = 'block';

            // Cleanup previous PDF
            if (pdfDoc) {
                try {
                    await pdfDoc.cleanup();
                    await pdfDoc.destroy();
                } catch (error) {
                    console.warn('Error cleaning up previous PDF:', error);
                }
            }

            // Clear canvas
            if (canvas && ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                canvas.width = 0;
                canvas.height = 0;
            }

            if (secondCanvas && secondCtx) {
                secondCtx.clearRect(0, 0, secondCanvas.width, secondCanvas.height);
                secondCanvas.width = 0;
                secondCanvas.height = 0;
            }

            // Force garbage collection hint
            if (window.gc) {
                window.gc();
            }

            // Validate PDF data
            if (!pdfData || typeof pdfData !== 'string') {
                throw new Error('Invalid PDF data format');
            }

            try {
                // Try to decode base64 to check if it's valid
                const decodedData = atob(pdfData);
                if (!decodedData || decodedData.length === 0) {
                    throw new Error('Invalid PDF data content');
                }
            } catch (error) {
                console.error('PDF data validation error:', error);
                throw new Error('Invalid PDF file format');
            }

            // Create loading task with enhanced options
            const loadingTask = pdfjsLib.getDocument({ 
                data: atob(pdfData),
                useWorkerFetch: true,
                isEvalSupported: false,
                useSystemFonts: true,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/standard_fonts/'
            });

            // Add timeout for PDF loading
            const pdfPromise = Promise.race([
                loadingTask.promise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('PDF load timeout')), 10000)
                )
            ]);

            pdfDoc = await pdfPromise;

            // Validate PDF document
            if (!pdfDoc || !pdfDoc.numPages || pdfDoc.numPages <= 0) {
                throw new Error('Invalid PDF structure');
            }

            // Pre-validate first page to ensure PDF is readable
            try {
                const firstPage = await Promise.race([
                    pdfDoc.getPage(1),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Page load timeout')), 5000)
                    )
                ]);
                
                // Check if page is valid
                if (!firstPage || !firstPage.getViewport({ scale: 1.0 })) {
                    throw new Error('Invalid page structure');
                }
            } catch (error) {
                console.error('First page validation error:', error);
                throw new Error('Could not validate PDF content');
            }

            // Update UI
            const pageCount = document.getElementById('page-count');
            if (pageCount) {
                pageCount.textContent = `of ${pdfDoc.numPages}`;
            }
            
            // Reset viewer state
            pageNum = savedProgress ? parseInt(savedProgress) : 1;
            isInitialLoad = true;
            isAutoScaling = true;
            scale = 1.0;
            pageHistory = [];
            
            // Update navigation state
            updateNavigationState();

            // Load and display table of contents
            await loadTOC(pdfDoc);

            // Render saved page or first page
            await renderPage(pageNum);

        } catch (error) {
            console.error('Error loading PDF:', error);
            let errorMessage = 'Error loading PDF file. ';
            
            if (error.message === 'PDF load timeout') {
                errorMessage += 'The file is too large or your connection is slow.';
            } else if (error.message === 'Invalid PDF structure') {
                errorMessage += 'The file appears to be corrupted.';
            } else if (error.message === 'Invalid PDF file format') {
                errorMessage += 'The file format is not valid.';
            } else if (error.message === 'Could not validate PDF content') {
                errorMessage += 'The file content appears to be corrupted.';
            } else {
                errorMessage += 'The file might be corrupted or invalid.';
            }
            
            alert(errorMessage);

            // Reset viewer state on error
            pdfDoc = null;
            pageNum = 1;
            scale = 1.0;
            isAutoScaling = true;
            pageHistory = [];
            
            // Clear canvas
            if (canvas && ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                canvas.width = 0;
                canvas.height = 0;
            }
            
            // Update UI to show error state
            const pageNumElement = document.getElementById('page-num');
            const pageCount = document.getElementById('page-count');
            
            if (pageNumElement) pageNumElement.textContent = 'Page: -';
            if (pageCount) pageCount.textContent = 'of -';

            // Update navigation state in error case
            updateNavigationState();

        } finally {
            // Hide loading indicator
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    async function loadTOC(pdfDoc) {
        try {
            const outline = await pdfDoc.getOutline();
            if (outline && outline.length > 0) {
                displayTableOfContents(outline);
            } else {
                // Add an empty message with close button
                tocContainer.innerHTML = `
                    <div class="toc-header">
                        <h3 class="toc-title">Table of Contents</h3>
                        <button class="toc-close" title="Close">×</button>
                    </div>
                    <div class="toc-empty-message">
                        This PDF does not contain a table of contents.
                    </div>
                `;

                // Add event listener for the close button
                const closeButton = tocContainer.querySelector('.toc-close');
                if (closeButton) {
                    closeButton.addEventListener('click', () => {
                        tocContainer.classList.remove('open');
                    });
                }
            }
        } catch (error) {
            console.error('Error loading table of contents:', error);
            // Add an error message with close button
            tocContainer.innerHTML = `
                <div class="toc-header">
                    <h3 class="toc-title">Table of Contents</h3>
                    <button class="toc-close" title="Close">×</button>
                </div>
                <div class="toc-error-message">
                    Error loading table of contents. The PDF may be corrupted or have an invalid structure.
                </div>
            `;

            // Add event listener for the close button
            const closeButton = tocContainer.querySelector('.toc-close');
            if (closeButton) {
                closeButton.addEventListener('click', () => {
                    tocContainer.classList.remove('open');
                });
            }
        }
    }

    function displayTableOfContents(outline, level = 0) {
        if (!outline || !Array.isArray(outline)) {
            console.error('Invalid outline structure:', outline);
            return;
        }
        
        outline.forEach(item => {
            if (!item.title) {
                console.warn('TOC item missing title:', item);
                return;
            }

            const div = document.createElement('div');
            div.className = `toc-item toc-level-${level}`;
            div.textContent = item.title;
            
            // Добавляем отладочную информацию
            console.log('Processing TOC item:', {
                title: item.title,
                dest: item.dest,
                url: item.url,
                type: item.dest ? (Array.isArray(item.dest) ? 'Array' : typeof item.dest) : 'No destination'
            });
            
            if (item.dest || item.url) {
                div.addEventListener('click', async () => {
                    try {
                        if (item.dest) {
                            console.log('Attempting to navigate to destination:', item.dest);
                            
                            let pageIndex;
                            // Обработка различных форматов destination
                            if (Array.isArray(item.dest)) {
                                // Если dest это массив, первый элемент обычно ссылка на страницу
                                console.log('Array destination format detected');
                                pageIndex = await pdfDoc.getPageIndex(item.dest[0]);
                            } else if (typeof item.dest === 'string') {
                                // Если dest это строка, пробуем получить destination
                                console.log('String destination format detected:', item.dest);
                                const destination = await pdfDoc.getDestination(item.dest);
                                console.log('Resolved string destination:', destination);
                                if (destination && destination.length > 0) {
                                    pageIndex = await pdfDoc.getPageIndex(destination[0]);
                                }
                            } else if (item.dest.gen !== undefined && item.dest.num !== undefined) {
                                // Если dest это PDF reference object
                                console.log('PDF reference object detected:', item.dest);
                                pageIndex = await pdfDoc.getPageIndex(item.dest);
                            }
                            
                            console.log('Resolved page index:', pageIndex);
                            
                            if (pageIndex !== undefined) {
                                if (!isNavigatingHistory) {
                                    pageHistory.push(pageNum);
                                }
                                pageNum = pageIndex + 1;
                                
                                // Добавляем прокрутку к определенной позиции на странице, если она указана
                                let scrollTo = null;
                                if (Array.isArray(item.dest) && item.dest.length > 1) {
                                    scrollTo = item.dest[1];
                                }
                                
                                await renderPage(pageNum);
                                
                                // Если есть позиция прокрутки, применяем её
                                if (scrollTo) {
                                    const canvas = document.getElementById('pdf-render');
                                    const viewport = currentPage.getViewport({ scale: scale });
                                    const yPos = viewport.height - (scrollTo.y || 0) * scale;
                                    canvas.parentElement.scrollTop = yPos;
                                }
                                
                                // Update active state in TOC
                                document.querySelectorAll('.toc-item').forEach(item => {
                                    item.classList.remove('active');
                                });
                                div.classList.add('active');
                                
                                // Store page data for TOC state tracking
                                div._pageData = { pageNumber: pageNum };
                            } else {
                                console.error('Could not resolve page index for destination:', item.dest);
                                alert('Не удалось перейти к указанной странице. Возможно, PDF файл имеет нестандартную структуру оглавления.');
                            }
                        } else if (item.url) {
                            window.open(item.url, '_blank');
                        }
                    } catch (error) {
                        console.error('Error navigating to destination:', error);
                        console.error('Destination details:', {
                            item: item,
                            dest: item.dest,
                            title: item.title
                        });
                        alert('Произошла ошибка при переходе по оглавлению. Подробности в консоли разработчика.');
                    }
                });
            } else {
                console.warn('TOC item has no destination or URL:', item);
                // Делаем элемент без ссылки визуально отличимым
                div.classList.add('toc-item-no-link');
            }
            
            tocContainer.appendChild(div);
            
            // Recursively display child items
            if (item.items && item.items.length > 0) {
                displayTableOfContents(item.items, level + 1);
            }
        });
    }

    // Add function to update TOC active state when navigating pages
    function updateTocActiveState(pageNumber) {
        if (!pdfDoc || !tocContainer) return;
        
        document.querySelectorAll('.toc-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Find and highlight the current section in TOC
        // This is a simple implementation - you might want to enhance it
        // based on your specific PDF structure
        const items = tocContainer.querySelectorAll('.toc-item');
        let lastMatchingItem = null;
        
        items.forEach(item => {
            const itemData = item._pageData;
            if (itemData && itemData.pageNumber <= pageNumber) {
                lastMatchingItem = item;
            }
        });
        
        if (lastMatchingItem) {
            lastMatchingItem.classList.add('active');
        }
    }

    // Add cleanup function for WebGL resources
    function cleanupWebGLResources(canvas) {
        if (!canvas) return;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return;

        // Get all textures and buffers
        const textures = gl.getParameter(gl.TEXTURE_BINDING_2D);
        const buffers = gl.getParameter(gl.ARRAY_BUFFER_BINDING);

        // Delete textures
        if (textures) {
            if (Array.isArray(textures)) {
                textures.forEach(texture => gl.deleteTexture(texture));
            } else {
                gl.deleteTexture(textures);
            }
        }

        // Delete buffers
        if (buffers) {
            if (Array.isArray(buffers)) {
                buffers.forEach(buffer => gl.deleteBuffer(buffer));
            } else {
                gl.deleteBuffer(buffers);
            }
        }

        // Clear any errors
        gl.getError();
    }

    // Enhanced cleanup for pages
    async function cleanupPage(page) {
        if (!page) return;
        try {
            await page.cleanup();
            if (page._transport && typeof page._transport.destroy === 'function') {
                await page._transport.destroy();
            }
        } catch (error) {
            console.warn('Error during page cleanup:', error);
        }
    }

    // Get theme module
    const { themes, currentTheme } = require('./theme.js');

    // Function to apply current theme to PDF content
    function applyCurrentTheme() {
        const theme = themes[currentTheme];
        if (!theme) return;

        const container = document.getElementById('pdf-container');
        if (container) {
            container.style.backgroundColor = theme['--content-bg'];
        }

        // Update canvas background for PDF content
        if (canvas && ctx) {
            canvas.style.backgroundColor = theme['--content-bg'];
            // Re-render current page to apply theme
            if (currentPage) {
                renderPage(pageNum);
            }
        }
    }

    async function renderPage(num) {
        if (!pdfDoc || !canvas || !ctx) {
            console.error('Required objects are missing');
            return;
        }

        try {
            // Get the current page
            let page;
            try {
                page = await pdfDoc.getPage(num);
            } catch (error) {
                console.error('Error getting PDF page:', error);
                return;
            }

            currentPage = page;

            // Calculate and validate scale
            let currentScale = scale;
            try {
                if (isAutoScaling) {
                    currentScale = calculateScale(page);
                    if (!isFinite(currentScale) || currentScale <= 0) {
                        currentScale = 1.0;
                    }
                    scale = currentScale;
                }

                // Validate scale value
                if (!isFinite(currentScale) || currentScale <= 0) {
                    currentScale = 1.0;
                    scale = 1.0;
                }

                // Enforce scale limits
                currentScale = Math.max(0.25, Math.min(5.0, currentScale));
            } catch (error) {
                console.error('Error calculating scale:', error);
                currentScale = 1.0;
                scale = 1.0;
            }

            // Get the viewport and validate dimensions
            let viewport = page.getViewport({ scale: currentScale });
            
            // Update canvas dimensions
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // Clear both canvases before rendering
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (secondCtx) {
                secondCtx.clearRect(0, 0, secondCanvas.width, secondCanvas.height);
            }

            // Render current page with white background
            try {
                await page.render({
                    canvasContext: ctx,
                    viewport: viewport,
                    enableWebGL: true,
                    renderInteractiveForms: true,
                    background: 'white' // Always use white background for PDF content
                }).promise;

                // Render second page if in double page view
                if (isDoublePageView && num < pdfDoc.numPages) {
                    try {
                        const nextPage = await pdfDoc.getPage(num + 1);
                        const nextViewport = nextPage.getViewport({ scale: currentScale });
                        
                        secondCanvas.width = viewport.width;
                        secondCanvas.height = viewport.height;
                        
                        await nextPage.render({
                            canvasContext: secondCtx,
                            viewport: nextViewport,
                            enableWebGL: true,
                            renderInteractiveForms: true,
                            background: 'white' // Always use white background for PDF content
                        }).promise;
                    } catch (error) {
                        console.error('Error rendering second page:', error);
                        if (secondCtx) {
                            secondCtx.clearRect(0, 0, secondCanvas.width, secondCanvas.height);
                        }
                    }
                }

                // Update zoom value display
                updateZoomValue();
            } catch (error) {
                console.error('Error rendering page:', error);
                
                // Try fallback render without WebGL
                try {
                    await page.render({
                        canvasContext: ctx,
                        viewport: viewport,
                        enableWebGL: false,
                        renderInteractiveForms: true,
                        background: 'white' // Always use white background for PDF content
                    }).promise;

                    if (isDoublePageView && num < pdfDoc.numPages) {
                        const nextPage = await pdfDoc.getPage(num + 1);
                        const nextViewport = nextPage.getViewport({ scale: currentScale });
                        
                        secondCanvas.width = viewport.width;
                        secondCanvas.height = viewport.height;
                        
                        await nextPage.render({
                            canvasContext: secondCtx,
                            viewport: nextViewport,
                            enableWebGL: false,
                            renderInteractiveForms: true,
                            background: 'white' // Always use white background for PDF content
                        }).promise;
                    }
                } catch (fallbackError) {
                    console.error('Fallback rendering failed:', fallbackError);
                }
            }

            // Update TOC active state
            updateTocActiveState(num);

            // Save reading progress
            if (currentBookPath) {
                ipcRenderer.send('save-reading-progress', {
                    bookPath: currentBookPath,
                    location: num.toString()
                });
            }

            // Update page number display
            document.getElementById('page-num').textContent = isDoublePageView ? 
                `Pages: ${num}-${Math.min(num + 1, pdfDoc.numPages)}` : 
                `Page: ${num}`;

            // Update navigation state after successful render
            updateNavigationState();

        } catch (error) {
            console.error('Error in renderPage:', error);
        }
    }

    // Add resize observer with debouncing
    if (container) {
        let resizeTimeout;
        const resizeObserver = new ResizeObserver(entries => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (currentPage && isAutoScaling) {
                    renderPage(pageNum);
                }
            }, 100); // Debounce resize events
        });
        resizeObserver.observe(container);
    }

    // Enhanced cleanup on window unload
    window.addEventListener('unload', async () => {
        if (pdfDoc) {
            try {
                if (currentPage) {
                    await cleanupPage(currentPage);
                }
                cleanupWebGLResources(canvas);
                cleanupWebGLResources(secondCanvas);
                await pdfDoc.cleanup();
                await pdfDoc.destroy();
            } catch (error) {
                console.warn('Error during cleanup:', error);
            }
        }
    });

    // Enhanced cleanup when container is hidden/removed
    const observer = new IntersectionObserver(async (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) {
                if (currentPage) {
                    await cleanupPage(currentPage);
                }
                cleanupWebGLResources(canvas);
                cleanupWebGLResources(secondCanvas);
            }
        }
    }, { threshold: 0 });

    if (container) {
        observer.observe(container);
    }

    // Enhanced mouse wheel zoom with smooth transitions
    container?.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            isAutoScaling = false;
            
            const oldScale = scale;
            let newScale = scale;
            
            if (e.deltaY < 0) {
                if (scale >= 5) return;
                newScale = scale * 1.1;
                if (newScale > 5) newScale = 5;
            } else {
                if (scale <= 0.25) return;
                newScale = scale / 1.1;
                if (newScale < 0.25) newScale = 0.25;
            }
            
            if (oldScale !== newScale && newScale >= 0.25 && newScale <= 5) {
                scale = newScale;
                updateZoomValue();
                renderPage(pageNum);
            }
        }
    });

    // Add auto-scale toggle button
    document.getElementById('toggle-auto-scale')?.addEventListener('click', () => {
        const button = document.getElementById('toggle-auto-scale');
        isAutoScaling = !isAutoScaling;
        button.classList.toggle('active', isAutoScaling);
        
        if (isAutoScaling) {
            scale = calculateScale(currentPage, isDoublePageView ? secondPage : null);
            renderPage(pageNum);
        }
    });

    // Add theme switching functionality
    window.switchTheme = function(themeName) {
        // Get theme module
        const { applyTheme } = require('./theme.js');
        
        // Apply the theme
        applyTheme(themeName);
        
        // Update active state of theme buttons
        document.querySelectorAll('.theme-button').forEach(button => {
            button.classList.remove('active');
            if (button.classList.contains(themeName)) {
                button.classList.add('active');
            }
        });

        // Broadcast theme change to other windows
        broadcastThemeChange(themeName);
    };

    // Initialize theme buttons
    document.addEventListener('DOMContentLoaded', () => {
        const { currentTheme } = require('./theme.js');
        
        // Set active state for current theme button
        document.querySelectorAll('.theme-button').forEach(button => {
            button.classList.remove('active');
            if (button.classList.contains(currentTheme)) {
                button.classList.add('active');
            }
        });
    });
}); 